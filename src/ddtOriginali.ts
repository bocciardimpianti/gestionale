import { supabase } from "./supabase";
import { leggiDdt, scritteDaPdf } from "./ddtPdf";

// DDT già importati prima dello script 0064: si rilegge il PDF originale salvato con il DDT e si scrivono nelle
// righe il codice e la descrizione del fornitore (codice_originale / descrizione_originale), senza toccare
// materiali, quantità, costi né giacenze. Ogni riga si abbina alla riga del PDF con la stessa quantità e lo stesso costo
// (nell'ordine del DDT); altrimenti a quella nella stessa posizione.

const r2 = (x: unknown) => Math.round(Number(x ?? 0) * 100) / 100;

/** Restituisce quante righe sono state completate (0 se non serviva o il PDF non c'è) */
export async function recuperaOriginali(ddtId: number): Promise<number> {
  const { data: ddt, error } = await supabase.from("ddt_acquisto").select("id, pdf").eq("id", ddtId).maybeSingle();
  if (error) throw new Error(/codice_originale/.test(error.message) ? "Esegui prima su Supabase lo script 0064" : error.message);
  if (!ddt?.pdf) return 0;
  const { data: righe, error: e2 } = await supabase.from("righe_ddt_acquisto").select("id, ordine, quantita, costo, codice_originale, descrizione_originale").eq("ddt_id", ddtId).order("ordine");
  if (e2) throw new Error(/codice_originale|descrizione_originale/.test(e2.message) ? "Esegui prima su Supabase lo script 0064" : e2.message);
  const mancanti = (righe ?? []).filter((r) => !r.descrizione_originale);
  if (!mancanti.length) return 0;
  const { data: file, error: e3 } = await supabase.storage.from("ddt_acquisto").download(String(ddt.pdf));
  if (e3 || !file) return 0;
  const letto = leggiDdt(await scritteDaPdf(file));
  if (!letto?.righe.length) return 0;
  const usate = new Set<number>();
  let fatte = 0;
  for (const [i, r] of (righe ?? []).entries()) {
    if (r.descrizione_originale) continue;
    let k = letto.righe.findIndex((p, j) => !usate.has(j) && r2(p.quantita) === r2(r.quantita) && Math.abs(Number(p.prezzo) - Number(r.costo ?? 0)) < 0.011);
    if (k < 0 && i < letto.righe.length && !usate.has(i)) k = i;
    if (k < 0) continue;
    usate.add(k);
    const p = letto.righe[k];
    const { error: e4 } = await supabase.from("righe_ddt_acquisto")
      .update({ codice_originale: p.codice?.trim() || null, descrizione_originale: p.descrizione?.trim() || null }).eq("id", r.id);
    if (!e4) fatte++;
  }
  return fatte;
}
