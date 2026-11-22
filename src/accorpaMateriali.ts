// Accorpamento dei materiali doppi (stesso pezzo inserito più volte, es. da Palagini e da CLLAT con nomi diversi).
// Regole (decise con il titolare), molto prudenti:
//  - RACCORDI: la marca non conta. Stesso pezzo = stesso tipo (tee, gomito, curva, manicotto…), stesse parole
//    significative (materiale, finitura, attacco: ottone giallo, a pressare, multistrato…), stesse misure nello
//    stesso ordine e stessi maschio/femmina. Se a uno manca l'indicazione M/F va nel gruppo solo se non c'è
//    nessun'altra variante possibile. Prezzi d'acquisto troppo diversi (oltre il doppio) = pezzi diversi: restano fuori.
//  - ALTRE CATEGORIE: solo descrizioni identiche (stessa marca compresa) e prezzi simili.
import { riordinaDescrizione } from "./descrizioniMateriali";

export type MaterialeA = Record<string, unknown> & { id: number };
export type Gruppo = { chiave: string; categoria: string; articoli: MaterialeA[]; tieni: number; esclusi: MaterialeA[]; motivo: string;
  // "sicuro": stesso pezzo; "da controllare": stesso tipo, materiale e misure ma con parole diverse (si conferma a mano)
  livello: "sicuro" | "da controllare" };
// Tipi di raccordo e materiali, per i possibili doppioni da controllare
const TIPI = ["TEE", "GOMITO", "CURVA", "MANICOTTO", "RIDUZIONE", "NIPLES", "TAPPO", "CALOTTA", "BOCCHETTONE", "BARILOTTO", "CROCE", "PORTAGOMMA", "PROLUNGA", "ADATTATORE", "GIUNTO", "RACCORDO", "DADO", "TRONCHETTO", "CANOTTO", "SELLA", "BRAGA", "ISPEZIONE", "TERMINALE"];
// Parole che distinguono due pezzi altrimenti uguali: se ci sono, devono esserci in tutti gli articoli del gruppo
const DISTINTIVE = ["DRITTO", "DIRITTO", "CURVO", "SALITA", "DISCESA", "DX", "SX", "DESTRO", "SINISTRO", "PAVIMENTO", "SOSPESO", "PARETE", "RIDOTTO", "RIDOTTA",
  "DOPPIO", "EUROCONO", "BICONO", "ANGOLO", "PIANA", "FLANGIATO", "ISOLATO", "PRESSARE", "SALDARE", "FILETTATO", "INNESTO", "COMPRESSIONE", "STRINGERE",
  "RAGGIO", "STRETTO", "LARGO", "INCOLLO", "INCOLLARE", "ISPEZIONE", "TAPPO", "GIREVOLE", "FISSO", "ORIENTABILE", "PORTAGOMMA", "ZANCA", "BORCHIA", "SFIATO", "TERMOMETRO"];
const MATERIALI = ["OTTONE", "RAME", "BRONZO", "MULTISTRATO", "PP", "PPR", "PE", "PEX", "PVC", "INOX", "ACCIAIO", "ZINCATO", "GHISA", "ALLUMINIO", "CROMATO", "NICHELATO", "PPSU"];

const SOGLIA_PREZZO = 2;   // il più caro costa più del doppio del più economico → non è lo stesso pezzo
const PAROLE_VUOTE = new Set(["CON", "PER", "IN", "A", "DI", "DA", "E", "AL", "ALLA", "DEL", "DELLA", "X", "TIPO", "SERIE", "MOD", "MOD.", "ART", "ART.", "FIG", "FIG.", "PZ", "N", "NR"]);
const SINONIMI: Record<string, string> = { NIPPLO: "NIPLES", NIPPLES: "NIPLES", NIPLO: "NIPLES", RID: "RIDOTTO", RIDUZ: "RIDUZIONE", FILETTATA: "FILETTATO", CROMATA: "CROMATO", DIRITTA: "DIRITTO", RACC: "RACCORDO" };

/** Sigla della marca ("GF - TEE…" → GF) e resto della descrizione */
function senzaMarca(d: string) {
  const m = d.match(/^([A-Z0-9 .&'-]{1,15}?) - (.*)$/);
  return m ? m[2] : d;
}

/** Firma del raccordo: parole significative (ordinate), TUTTE le misure in ordine, M/F; null se non si capisce */
export function firmaRaccordo(descrizione: unknown): { parole: string; misure: string; mf: string; marca: string } | null {
  const norm = riordinaDescrizione(String(descrizione ?? "")).nuova;
  const marca = norm.match(/^([A-Z0-9 .&'-]{1,15}?) - /)?.[1] ?? "";
  const d = senzaMarca(norm)
    .replace(/\bF\.F\.?(?![A-Z])/g, "FF").replace(/\bM\.F\.?(?![A-Z])/g, "MF").replace(/\bM\.M\.?(?![A-Z])/g, "MM")
    .replace(/\bMASCHIO\b/g, "M").replace(/\bFEMMINA\b/g, "F")
    .replace(/'(?=[MF]?\b)/g, '"');                                          // 3/4'M → 3/4"M
  const misure: string[] = []; const mf: string[] = []; const parole: string[] = [];
  // una misura: pollici, Ø, numero (con unità) + eventuali lettere M/F attaccate
  const MISURA = /^(?:Ø)?((?:\d{1,2} )?\d\/\d"|\d{1,2}"|\d+(?:[.,]\d+)?)(MM|mm|CM|cm|MT|°)?("?)([MF]{1,3})?$/;
  const pezzi = d.replace(/(\d)X(?=[\dØ])/g, "$1 X ").replace(/([\d"])X(?=[\dØ])/g, "$1 X ").split(/\s+/);
  for (let k = 0; k < pezzi.length; k++) {
    let t = pezzi[k].replace(/[,;.]+$/, "");
    if (!t || t === "X" || t === "-") continue;
    if (/^\d\/\d"?$/.test(t) && /^\d{1,2}$/.test(pezzi[k - 1] ?? "")) continue;        // già preso con l'intero (1 1/4")
    if (/^\d{1,2}$/.test(t) && /^\d\/\d"/.test(pezzi[k + 1] ?? "")) t = `${t} ${pezzi[++k]}`;
    const m = t.match(MISURA);
    if (m) {
      if (m[2] === "°") { parole.push(`${m[1]}°`); continue; }                          // angolo: è un tipo di raccordo
      const unita = /^(CM|cm|MT)$/.test(m[2] ?? "") ? m[2].toUpperCase() : "";
      const v = `${m[1].replace(",", ".")}${unita}`;
      if (misure[misure.length - 1] !== v) misure.push(v);                            // 1/2"X1/2" = 1/2"
      if (m[4]) mf.push(m[4]);
      continue;
    }
    if (/^(?:[MF]{1,3}|M\/F|F\/M|F\/F|M\/M|M-F|F-M|F-F|M-M)$/.test(t)) { mf.push(t.replace(/[\/-]/g, "")); continue; }
    const w = SINONIMI[t] ?? t;
    if (PAROLE_VUOTE.has(w)) continue;
    if (/^\d+$/.test(w)) { misure.push(w); continue; }
    parole.push(w);
  }
  const p2 = parole.filter((w, i, a) => !(w === "GIALLO" && a[i - 1] === "OTTONE"));   // OTTONE GIALLO = OTTONE
  if (!misure.length || !p2.length) return null;
  // F, FF, FFF (o M, MM, MMM) sono lo stesso: dipende solo da come è stato scritto
  let lettere = mf.join("").split("").sort().join("");
  if (/^F+$/.test(lettere)) lettere = "F"; else if (/^M+$/.test(lettere)) lettere = "M";
  return { parole: [...new Set(p2)].sort().join(" "), misure: misure.join(" X "), mf: lettere, marca };
}

const prezzo = (m: MaterialeA) => Number(m.prezzo_base) || 0;

/** Tiene insieme i prezzi compatibili (entro il doppio del prezzo più comune); gli altri restano fuori */
function perPrezzo(art: MaterialeA[]) {
  const conPrezzo = art.filter((m) => prezzo(m) > 0).sort((a, b) => prezzo(a) - prezzo(b));
  if (conPrezzo.length < 2) return { dentro: art, fuori: [] as MaterialeA[] };
  const mediana = prezzo(conPrezzo[Math.floor(conPrezzo.length / 2)]);
  const fuori = conPrezzo.filter((m) => prezzo(m) > mediana * SOGLIA_PREZZO || prezzo(m) * SOGLIA_PREZZO < mediana);
  return { dentro: art.filter((m) => !fuori.includes(m)), fuori };
}

/** Articolo da tenere: il più usato, poi con la foto, poi con più codici fornitore, poi il più vecchio */
function scegli(art: MaterialeA[], usi: Map<number, number>) {
  const codici = (m: MaterialeA) => `${m.codice_fornitore1 ?? ""} ${m.codice_fornitore2 ?? ""}`.replace(/[\/\s-]+/g, " ").trim().split(" ").filter(Boolean).length;
  return [...art].sort((a, b) => (usi.get(b.id) ?? 0) - (usi.get(a.id) ?? 0) || Number(!!b.foto) - Number(!!a.foto) || codici(b) - codici(a) || a.id - b.id)[0].id;
}

/** Gruppi di articoli da accorpare */
export function trovaDoppioni(materiali: MaterialeA[], usi = new Map<number, number>()): Gruppo[] {
  const gruppi: Gruppo[] = [];
  const attivi = materiali.filter((m) => !m.eliminato_il && String(m.descrizione ?? "").trim());
  // 1) Raccordi: per firma (la marca non conta)
  const raccordi = attivi.filter((m) => m.categoria === "Raccordi");
  const perFirma = new Map<string, { mf: string; marca: string; m: MaterialeA }[]>();
  for (const m of raccordi) {
    const f = firmaRaccordo(m.descrizione);
    if (!f) continue;
    const k = `${f.parole}|${f.misure}`;
    perFirma.set(k, [...(perFirma.get(k) ?? []), { mf: f.mf, marca: f.marca, m }]);
  }
  const usati = new Set<number>();
  for (const [k, lista] of perFirma) {
    if (lista.length < 2) continue;
    const varianti = [...new Set(lista.map((x) => x.mf).filter(Boolean))];
    for (const v of varianti.length ? varianti : [""]) {
      // senza M/F scritti: entrano solo se c'è una sola variante possibile E sono di un'altra marca
      // (nella stessa marca due nomi diversi indicano di solito due pezzi diversi, es. FUSIO GOMITO Ø20 e GOMITO MF Ø20)
      const conMf = lista.filter((x) => x.mf === v);
      const marcheConMf = new Set(conMf.map((x) => x.marca));
      const jolly = varianti.length <= 1 ? lista.filter((x) => !x.mf && (!x.marca || !marcheConMf.has(x.marca))) : [];
      const art = [...new Set([...conMf, ...jolly].map((x) => x.m))].filter((m) => !usati.has(m.id));
      if (art.length < 2) continue;
      const { dentro, fuori } = perPrezzo(art);
      if (dentro.length < 2) continue;
      dentro.forEach((m) => usati.add(m.id));
      gruppi.push({ chiave: `R|${k}|${v}`, categoria: "Raccordi", articoli: dentro, tieni: scegli(dentro, usi), esclusi: fuori,
        motivo: `stesso raccordo${v ? ` ${v}` : ""}, nomi o marche diverse`, livello: "sicuro" });
    }
  }
  // 2) Tutte le categorie: descrizioni identiche (dopo il riordino), marca compresa
  const perDescr = new Map<string, MaterialeA[]>();
  for (const m of attivi) {
    if (usati.has(m.id)) continue;
    const k = riordinaDescrizione(String(m.descrizione)).nuova;
    perDescr.set(k, [...(perDescr.get(k) ?? []), m]);
  }
  for (const [k, art] of perDescr) {
    if (art.length < 2) continue;
    const { dentro, fuori } = perPrezzo(art);
    if (dentro.length < 2) continue;
    // stessa descrizione ma prezzi lontani (oltre +50%): meglio guardarli prima di unirli
    const pr = dentro.map(prezzo).filter((x) => x > 0);
    const lontani = pr.length > 1 && Math.max(...pr) > Math.min(...pr) * 1.5;
    gruppi.push({ chiave: `D|${k}`, categoria: String(art[0].categoria ?? ""), articoli: dentro, tieni: scegli(dentro, usi), esclusi: fuori,
      motivo: lontani ? "stessa descrizione, prezzi diversi" : "stessa descrizione", livello: lontani ? "da controllare" : "sicuro" });
    dentro.forEach((m) => usati.add(m.id));
  }
  // 3) Possibili doppioni da controllare (raccordi): stesso tipo, materiale, misure e M/F, parole diverse
  const perTipo = new Map<string, MaterialeA[]>();
  for (const m of raccordi) {
    if (usati.has(m.id)) continue;
    const f = firmaRaccordo(m.descrizione);
    if (!f) continue;
    const w = f.parole.split(" ");
    const tipo = TIPI.find((t) => w.includes(t));
    const mat = MATERIALI.filter((x) => w.includes(x)).join("+");
    const angolo = w.filter((x) => x.endsWith("°")).join("+");
    if (!tipo || !mat) continue;
    const distintive = DISTINTIVE.filter((x) => w.includes(x)).join("+");
    const k = `${tipo}|${mat}|${angolo}|${distintive}|${f.misure}|${f.mf}`;
    perTipo.set(k, [...(perTipo.get(k) ?? []), m]);
  }
  for (const [k, art] of perTipo) {
    if (art.length < 2) continue;
    const { dentro, fuori } = perPrezzo(art);
    if (dentro.length < 2) continue;
    gruppi.push({ chiave: `C|${k}`, categoria: "Raccordi", articoli: dentro, tieni: scegli(dentro, usi), esclusi: fuori, motivo: "stesso tipo, materiale e misure, parole diverse", livello: "da controllare" });
  }
  // prima i sicuri, poi quelli da controllare
  return gruppi.sort((a, b) => Number(a.livello !== "sicuro") - Number(b.livello !== "sicuro") || a.chiave.localeCompare(b.chiave));
}

/** Codici fornitore uniti: per ogni fornitore tutti i codici (i DDT riconoscono l'articolo da uno qualsiasi) */
export function codiciUniti(tieni: MaterialeA, altri: MaterialeA[]) {
  const per = new Map<string, { nome: string; codici: string[] }>();
  const chiaveF = (n: unknown) => String(n ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  const aggiungi = (nome: unknown, codice: unknown) => {
    const n = String(nome ?? "").trim(), c = String(codice ?? "").trim();
    if (!c || c === "/" ) return;
    const k = chiaveF(n) || "ALTRO";
    const x = per.get(k) ?? { nome: n && n !== "/" ? n : "", codici: [] };
    for (const p of c.split(/\s+-\s+|\s*;\s*/).map((s) => s.trim()).filter((s) => s && s !== "/")) if (!x.codici.includes(p)) x.codici.push(p);
    if (!x.nome && n && n !== "/") x.nome = n;
    per.set(k, x);
  };
  for (const m of [tieni, ...altri]) { aggiungi(m.fornitore1, m.codice_fornitore1); aggiungi(m.fornitore2, m.codice_fornitore2); }
  const elenco = [...per.values()];
  // due posti: se i fornitori sono più di due, i codici in più vanno nel secondo
  const primo = elenco[0], secondo = elenco.slice(1);
  return {
    fornitore1: primo?.nome || (tieni.fornitore1 as string | null) || null,
    codice_fornitore1: primo?.codici.join(" - ") || null,
    fornitore2: secondo.map((x) => x.nome).filter(Boolean).join(" / ") || null,
    codice_fornitore2: secondo.flatMap((x) => x.codici).join(" - ") || null,
  };
}
