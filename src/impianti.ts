// Preventivo guidato: catalogo delle voci d'impianto (con prezzo a punto e kit di materiali facoltativo)
// e ambienti tipo (Cucina, Camera, Bagno…) con le loro voci e quantità.
import { supabase } from "./supabase";

export type TipoImpianto = "elettrico" | "idraulico";
export const NOMI_TIPO: Record<TipoImpianto, string> = { elettrico: "Impianto elettrico", idraulico: "Impianto idraulico" };

export type MaterialeKit = { id?: number; materiale_id: number; quantita: number; descrizione: string; unita_misura: string | null; prezzo: number };
export type VoceImpianto = { id: number; tipo: TipoImpianto; nome: string; unita: string; prezzo: number | null; ordine: number; attiva: boolean; kit: MaterialeKit[] };
export type AmbienteTipo = { id: number; tipo: TipoImpianto; nome: string; ordine: number; voci: { voce_id: number; quantita: number }[] };

// Foglio del preventivo (salvato nel preventivo per poterlo riaprire)
export type VoceFoglio = { voce_id: number | null; nome: string; unita: string; prezzo: number; quantita: number };
export type AmbienteFoglio = { chiave: string; nome: string; voci: VoceFoglio[] };
export type Foglio = { tipo: TipoImpianto; ambienti: AmbienteFoglio[] };

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Prezzo di una voce: quello a punto, altrimenti la somma del suo kit di materiali (prezzi di vendita del magazzino) */
export const prezzoVoce = (v: VoceImpianto) => (v.prezzo !== null && v.prezzo !== undefined ? Number(v.prezzo) : r2(v.kit.reduce((t, k) => t + k.prezzo * k.quantita, 0)));
export const totaleAmbiente = (a: AmbienteFoglio) => r2(a.voci.reduce((t, v) => t + v.prezzo * v.quantita, 0));

export async function leggiCatalogo(tipo?: TipoImpianto) {
  let qv = supabase.from("voci_impianto").select("id, tipo, nome, unita, prezzo, ordine, attiva").order("ordine").order("id");
  let qa = supabase.from("ambienti_tipo").select("id, tipo, nome, ordine").order("ordine").order("id");
  if (tipo) { qv = qv.eq("tipo", tipo); qa = qa.eq("tipo", tipo); }
  const [{ data: voci, error: e1 }, { data: amb, error: e2 }] = await Promise.all([qv, qa]);
  if (e1 || e2) throw new Error(/voci_impianto|ambienti_tipo/.test((e1 ?? e2)!.message) ? "Esegui su Supabase lo script 0031_preventivo_guidato.sql" : (e1 ?? e2)!.message);
  const idVoci = (voci ?? []).map((v) => v.id as number);
  const idAmb = (amb ?? []).map((a) => a.id as number);
  const [{ data: kit }, { data: av }] = await Promise.all([
    idVoci.length ? supabase.from("voci_impianto_kit").select("id, voce_id, materiale_id, quantita, materiale:materiali(descrizione, unita_misura, prezzo_ricaricato)").in("voce_id", idVoci) : Promise.resolve({ data: [] }),
    idAmb.length ? supabase.from("ambienti_tipo_voci").select("ambiente_id, voce_id, quantita").in("ambiente_id", idAmb) : Promise.resolve({ data: [] }),
  ]);
  const kitPer = new Map<number, MaterialeKit[]>();
  for (const k of (kit ?? []) as unknown as { id: number; voce_id: number; materiale_id: number; quantita: number; materiale: { descrizione: string; unita_misura: string | null; prezzo_ricaricato: number | null } | null }[]) {
    const l = kitPer.get(k.voce_id) ?? [];
    l.push({ id: k.id, materiale_id: k.materiale_id, quantita: Number(k.quantita), descrizione: k.materiale?.descrizione ?? "?", unita_misura: k.materiale?.unita_misura ?? null, prezzo: Number(k.materiale?.prezzo_ricaricato ?? 0) });
    kitPer.set(k.voce_id, l);
  }
  const vociAmb = new Map<number, { voce_id: number; quantita: number }[]>();
  for (const x of (av ?? []) as { ambiente_id: number; voce_id: number; quantita: number }[]) {
    const l = vociAmb.get(x.ambiente_id) ?? [];
    l.push({ voce_id: x.voce_id, quantita: Number(x.quantita) });
    vociAmb.set(x.ambiente_id, l);
  }
  return {
    voci: (voci ?? []).map((v) => ({ ...(v as Omit<VoceImpianto, "kit">), prezzo: v.prezzo === null ? null : Number(v.prezzo), kit: kitPer.get(v.id as number) ?? [] })) as VoceImpianto[],
    ambienti: (amb ?? []).map((a) => ({ ...(a as Omit<AmbienteTipo, "voci">), voci: vociAmb.get(a.id as number) ?? [] })) as AmbienteTipo[],
  };
}
