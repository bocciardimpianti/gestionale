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
