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
export async function leggiTutto(tabella: string, select = "*", soloAttivi = false) {
  const tutte: (Record<string, unknown> & { id: number })[] = [];
  for (let da = 0; ; da += 1000) {
    let q = supabase.from(tabella).select(select);
    if (soloAttivi) q = q.is("eliminato_il", null);
    const { data, error } = await q.order("id").range(da, da + 999);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      for (const [k, v] of Object.entries(r)) {
        if (v && typeof v === "object" && "nome" in v) r[k] = (v as { nome: unknown }).nome;
      }
      tutte.push(r as Record<string, unknown> & { id: number });
    }
    if (!data || data.length < 1000) return tutte;
  }
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
