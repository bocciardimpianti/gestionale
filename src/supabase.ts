import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

export type Azione = "vedere" | "creare" | "modificare" | "eliminare" | "esportare";
export const AZIONI: Azione[] = ["vedere", "creare", "modificare", "eliminare", "esportare"];

export interface Profilo {
  id: string;
  email: string;
  nome: string | null;
  ruolo: "admin" | "standard";
  attivo: boolean;
  whatsapp?: boolean;
  // Vede prezzi, ricarichi, costi, tariffe e totali (gli admin sempre)
  prezzi?: boolean;
  // Titolare, Tecnico, Commerciale, Amministrativo, Magazzino (solo descrittiva; i permessi restano quelli scelti)
  mansione?: string | null;
}

export interface Sezione {
  chiave: string;
  etichetta: string;
  gruppo: string;
  ordine: number;
}

export type Permesso = { utente_id: string; sezione: string } & Record<Azione, boolean>;

// Chiama la funzione server riservata all'admin
export async function adminUtenti(azione: string, dati: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("admin-utenti", { body: { azione, ...dati } });
  if (error) {
    const msg = await error.context?.json?.().then((j: { errore?: string }) => j.errore).catch(() => null);
    throw new Error(msg ?? error.message);
  }
  return data;
}

export const vuoto = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

// Scrive una voce nel registro attività
export async function registra(azione: string, dettagli: unknown) {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("registro").insert({ utente_id: user?.id, azione, dettagli });
}

// Legge tutte le righe superando il limite di 1000 per richiesta.
// Le tabelle collegate (es. "cliente:clienti(nome)") vengono appiattite al solo nome.
// Con "soloAttivi" esclude i record nel cestino.
// Collegamento non ancora presente nel database (script non eseguito): si toglie dalla lettura invece di fallire
// es. "Could not find a relationship between 'ddt_acquisto' and 'tecnici'" → select senza "tecnico:tecnici(nome)"
export function senzaCollegamentoMancante(select: string, errore: { message?: string } | null) {
  // Campo calcolato non ancora creato dallo script SQL (es. "nei_rapportini"): si legge senza
  const campo = /column [\w"]+\.(\w+) does not exist|could not find the '?(\w+)'? column/i.exec(errore?.message ?? "");
  const nome = campo?.[1] ?? campo?.[2];
  if (nome) {
    const senza = select.replace(new RegExp(`\\s*,\\s*${nome}\\b(?![:(])`, "g"), "");
    if (senza !== select) return senza;
  }
  const t = /relationship between '[^']+' and '([^']+)'/i.exec(errore?.message ?? "")?.[1];
  if (!t) return null;
  const ridotto = select.replace(new RegExp(`\\s*,\\s*\\w+:${t}(!\\w+)?\\([^)]*\\)`, "g"), "");
  return ridotto !== select ? ridotto : null;
}

export async function leggiTutto(tabella: string, select = "*", soloAttivi = false) {
  const tutte: (Record<string, unknown> & { id: number })[] = [];
  for (let da = 0; ; da += 1000) {
    let q = supabase.from(tabella).select(select);
    if (soloAttivi) q = q.is("eliminato_il", null);
    const { data, error } = await q.order("id").range(da, da + 999);
    if (error) {
      const ridotto = da === 0 ? senzaCollegamentoMancante(select, error) : null;
      if (ridotto) {
        console.warn(`${tabella}: ${error.message} (eseguire lo script SQL che crea il collegamento)`);
        return leggiTutto(tabella, ridotto, soloAttivi);
      }
      throw error;
    }
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      for (const [k, v] of Object.entries(r)) {
        if (v && typeof v === "object" && "nome" in v) r[k] = (v as { nome: unknown }).nome;
      }
      tutte.push(r as Record<string, unknown> & { id: number });
    }
    if (!data || data.length < 1000) return tutte;
  }
}

// Codice interno dei materiali: progressivo a 6 cifre (es. "004795"), compresi quelli nel cestino.
// I codici a 7 cifre dei materiali CLLAT (codice del fornitore) non contano per la numerazione.
export async function prossimiCodiciInterni(quanti = 1): Promise<string[]> {
  const { data, error } = await supabase.from("materiali").select("codice_interno")
    .filter("codice_interno", "match", "^[0-9]{6}$").order("codice_interno", { ascending: false }).limit(1);
  if (error) throw error;
  const ultimo = Number(data?.[0]?.codice_interno ?? 0);
  return Array.from({ length: quanti }, (_, i) => String(ultimo + i + 1).padStart(6, "0"));
}

// Date: nel database "aaaa-mm-gg", a schermo "gg/mm/aaaa"
export function dataIso(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const t = String(v ?? "").trim();
  const it = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (it) return `${it[3]}-${it[2].padStart(2, "0")}-${it[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

export function dataIt(v: unknown) {
  const iso = dataIso(v);
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
}
