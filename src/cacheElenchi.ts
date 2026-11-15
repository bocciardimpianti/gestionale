// Elenchi salvati sul dispositivo (IndexedDB): compaiono subito, anche dopo che il telefono ha chiuso l'app.
// In sottofondo si scaricano solo le righe cambiate dall'ultima volta (data di modifica); ogni 2 ore l'elenco intero.
// All'uscita dal gestionale la copia viene cancellata.
import { leggiTutto, supabase } from "./supabase";

type Materiale = Record<string, unknown> & { id: number };
type Salvato<T> = { quando: number; dati: T };

const DB = "gestionale-cache";
const STORE = "dati";
const SEI_ORE = 6 * 3600 * 1000;

function apri(): Promise<IDBDatabase | null> {
  return new Promise((ok) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
    } catch {
      ok(null);
    }
  });
}

async function leggi<T>(chiave: string): Promise<Salvato<T> | null> {
  const db = await apri();
  if (!db) return null;
  return new Promise((ok) => {
    try {
      const r = db.transaction(STORE).objectStore(STORE).get(chiave);
      r.onsuccess = () => ok((r.result as Salvato<T>) ?? null);
      r.onerror = () => ok(null);
    } catch {
      ok(null);
    }
  });
}

async function scrivi<T>(chiave: string, dati: T, quando = Date.now()) {
  const db = await apri();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put({ quando, dati } satisfies Salvato<T>, chiave);
  } catch {
    /* spazio non disponibile: si lavora senza copia */
  }
}

export function svuotaCache() {
  try {
    indexedDB.deleteDatabase(DB);
  } catch {
    /* niente da cancellare */
  }
  inMemoriaElenchi.clear();
}

// ---------------------------------------------------------------------------------------------
// Elenchi delle sezioni (rapportini, preventivi, materiali, clienti…): stessa logica, una copia per tabella+select.
// Le righe nel cestino restano nella copia (servono alla vista Cestino); chi vuole solo le attive le filtra.
// ---------------------------------------------------------------------------------------------
const MAX_ETA_COPIA = 2 * 3600 * 1000; // dopo 2 ore si riscarica tutto (es. record eliminati definitivamente altrove)
const inMemoriaElenchi = new Map<string, Materiale[]>();
const inCorsoElenchi = new Map<string, Promise<Materiale[]>>();
const chiaveElenco = (tabella: string, select: string) => `elenco:${tabella}:${select}`;

// Nomi dei record collegati (es. cliente:clienti(nome)) come testo, come fa leggiTutto
const appiattisci = (r: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(r)) if (v && typeof v === "object" && "nome" in v) r[k] = (v as { nome: unknown }).nome;
  return r as Materiale;
};

/** Elenco già disponibile (memoria o dispositivo), o null */
export async function elencoSalvato(tabella: string, select = "*"): Promise<Materiale[] | null> {
  const k = chiaveElenco(tabella, select);
  if (inMemoriaElenchi.has(k)) return inMemoriaElenchi.get(k)!;
  const s = await leggi<Materiale[]>(k);
  if (s && !inMemoriaElenchi.has(k)) inMemoriaElenchi.set(k, s.dati);
  return inMemoriaElenchi.get(k) ?? null;
}

/** Elenco aggiornato: solo le righe cambiate se la copia è recente, altrimenti tutto ("completo" forza lo scaricamento intero) */
export function elencoAggiornato(tabella: string, select = "*", completo = false): Promise<Materiale[]> {
  const k = chiaveElenco(tabella, select);
  const gia = inCorsoElenchi.get(k);
  if (gia && !completo) return gia;
  const lavoro = (async () => {
    const s = completo ? null : await leggi<Materiale[]>(k);
    let elenco: Materiale[];
    const ultimo = s?.dati.reduce((m, r) => (String(r.modificato_il ?? "") > m ? String(r.modificato_il) : m), "") ?? "";
    // Solo le righe cambiate; se non riesce (es. collegamento mancante) si riscarica tutto
    const soloCambiati = async () => {
      const cambiati: Materiale[] = [];
      for (let da = 0; ; da += 1000) {
        const { data, error } = await supabase.from(tabella).select(select).gte("modificato_il", ultimo).order("id").range(da, da + 999);
        if (error) return null;
        cambiati.push(...((data ?? []) as unknown as Record<string, unknown>[]).map(appiattisci));
        if (!data || data.length < 1000) return cambiati;
      }
    };
    const cambiati = s && ultimo && Date.now() - s.quando < MAX_ETA_COPIA ? await soloCambiati() : null;
    if (s && cambiati) {
      const perId = new Map(s.dati.map((r) => [r.id, r]));
      for (const r of cambiati) perId.set(r.id, r);
      elenco = [...perId.values()];
      await scrivi(k, elenco, s.quando);
    } else {
      elenco = (await leggiTutto(tabella, select)) as Materiale[];
      await scrivi(k, elenco);
    }
    inMemoriaElenchi.set(k, elenco);
    return elenco;
  })().finally(() => { if (inCorsoElenchi.get(k) === lavoro) inCorsoElenchi.delete(k); });
  inCorsoElenchi.set(k, lavoro);
  return lavoro;
}

// Materiali per la ricerca: la stessa copia dell'elenco Materiali, senza quelli nel cestino
const attivi = (m: Materiale[]) => m.filter((r) => !r.eliminato_il);

/** Materiali già disponibili sul dispositivo (subito), o null la prima volta */
export async function materialiSalvati(): Promise<Materiale[] | null> {
  const m = await elencoSalvato("materiali");
  return m ? attivi(m) : null;
}

/** Materiali aggiornati dal database (solo i cambiati se la copia è recente) */
export async function materialiAggiornati(): Promise<Materiale[]> {
  return attivi(await elencoAggiornato("materiali"));
}

/** Quante volte ogni materiale è stato usato nei rapportini (ricalcolato al massimo ogni 6 ore) */
export async function usiMateriali(): Promise<{ subito: Map<number, number> | null; aggiorna: () => Promise<Map<number, number>> }> {
  const s = await leggi<[number, number][]>("usi");
  const subito = s ? new Map(s.dati) : null;
  const aggiorna = async () => {
    if (s && Date.now() - s.quando < SEI_ORE) return subito!;
    const righe = await leggiTutto("righe_rapporto", "id, materiale_id");
    const conta = new Map<number, number>();
    for (const r of righe) if (r.materiale_id) conta.set(Number(r.materiale_id), (conta.get(Number(r.materiale_id)) ?? 0) + 1);
    await scrivi("usi", [...conta.entries()]);
    return conta;
  };
  return { subito, aggiorna };
}
