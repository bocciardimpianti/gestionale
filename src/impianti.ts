// Preventivo guidato: catalogo delle voci d'impianto (con prezzo a punto e kit di materiali facoltativo)
// e ambienti tipo (Cucina, Camera, Bagno…) con le loro voci e quantità.
import { supabase } from "./supabase";

export type TipoImpianto = "elettrico" | "idraulico";
export const NOMI_TIPO: Record<TipoImpianto, string> = { elettrico: "Impianto elettrico", idraulico: "Impianto idraulico" };

export type MaterialeKit = { id?: number; materiale_id: number; quantita: number; descrizione: string; unita_misura: string | null; prezzo: number };
export type VoceImpianto = { id: number; tipo: TipoImpianto; nome: string; unita: string; prezzo: number | null; ordine: number; attiva: boolean; moduli: number; kit: MaterialeKit[] };
export type AmbienteTipo = { id: number; tipo: TipoImpianto; nome: string; ordine: number; scatole_3: number; scatole_4: number; voci: { voce_id: number; quantita: number }[] };
// Serie civile (placche e supporti): prezzi a pezzo per scatole da 3 e 4 moduli
export type SerieCivile = { id: number; nome: string; prezzo_supporto_3: number; prezzo_supporto_4: number; prezzo_placca_3: number; prezzo_placca_4: number; prezzo_copriforo: number; ordine: number; attiva: boolean };

// Foglio del preventivo (salvato nel preventivo per poterlo riaprire)
export type VoceFoglio = { voce_id: number | null; nome: string; unita: string; prezzo: number; quantita: number; moduli?: number };
export type AmbienteFoglio = { chiave: string; nome: string; voci: VoceFoglio[]; scatole_3?: number; scatole_4?: number };
// La serie è copiata nel foglio (nome e prezzi) così riaprendo il preventivo i conti non cambiano
export type Foglio = { tipo: TipoImpianto; ambienti: AmbienteFoglio[]; serie?: Omit<SerieCivile, "ordine" | "attiva"> | null };
export type Accessorio = { nome: string; breve: string; quantita: number; prezzo: number };

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Prezzo di una voce: quello a punto, altrimenti la somma del suo kit di materiali (prezzi di vendita del magazzino) */
export const prezzoVoce = (v: VoceImpianto) => (v.prezzo !== null && v.prezzo !== undefined ? Number(v.prezzo) : r2(v.kit.reduce((t, k) => t + k.prezzo * k.quantita, 0)));
export const moduliOccupati = (a: AmbienteFoglio) => a.voci.reduce((t, v) => t + (v.moduli ?? 0) * v.quantita, 0);
export const postiScatole = (a: AmbienteFoglio) => 3 * (a.scatole_3 ?? 0) + 4 * (a.scatole_4 ?? 0);

/** Supporti, placche e copriforo di un ambiente: uno per scatola, copriforo = posti liberi (circa) */
export function accessoriAmbiente(a: AmbienteFoglio, serie: Foglio["serie"]): Accessorio[] {
  if (!serie) return [];
  const s3 = a.scatole_3 ?? 0, s4 = a.scatole_4 ?? 0;
  const copriforo = Math.max(0, postiScatole(a) - moduliOccupati(a));
  return [
    { nome: `Supporto 3 moduli ${serie.nome}`, breve: "Supporto 3M", quantita: s3, prezzo: Number(serie.prezzo_supporto_3) },
    { nome: `Placca 3 moduli ${serie.nome}`, breve: "Placca 3M", quantita: s3, prezzo: Number(serie.prezzo_placca_3) },
    { nome: `Supporto 4 moduli ${serie.nome}`, breve: "Supporto 4M", quantita: s4, prezzo: Number(serie.prezzo_supporto_4) },
    { nome: `Placca 4 moduli ${serie.nome}`, breve: "Placca 4M", quantita: s4, prezzo: Number(serie.prezzo_placca_4) },
    { nome: `Copriforo ${serie.nome}`, breve: "Copriforo (circa)", quantita: copriforo, prezzo: Number(serie.prezzo_copriforo) },
  ].filter((x) => x.quantita > 0);
}
/** Scatole stimate quando l'ambiente non le ha: circa 2 moduli per scatola da 3 */
export const stimaScatole = (moduli: number) => Math.ceil(moduli / 2);

export const totaleAmbiente = (a: AmbienteFoglio, serie?: Foglio["serie"]) =>
  r2(a.voci.reduce((t, v) => t + v.prezzo * v.quantita, 0) + accessoriAmbiente(a, serie).reduce((t, x) => t + x.prezzo * x.quantita, 0));

export async function leggiSerie() {
  const { data, error } = await supabase.from("serie_civili").select("*").order("ordine").order("id");
  if (error) throw new Error(/serie_civili/.test(error.message) ? "Esegui su Supabase lo script 0032_serie_civili.sql" : error.message);
  return (data ?? []).map((x) => ({ ...x, prezzo_supporto_3: Number(x.prezzo_supporto_3), prezzo_supporto_4: Number(x.prezzo_supporto_4), prezzo_placca_3: Number(x.prezzo_placca_3), prezzo_placca_4: Number(x.prezzo_placca_4), prezzo_copriforo: Number(x.prezzo_copriforo) })) as SerieCivile[];
}

export async function leggiCatalogo(tipo?: TipoImpianto) {
  const leggi = (conSerie: boolean) => {
    let qv = supabase.from("voci_impianto").select(`id, tipo, nome, unita, prezzo, ordine, attiva${conSerie ? ", moduli" : ""}`).order("ordine").order("id");
    let qa = supabase.from("ambienti_tipo").select(`id, tipo, nome, ordine${conSerie ? ", scatole_3, scatole_4" : ""}`).order("ordine").order("id");
    if (tipo) { qv = qv.eq("tipo", tipo); qa = qa.eq("tipo", tipo); }
    return Promise.all([qv, qa]);
  };
  // Senza lo script 0032 le colonne moduli/scatole non ci sono ancora: si legge senza
  let [{ data: voci, error: e1 }, { data: amb, error: e2 }] = await leggi(true);
  if (/moduli|scatole_/.test((e1 ?? e2)?.message ?? "")) [{ data: voci, error: e1 }, { data: amb, error: e2 }] = await leggi(false);
  if (e1 || e2) throw new Error(/voci_impianto|ambienti_tipo/.test((e1 ?? e2)!.message) ? "Esegui su Supabase lo script 0031_preventivo_guidato.sql" : (e1 ?? e2)!.message);
  const idVoci = ((voci ?? []) as unknown as { id: number }[]).map((v) => v.id);
  const idAmb = ((amb ?? []) as unknown as { id: number }[]).map((a) => a.id);
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
    voci: ((voci ?? []) as unknown as Record<string, unknown>[]).map((v) => ({ ...(v as Omit<VoceImpianto, "kit">), prezzo: v.prezzo === null ? null : Number(v.prezzo), moduli: Number(v.moduli ?? 0), kit: kitPer.get(v.id as number) ?? [] })) as VoceImpianto[],
    ambienti: ((amb ?? []) as unknown as Record<string, unknown>[]).map((a) => ({ ...(a as Omit<AmbienteTipo, "voci">), scatole_3: Number(a.scatole_3 ?? 0), scatole_4: Number(a.scatole_4 ?? 0), voci: vociAmb.get(a.id as number) ?? [] })) as AmbienteTipo[],
  };
}
