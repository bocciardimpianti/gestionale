// IA per gli impianti (funzione server "impianti-ia", con Claude): manda SOLO le descrizioni dei materiali
// dei rapportini e riceve quali materiali formano un impianto e con che ruolo.
import { supabase } from "./supabase";
import { chiaveCorrezione, type Correzione, type ImpiantoIA } from "./impiantiAuto";

export type RapportinoIA = { id: number; righe: string[] };

/** Un gruppo di rapportini (max 15) → impianti trovati dall'IA per ogni rapportino */
export async function chiediImpiantiIA(gruppo: RapportinoIA[]): Promise<{ perRapporto: Map<number, ImpiantoIA[]>; uso?: Record<string, number> }> {
  const { data, error } = await supabase.functions.invoke("impianti-ia", { body: { rapportini: gruppo } });
  if (error) {
    const msg = await error.context?.json?.().then((j: { errore?: string }) => j.errore).catch(() => null);
    throw new Error(msg ?? (/fetch|Failed to send/i.test(error.message)
      ? "IA non raggiungibile: va pubblicata su Supabase la funzione \"impianti-ia\""
      : error.message));
  }
  const perRapporto = new Map<number, ImpiantoIA[]>();
  for (const r of (data?.rapportini ?? []) as { id: number; impianti: ImpiantoIA[] }[]) perRapporto.set(Number(r.id), r.impianti ?? []);
  return { perRapporto, uso: data?.uso };
}

/** Correzioni fatte a mano nella linguetta Materiali degli impianti (vuoto senza lo script 0048) */
export async function leggiCorrezioni(): Promise<Correzione[]> {
  const { data, error } = await supabase.from("correzioni_impianti").select("categoria, descrizione, incluso").limit(5000);
  if (error) return [];
  return ((data ?? []) as Correzione[]).map((c) => ({ ...c, descrizione: chiaveCorrezione(c.descrizione) }));
}

/** Stima indicativa della spesa (Claude Opus 5.5: 4 $ per milione di token in entrata, 20 $ in uscita) */
export function stimaCosto(rapportini: RapportinoIA[]) {
  const caratteri = rapportini.reduce((n, r) => n + r.righe.reduce((m, t) => m + t.length + 6, 20), 0);
  const gruppi = Math.ceil(rapportini.length / 12);
  const entrata = caratteri / 3.2 + gruppi * 2500;
  const uscita = rapportini.length * 250 + gruppi * 400;
  return (entrata * 4 + uscita * 20) / 1_000_000;
}
