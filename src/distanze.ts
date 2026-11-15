// Distanza dei clienti dalla sede (in linea d'aria) e diritto di chiamata per fasce di km.
// Le posizioni si ricavano dall'indirizzo con OpenStreetMap (Nominatim): viene inviato solo l'indirizzo
// (via, numero, comune), mai il nome del cliente. Al massimo una richiesta al secondo, come chiede il servizio.
import { supabase } from "./supabase";

export type Posizione = { lat: number; lon: number; precisione: "indirizzo" | "comune" };
export type Fascia = { km_fino: number; importo: number };

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
let ultimaRichiesta = 0;

// Attesa tra una richiesta e l'altra (il servizio chiede al massimo una al secondo: si sta larghi)
async function turno() {
  const attesa = ultimaRichiesta + 1500 - Date.now();
  if (attesa > 0) await new Promise((r) => setTimeout(r, attesa));
  ultimaRichiesta = Date.now();
}

// Chi vuole sapere delle pause (es. la pagina Diritto di chiamata mostra "riprendo tra 30 secondi")
let avvisaPausa: ((secondi: number) => void) | null = null;
export const suPausaOpenStreetMap = (f: ((secondi: number) => void) | null) => { avvisaPausa = f; };

async function cerca(q: string): Promise<{ lat: number; lon: number } | null> {
  // Se OpenStreetMap chiede di rallentare (o per un momento non risponde) si aspetta e si riprova, sempre più a lungo
  const pause = [30, 60, 120, 300];
  for (let tentativo = 0; ; tentativo++) {
    await turno();
    let stato = 0;
    try {
      const r = await fetch(`${NOMINATIM}?format=jsonv2&limit=1&countrycodes=it&accept-language=it&q=${encodeURIComponent(q)}`);
      if (r.ok) {
        const d = (await r.json()) as { lat: string; lon: string }[];
        return d[0] ? { lat: Number(d[0].lat), lon: Number(d[0].lon) } : null;
      }
      stato = r.status;
    } catch {
      stato = -1; // nessuna risposta (spesso è il limite di richieste del servizio)
    }
    if (tentativo >= pause.length || (stato > 0 && stato !== 429 && stato < 500)) {
      throw new Error(stato === 403 ? "OpenStreetMap ha bloccato le richieste per oggi: riprova domani" : `OpenStreetMap non risponde${stato > 0 ? ` (${stato})` : ""}: riprova più tardi`);
    }
    avvisaPausa?.(pause[tentativo]);
    await new Promise((r) => setTimeout(r, pause[tentativo] * 1000));
  }
}

// "Via Volontari della Libertà N° 51, Empoli (FI)" → via "Via Volontari della Libertà 51", comune "Empoli", provincia "FI"
export function scomponiIndirizzo(indirizzo: string) {
  const pulito = indirizzo.replace(/\bN[°º.]?\s*(?=\d)/gi, "").replace(/\s+/g, " ").trim();
  const prov = /\(([A-Z]{2})\)\s*$/i.exec(pulito)?.[1]?.toUpperCase() ?? "";
  const senzaProv = pulito.replace(/\(([A-Z]{2})\)\s*$/i, "").trim();
  // Il CAP scritto da solo tra due virgole non fa parte né della via né del comune
  const parti = senzaProv.split(",").map((p) => p.trim()).filter((p) => p && !/^\d{5}$/.test(p));
  const comune = (parti.length > 1 ? parti[parti.length - 1] : "").replace(/^\d{5}\s*/, "");
  const via = parti.length > 1 ? parti.slice(0, -1).join(", ") : parti[0] ?? "";
  return { via, comune, prov };
}

/** Posizione di un indirizzo: prima con la via, se non si trova almeno il comune (meno preciso) */
export async function trovaPosizione(indirizzo: string): Promise<Posizione | null> {
  const { via, comune, prov } = scomponiIndirizzo(indirizzo);
  if (!via && !comune) return null;
  const luogo = [comune, prov].filter(Boolean).join(" ");
  const esatta = await cerca([via, luogo, "Italia"].filter(Boolean).join(", "));
  if (esatta) return { ...esatta, precisione: "indirizzo" };
  if (!comune) return null;
  const delComune = await cerca([comune, prov, "Italia"].filter(Boolean).join(", "));
  return delComune ? { ...delComune, precisione: "comune" } : null;
}

/** Distanza in linea d'aria in km */
export function distanzaKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Fascia della distanza: la prima con "fino a" maggiore o uguale; oltre l'ultima vale l'ultima */
export function fasciaPer(km: number, fasce: Fascia[]) {
  const ordinate = [...fasce].sort((a, b) => a.km_fino - b.km_fino);
  return ordinate.find((f) => km <= f.km_fino) ?? ordinate[ordinate.length - 1] ?? null;
}

export async function leggiSede(): Promise<(Posizione & { indirizzo: string }) | null> {
  const { data } = await supabase.from("impostazioni").select("valore").eq("chiave", "sede").maybeSingle();
  const v = data?.valore as { lat?: number; lon?: number; indirizzo?: string } | null;
  return v?.lat && v?.lon ? { lat: v.lat, lon: v.lon, indirizzo: v.indirizzo ?? "", precisione: "indirizzo" } : null;
}

export async function leggiFasce(): Promise<Fascia[]> {
  const { data } = await supabase.from("fasce_chiamata").select("km_fino, importo").order("km_fino");
  return (data ?? []).map((f) => ({ km_fino: Number(f.km_fino), importo: Number(f.importo) }));
}

/** Diritto di chiamata per un cliente: posizione (cercata e salvata se manca), distanza dalla sede e fascia */
export async function dirittoPerCliente(clienteId: number): Promise<{ importo: number; km: number; precisione: string } | { errore: string }> {
  const [sede, fasce, { data: c }] = await Promise.all([
    leggiSede(), leggiFasce(),
    supabase.from("clienti").select("id, indirizzo_fatturazione, lat, lon, geo_indirizzo, geo_precisione").eq("id", clienteId).maybeSingle(),
  ]);
  if (!sede || !fasce.length) return { errore: "" }; // funzione non ancora impostata: nessun messaggio
  if (!c) return { errore: "cliente non trovato" };
  const indirizzo = String(c.indirizzo_fatturazione ?? "").trim();
  let pos = c.lat != null && c.lon != null && c.geo_indirizzo === indirizzo ? { lat: Number(c.lat), lon: Number(c.lon), precisione: String(c.geo_precisione ?? "indirizzo") } : null;
  if (!pos) {
    if (!indirizzo) return { errore: "il cliente non ha l'indirizzo" };
    // Già cercato senza successo con lo stesso indirizzo: non si chiede di nuovo
    if (c.geo_indirizzo === indirizzo && c.geo_precisione === "non trovato") return { errore: "indirizzo del cliente non trovato sulla mappa" };
    const trovata = await trovaPosizione(indirizzo).catch(() => null);
    await supabase.rpc("salva_posizione_cliente", { p_id: clienteId, p_lat: trovata?.lat ?? null, p_lon: trovata?.lon ?? null, p_indirizzo: indirizzo, p_precisione: trovata?.precisione ?? "non trovato" });
    if (!trovata) return { errore: "indirizzo del cliente non trovato sulla mappa" };
    pos = trovata;
  }
  if (pos.lat == null || Number.isNaN(pos.lat)) return { errore: "indirizzo del cliente non trovato sulla mappa" };
  const km = distanzaKm(sede, pos);
  const f = fasciaPer(km, fasce);
  return f ? { importo: f.importo, km, precisione: pos.precisione } : { errore: "" };
}
