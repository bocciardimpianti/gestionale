// Assistente per la ricerca dei materiali (funzione server "assistente", con Claude).
// 1) dalla richiesta a parole ottiene alcune ricerche brevi
// 2) le esegue sul magazzino con la ricerca furba
// 3) fa scegliere all'assistente i materiali più adatti tra quelli trovati
import { supabase } from "./supabase";
import { creaRicerca, normalizza, preparaSinonimi } from "./ricercaFurba";

type Materiale = Record<string, unknown> & { id: number };
export type Proposta = { materiale: Materiale; motivo: string };

async function chiama<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("assistente", { body });
  if (error) {
    const msg = await error.context?.json?.().then((j: { errore?: string }) => j.errore).catch(() => null);
    throw new Error(msg ?? (/fetch|Failed to send/i.test(error.message)
      ? "Assistente non raggiungibile: va pubblicata su Supabase la funzione \"assistente\""
      : error.message));
  }
  return data as T;
}

export async function chiediAssistente(domanda: string, materiali: Materiale[], testoDi: (m: Materiale) => string,
  sinonimi: ReturnType<typeof preparaSinonimi>): Promise<Proposta[]> {
  const { ricerche } = await chiama<{ ricerche: string[] }>({ azione: "parole", domanda });
  // Candidati: i primi trovati per ogni ricerca (più la frase originale), senza doppioni
  const visti = new Set<number>();
  const candidati: Materiale[] = [];
  for (const q of [domanda, ...ricerche]) {
    const r = creaRicerca(q, sinonimi);
    let n = 0;
    for (const m of materiali) {
      if (n >= 20 || candidati.length >= 80) break;
      if (visti.has(m.id) || !r.corrisponde(normalizza(testoDi(m)))) continue;
      visti.add(m.id); candidati.push(m); n++;
    }
  }
  if (!candidati.length) return [];
  const { scelti } = await chiama<{ scelti: { id: number; motivo: string }[] }>({
    azione: "scegli",
    domanda,
    candidati: candidati.map((m) => ({ id: m.id, testo: `${m.descrizione ?? ""} ${m.nome_articolo ? `(${m.nome_articolo})` : ""} cod. ${m.codice_interno ?? ""}` })),
  });
  const perId = new Map(candidati.map((m) => [m.id, m]));
  return scelti.filter((s) => perId.has(s.id)).map((s) => ({ materiale: perId.get(s.id)!, motivo: s.motivo }));
}
