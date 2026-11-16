// Preventivo guidato: catalogo delle voci d'impianto (con prezzo a punto e kit di materiali facoltativo)
// e ambienti tipo (Cucina, Camera, Bagno…) con le loro voci e quantità.
import { supabase } from "./supabase";

export type TipoImpianto = "elettrico" | "idraulico";
export const NOMI_TIPO: Record<TipoImpianto, string> = { elettrico: "Impianto elettrico", idraulico: "Impianto idraulico" };

export type MaterialeKit = { id?: number; materiale_id: number; quantita: number; descrizione: string; unita_misura: string | null; prezzo: number };
export type VoceImpianto = { id: number; tipo: TipoImpianto; nome: string; unita: string; prezzo: number | null; ordine: number; attiva: boolean; moduli: number; kit: MaterialeKit[] };
export type AmbienteTipo = { id: number; tipo: TipoImpianto; nome: string; ordine: number; scatole_3: number; scatole_4: number; voci: { voce_id: number; quantita: number }[] };
// Serie civile (placche e supporti): prezzi a pezzo per scatole da 3 e 4 moduli
export const COMPONENTI = ["supporto_3", "placca_3", "supporto_4", "placca_4", "copriforo"] as const;
export type Componente = (typeof COMPONENTI)[number];
export type MaterialeSerie = { id: number; descrizione: string; prezzo: number };
// I prezzi sono quelli del materiale collegato del catalogo (prezzo di vendita), altrimenti quelli scritti a mano
export type SerieCivile = { id: number; nome: string; prezzo_supporto_3: number; prezzo_supporto_4: number; prezzo_placca_3: number; prezzo_placca_4: number; prezzo_copriforo: number; ordine: number; attiva: boolean;
  collegati?: Partial<Record<Componente, MaterialeSerie>> };

// Foglio del preventivo (salvato nel preventivo per poterlo riaprire)
export type VoceFoglio = { voce_id: number | null; nome: string; unita: string; prezzo: number; quantita: number; moduli?: number; materiale_id?: number };
export type AmbienteFoglio = { chiave: string; nome: string; voci: VoceFoglio[]; scatole_3?: number; scatole_4?: number; ore?: number; tariffa?: TariffaFoglio | null };
export type TariffaFoglio = { nome: string; prezzo: number };
// La serie è copiata nel foglio (nome e prezzi) così riaprendo il preventivo i conti non cambiano
export type LavoroFoglio = { lavoro_id: number; chiave: string; marca?: string | null };
export type Foglio = { tipo: TipoImpianto; ambienti: AmbienteFoglio[]; serie?: Omit<SerieCivile, "ordine" | "attiva"> | null; lavori?: LavoroFoglio[]; tariffa_oraria?: number; tariffa_nome?: string };
export type Accessorio = { nome: string; breve: string; quantita: number; prezzo: number; materiale?: string };

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
  ].map((x, i) => ({ ...x, materiale: serie.collegati?.[(["supporto_3", "placca_3", "supporto_4", "placca_4", "copriforo"] as Componente[])[i]]?.descrizione })).filter((x) => x.quantita > 0);
}
/** Scatole stimate quando l'ambiente non le ha: circa 2 moduli per scatola da 3 */
export const stimaScatole = (moduli: number) => Math.ceil(moduli / 2);

/** Tariffa oraria di una sezione: la sua, altrimenti quella predefinita del foglio */
export const tariffaDi = (a: AmbienteFoglio, predefinita?: TariffaFoglio) => a.tariffa ?? predefinita ?? { nome: "Manodopera", prezzo: 0 };

export const totaleAmbiente = (a: AmbienteFoglio, serie?: Foglio["serie"], predefinita?: TariffaFoglio) =>
  r2(a.voci.reduce((t, v) => t + v.prezzo * v.quantita, 0) + accessoriAmbiente(a, serie).reduce((t, x) => t + x.prezzo * x.quantita, 0) + (a.ore ?? 0) * tariffaDi(a, predefinita).prezzo);

/** Riga della manodopera di una sezione (ore × tariffa oraria) */
export const manodopera = (a: AmbienteFoglio, predefinita?: TariffaFoglio) =>
  (a.ore ?? 0) > 0 ? [{ nome: `Manodopera – ${tariffaDi(a, predefinita).nome}`, unita: "ore", quantita: a.ore!, prezzo: tariffaDi(a, predefinita).prezzo, materiale_id: null }] : [];

// ---- Tariffe orarie dei preventivi ----
export type TariffaPreventivo = { id: number; nome: string; prezzo_ora: number; tipo: TipoImpianto | null; predefinita: boolean; ordine: number; attiva: boolean };

export async function leggiTariffe(): Promise<{ tariffe: TariffaPreventivo[]; manca: boolean }> {
  const { data, error } = await supabase.from("tariffe_preventivo").select("*").order("ordine").order("id");
  if (!error) return { tariffe: ((data ?? []) as TariffaPreventivo[]).map((t) => ({ ...t, prezzo_ora: Number(t.prezzo_ora) })), manca: false };
  // Script 0035 non ancora eseguito: si usa la tariffa "Standard" dei rapportini
  const { data: vecchie } = await supabase.from("tariffe").select("nome, tariffa_oraria").order("ordine");
  const t = (vecchie ?? []) as { nome: string; tariffa_oraria: number | null }[];
  const scelta = t.find((x) => /standard/i.test(x.nome) && x.tariffa_oraria) ?? t.find((x) => x.tariffa_oraria);
  return { tariffe: scelta ? [{ id: -1, nome: "Manodopera", prezzo_ora: Number(scelta.tariffa_oraria), tipo: null, predefinita: true, ordine: 0, attiva: true }] : [], manca: true };
}

export async function leggiSerie() {
  const conMateriali = "*, " + COMPONENTI.map((c) => `m_${c}:mat_${c}(id, descrizione, prezzo_ricaricato)`).join(", ");
  const q = (sel: string) => supabase.from("serie_civili").select(sel).order("ordine").order("id");
  let { data, error } = await q(conMateriali);
  if (error && /mat_|relationship/i.test(error.message)) ({ data, error } = await q("*")); // script 0033 non ancora eseguito
  if (error) throw new Error(/serie_civili/.test(error.message) ? "Esegui su Supabase lo script 0032_serie_civili.sql" : error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((x) => {
    const collegati: Partial<Record<Componente, MaterialeSerie>> = {};
    const serie = { ...x, collegati } as unknown as SerieCivile;
    for (const c of COMPONENTI) {
      const m = x[`m_${c}`] as { id: number; descrizione: string; prezzo_ricaricato: number } | null | undefined;
      if (m) collegati[c] = { id: m.id, descrizione: m.descrizione, prezzo: r2(Number(m.prezzo_ricaricato)) };
      serie[`prezzo_${c}`] = m ? r2(Number(m.prezzo_ricaricato)) : Number(x[`prezzo_${c}`] ?? 0);
      delete (serie as unknown as Record<string, unknown>)[`m_${c}`];
    }
    return serie;
  });
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

// ---- Lavori ("Cosa facciamo?": caldaia, clima, irrigazione…) con le categorie di materiali del catalogo ----
// "materiali": scelti uno per uno dal catalogo (si aggiungono a quelli trovati con "cerca")
export type CategoriaLavoro = { id: number; lavoro_id: number; nome: string; cerca: string | null; escludi: string | null; principale: boolean; segue_marca: boolean; ordine: number; materiali: number[] };
export type LavoroPreventivo = { id: number; tipo: TipoImpianto; nome: string; icona: string | null; ordine: number; attivo: boolean; categorie: CategoriaLavoro[] };

export async function leggiLavori(tipo: TipoImpianto) {
  const [{ data: l, error }, { data: c, error: e2 }] = await Promise.all([
    supabase.from("lavori_preventivo").select("*").eq("tipo", tipo).order("ordine").order("id"),
    supabase.from("lavori_categorie").select("*").order("ordine").order("id"),
  ]);
  if (error || e2) throw new Error(/lavori_/.test((error ?? e2)!.message) ? "Esegui su Supabase lo script 0034_lavori_preventivo.sql" : (error ?? e2)!.message);
  // Materiali scelti a mano (script 0036): se la tabella non c'è ancora si va avanti senza
  const { data: scelti } = await supabase.from("lavori_categorie_materiali").select("categoria_id, materiale_id, ordine").order("ordine");
  const cat = ((c ?? []) as Omit<CategoriaLavoro, "materiali">[]).map((k) => ({
    ...k, materiali: ((scelti ?? []) as { categoria_id: number; materiale_id: number }[]).filter((x) => x.categoria_id === k.id).map((x) => x.materiale_id),
  })) as CategoriaLavoro[];
  return ((l ?? []) as Omit<LavoroPreventivo, "categorie">[]).map((x) => ({ ...x, categorie: cat.filter((k) => k.lavoro_id === x.id) })) as LavoroPreventivo[];
}

/** Espressione di ricerca scritta nelle impostazioni (se è sbagliata si cerca il testo così com'è) */
export function espressione(testo: string | null | undefined) {
  if (!testo?.trim()) return null;
  try { return new RegExp(testo, "i"); } catch { return new RegExp(testo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
}

// Marche con le loro sigle nel catalogo (es. "IMG - …" = Immergas): servono a proporre prima gli accessori
// della stessa marca della caldaia o del climatizzatore scelto
const FAMIGLIE_MARCHE: string[][] = [
  ["RADIANT"], ["COSMOGAS", "COS"], ["IMMERGAS", "IMG"], ["BAXI", "BAX"], ["VAILLANT", "VAI"], ["FERROLI"], ["BERETTA", "BER"],
  ["JUNKERS"], ["BOSCH"], ["ARISTON", "ARI"], ["CHAFFOTEAUX"], ["RIELLO"], ["SIME"], ["UNICAL"], ["FONDITAL"], ["VIESSMANN", "VIE"],
  ["BIASI"], ["HERMANN"], ["SAUNIER DUVAL"], ["LAMINOX"], ["MITSUBISHI", "MITSU"], ["DAIKIN"], ["FUJITSU"], ["CLIVET"], ["LG"],
  ["SAMSUNG"], ["TOSHIBA"], ["HAIER"], ["HISENSE"], ["AERMEC"], ["OLIMPIA SPLENDID", "OLIMPIA"], ["DE LONGHI", "DELONGHI"],
  ["IRSAP", "IRP"], ["RAIN BIRD", "RB"], ["IRRITEC"], ["HUNTER"], ["NEWCO"], ["EUROACQUE"], ["CLIVET"],
];
const parola = (testo: string, p: string) => new RegExp(`(^|[^A-Z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9]|$)`).test(testo);

/** Marca di un materiale: sigla iniziale ("IMG - …") o nome di marca conosciuto nella descrizione */
export function marcaMateriale(descrizione: unknown): string | null {
  const d = String(descrizione ?? "").toUpperCase();
  const sigla = d.match(/^([A-Z][A-Z0-9 .&']{0,14}?)\s*[-–]\s/)?.[1].trim() ?? "";
  const famiglia = FAMIGLIE_MARCHE.find((f) => f.includes(sigla)) ?? FAMIGLIE_MARCHE.find((f) => f.some((p) => p.length >= 4 && parola(d, p)));
  return famiglia ? famiglia[0] : sigla || null;
}

/** Il materiale è della marca indicata (per sigla o perché la nomina, es. "KIT SDOPPIATORE RADIANT") */
export function stessaMarca(descrizione: unknown, marca: string) {
  const d = String(descrizione ?? "").toUpperCase();
  const famiglia = FAMIGLIE_MARCHE.find((f) => f[0] === marca) ?? [marca];
  const sigla = d.match(/^([A-Z][A-Z0-9 .&']{0,14}?)\s*[-–]\s/)?.[1].trim() ?? "";
  return famiglia.includes(sigla) || famiglia.some((p) => p.length >= 4 && parola(d, p));
}
