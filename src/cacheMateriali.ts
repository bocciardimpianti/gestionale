// Elenco dei materiali salvato sul dispositivo (IndexedDB): compare subito, anche dopo che il telefono ha chiuso l'app.
// In sottofondo si scaricano solo i materiali cambiati dall'ultima volta (data di modifica), e una volta al giorno l'elenco intero.
// All'uscita dal gestionale la copia viene cancellata.
import { leggiTutto, supabase } from "./supabase";

type Materiale = Record<string, unknown> & { id: number };
type Salvato<T> = { quando: number; dati: T };

const DB = "gestionale-cache";
const STORE = "dati";
const UN_GIORNO = 24 * 3600 * 1000;
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
  inMemoria = null;
}

let inMemoria: Materiale[] | null = null;
let inCorso: Promise<Materiale[]> | null = null;

/** Materiali già disponibili sul dispositivo (subito), o null la prima volta */
export async function materialiSalvati(): Promise<Materiale[] | null> {
  if (inMemoria) return inMemoria;
  const s = await leggi<Materiale[]>("materiali");
  if (s && !inMemoria) inMemoria = s.dati;
  return inMemoria;
}

/** Materiali aggiornati dal database: solo i cambiati se c'è già una copia recente, altrimenti tutti */
export function materialiAggiornati(): Promise<Materiale[]> {
  if (inCorso) return inCorso;
  inCorso = (async () => {
    const s = await leggi<Materiale[]>("materiali");
    let elenco: Materiale[];
    if (s && Date.now() - s.quando < UN_GIORNO && s.dati.length) {
      const ultimo = s.dati.reduce((m, r) => (String(r.modificato_il ?? "") > m ? String(r.modificato_il) : m), "");
      const cambiati: Materiale[] = [];
      for (let da = 0; ; da += 1000) {
        const { data, error } = await supabase.from("materiali").select("*").gte("modificato_il", ultimo).order("id").range(da, da + 999);
        if (error) throw error;
        cambiati.push(...((data ?? []) as Materiale[]));
        if (!data || data.length < 1000) break;
      }
      const perId = new Map(s.dati.map((r) => [r.id, r]));
      for (const r of cambiati) {
        if (r.eliminato_il) perId.delete(r.id);
        else perId.set(r.id, r);
      }
      elenco = [...perId.values()];
      await scrivi("materiali", elenco, s.quando);
    } else {
      elenco = (await leggiTutto("materiali", "*", true)) as Materiale[];
      await scrivi("materiali", elenco);
    }
    inMemoria = elenco;
    return elenco;
  })().finally(() => { inCorso = null; });
  return inCorso;
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
