import { supabase } from "./supabase";
import { fatturaEasyfatt, righeDdt, scaricaEasyfatt } from "./easyfatt";

/**
 * DDT per Danea Easy Fatt dai rapportini (salvati) di uno stesso cliente: un materiale per riga, senza prezzi,
 * i preventivi non approvati esclusi. Usato dalla scheda del rapportino e dall'elenco (rapportini spuntati).
 * Restituisce un messaggio (errore o fatto).
 */
export async function ddtEasyfattDaRapporti(ids: number[]): Promise<string> {
  if (!ids.length) return "Nessun rapportino scelto";
  const { data: rapp, error } = await supabase.from("rapporti").select("id, numero, cliente_id").in("id", ids);
  if (error) return "Errore: " + error.message;
  const clienti = [...new Set((rapp ?? []).map((r) => r.cliente_id).filter(Boolean))];
  if (!clienti.length) return "I rapportini scelti non hanno il cliente";
  if (clienti.length > 1) return "Scegli rapportini dello stesso cliente: un DDT è per un solo cliente";
  const [{ data: cli, error: e1 }, { data: righe, error: e2 }] = await Promise.all([
    supabase.from("clienti").select("nome, codice_fiscale, piva, email, indirizzo_fatturazione, tipologia_pagamento").eq("id", clienti[0]).maybeSingle(),
    supabase.from("righe_rapporto").select("descrizione, nome_articolo, quantita, unita_misura, non_approvato, ordine").in("rapporto_id", ids).order("ordine"),
  ]);
  if (e1 || e2) return "Errore: " + (e1 ?? e2)!.message;
  if (!cli) return "Cliente non trovato";
  const mat = ((righe ?? []) as Record<string, unknown>[]).filter((x) => !x.non_approvato && String(x.descrizione || x.nome_articolo || "").trim())
    .map((x) => ({ descrizione: String(x.descrizione || x.nome_articolo), quantita: Number(x.quantita ?? 1) || 1, um: (x.unita_misura as string) ?? null }));
  if (!mat.length) return "Nei rapportini salvati non ci sono materiali da mettere nel DDT (se li hai appena aggiunti, salva prima il rapportino)";
  const numeri = (rapp ?? []).map((r) => r.numero).filter(Boolean).join("-");
  scaricaEasyfatt(fatturaEasyfatt(cli as Parameters<typeof fatturaEasyfatt>[0], righeDdt(mat, false), new Date(), "D"), `DDT ${cli.nome} rapportini ${numeri}`);
  return `File DDT per Easy Fatt scaricato (${ids.length} ${ids.length === 1 ? "rapportino" : "rapportini"}): importalo in Easy Fatt`;
}
