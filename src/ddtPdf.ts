// Lettura dei DDT di acquisto in PDF (PDF "veri" ricevuti per e-mail, non scansioni).
// Il testo viene letto con le sue coordinate; per ogni fornitore c'è una lettura su misura del suo modello.

export interface Scritta { s: string; x: number; y: number; pagina: number }

export interface RigaPdf {
  codice: string; // codice articolo del fornitore
  codiceProduttore: string;
  descrizione: string;
  um: string;
  quantita: number;
  prezzo: number;
  importo: number | null;
  iva: number;
}

export interface DdtPdf {
  modello: string; // nome della lettura usata (es. "Palagini")
  fornitore: RegExp; // per trovare il fornitore in anagrafica
  numeroDdt: string;
  data: string; // aaaa-mm-gg
  note: string;
  righe: RigaPdf[];
  // Errori: il documento non può essere importato così com'è
  errori: string[];
  // Avvisi: da controllare ma non bloccanti
  avvisi: string[];
}

// Numero all'italiana: "1.109,66" → 1109.66
export const numeroIt = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const eNumeroIt = (s: string) => /^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s.trim());
// Testo con caratteri "cifrati" (intestazioni con caratteri non leggibili): si ignora
const cifrato = (s: string) => (s.match(/[!"#$%&()*+;<=>?@\\^_`{|}~]/g)?.length ?? 0) > s.length * 0.25;

// Raggruppa le scritte in righe (stessa altezza), dall'alto verso il basso, pagina per pagina
export function righeDiTesto(scritte: Scritta[]) {
  const ord = [...scritte].sort((a, b) => a.pagina - b.pagina || b.y - a.y || a.x - b.x);
  const righe: { y: number; pagina: number; el: Scritta[] }[] = [];
  for (const s of ord) {
    const r = righe[righe.length - 1];
    if (r && r.pagina === s.pagina && Math.abs(r.y - s.y) < 2) r.el.push(s);
    else righe.push({ y: s.y, pagina: s.pagina, el: [s] });
  }
  for (const r of righe) r.el.sort((a, b) => a.x - b.x);
  return righe;
}

// ---------------------------------------------------------------------------
// PALAGINI PIERO & FIGLI: bolle "BL-VEN-0012877" (le offerte "XC-STD-…" non sono DDT)
// Colonne: Art. | Art. Cod. Fornitore | Descrizione | UM | Quantità | Prezzo | Importo | IVA
// ---------------------------------------------------------------------------
function palagini(scritte: Scritta[]): DdtPdf {
  const out: DdtPdf = { modello: "Palagini", fornitore: /palagini\s+piero/i, numeroDdt: "", data: "", note: "", righe: [], errori: [], avvisi: [] };
  const righe = righeDiTesto(scritte);
  const note: string[] = [];
  let tipo = "";
  let codiceDocumento = "";
  let codiceAControllo = "";

  // Intestazione: numero documento e data sulla stessa riga
  for (const r of righe) {
    const i = r.el.findIndex((e) => /^[A-Z]{2}-[A-Z]{3}-\d+$/.test(e.s.trim()));
    if (i < 0) continue;
    const [sigla, , numero] = r.el[i].s.trim().split("-");
    tipo = sigla;
    codiceDocumento = r.el[i].s.trim();
    out.numeroDdt = numero;
    const d = r.el.slice(i + 1).map((e) => e.s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)).find(Boolean);
    if (d) out.data = `${d[3]}-${d[2]}-${d[1]}`;
    break;
  }
  if (!out.numeroDdt) out.errori.push("Numero del documento non trovato");
  if (!out.data) out.errori.push("Data del documento non trovata");
  if (tipo && tipo !== "BL") out.errori.push(`Il documento ${codiceDocumento} non è un DDT (bolla) ma ${tipo === "XC" ? "un'offerta" : "un altro tipo di documento"}: non si carica in magazzino`);

  // Codice in fondo alla pagina (es. "855443KO 2610060017839001BL192475760"): contiene data e numero, serve da controllo
  for (const r of righe) for (const e of r.el) {
    const m = e.s.match(/\s(\d{2})(\d{2})(\d{2})(\d{7})\d{3}BL\d+/);
    if (m) codiceAControllo = `20${m[1]}-${m[2]}-${m[3]}|${m[4]}`;
  }
  if (codiceAControllo && codiceAControllo !== `${out.data}|${out.numeroDdt}`)
    out.errori.push(`Numero o data non corrispondono al codice di controllo del documento (${codiceAControllo.replace("|", " n. ")})`);

  // Righe articolo (solo sotto l'intestazione di ogni pagina): codice numerico a sinistra (x < 70), numeri a destra (x ≥ 400)
  const intestazione = new Map<number, number>();
  for (const r of righe) if (!intestazione.has(r.pagina) && r.el.some((e) => /^[A-Z]{2}-[A-Z]{3}-\d+$/.test(e.s.trim()))) intestazione.set(r.pagina, r.y);
  let inTabella = false;
  let codiciVisti = 0;
  for (const r of righe) {
    if (!(r.y < (intestazione.get(r.pagina) ?? -1) - 30)) continue;
    const el = r.el.filter((e) => !cifrato(e.s) && e.s.trim());
    if (!el.length) continue;
    const testo = el.map((e) => e.s.trim()).join(" ");
    if (/^-{10,}/.test(testo) || /^I dati raccolti/.test(testo)) { inTabella = false; continue; }
    const primo = el[0];
    const destra = el.filter((e) => e.x >= 400);
    const codice = primo.x < 70 && /^(?=.*\d)[A-Z0-9][A-Z0-9./-]{3,}$/i.test(primo.s.trim()) && destra.length >= 1;
    if (codice) {
      codiciVisti++;
      inTabella = true;
      const sinistra = el.filter((e) => e.x < 400);
      const numeri = destra.map((e) => e.s.trim());
      const pezzi = sinistra.slice(1).map((e) => e.s.trim());
      const codProd = sinistra[1] && sinistra[1].x < 180 ? pezzi.shift()! : "";
      let descrizione = pezzi.join(" ").replace(/\s+/g, " ").trim();
      let um = "";
      const m = descrizione.match(/^(.*?)\s*\b([A-Z]{1,4})$/);
      if (m) { descrizione = m[1]; um = m[2]; }
      if (!numeri.every(eNumeroIt)) { out.errori.push(`Riga ${primo.s}: valori non leggibili (${numeri.join(" ")})`); continue; }
      // Quantità, prezzo, (importo), iva
      const v = numeri.map(numeroIt);
      const riga: RigaPdf = {
        codice: primo.s.trim(), codiceProduttore: codProd, descrizione, um,
        quantita: v[0], prezzo: v[1], importo: v.length >= 4 ? v[2] : null, iva: v[v.length - 1],
      };
      if (v.length < 3) out.errori.push(`Riga ${riga.codice}: mancano quantità, prezzo o IVA`);
      if (!(riga.quantita > 0)) out.errori.push(`Riga ${riga.codice}: quantità non valida`);
      if (![0, 4, 5, 10, 22].includes(riga.iva)) out.errori.push(`Riga ${riga.codice}: IVA ${riga.iva}% non prevista`);
      if (riga.importo !== null && Math.abs(riga.quantita * riga.prezzo - riga.importo) > 0.011)
        out.errori.push(`Riga ${riga.codice}: quantità × prezzo (${(riga.quantita * riga.prezzo).toFixed(2)}) diverso dall'importo (${riga.importo.toFixed(2)})`);
      if (!um) out.avvisi.push(`Riga ${riga.codice}: unità di misura non trovata`);
      out.righe.push(riga);
      continue;
    }
    // Riferimenti (ordine, offerta) e chi ha ritirato: nelle note del DDT
    if (/^(Rif\.|RITIRA)/i.test(testo)) { note.push(testo); continue; }
    // Seconda riga della descrizione
    if (inTabella && out.righe.length && el.every((e) => e.x >= 170 && e.x < 400)) {
      const ultima = out.righe[out.righe.length - 1];
      ultima.descrizione = `${ultima.descrizione} ${testo}`.replace(/\s+/g, " ").trim();
      continue;
    }
  }
  if (!out.righe.length) out.errori.push("Nessuna riga articolo trovata");
  if (codiciVisti !== out.righe.length) out.errori.push(`Righe lette ${out.righe.length} su ${codiciVisti}`);
  out.note = note.join("\n");
  return out;
}

// Letture disponibili: si riconosce il fornitore dal testo del PDF
const MODELLI: { nome: string; riconosci: RegExp; leggi: (s: Scritta[]) => DdtPdf }[] = [
  { nome: "Palagini", riconosci: /PALAGINI PIERO & FIGLI/i, leggi: palagini },
];

export const MODELLI_DISPONIBILI = MODELLI.map((m) => m.nome);

export function leggiDdt(scritte: Scritta[]): DdtPdf | null {
  const tutto = scritte.map((s) => s.s).join(" ");
  const m = MODELLI.find((x) => x.riconosci.test(tutto));
  return m ? m.leggi(scritte) : null;
}

// Estrae le scritte con le coordinate da un file PDF (nel browser)
export async function scritteDaPdf(file: Blob): Promise<Scritta[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const scritte: Scritta[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const contenuto = await pagina.getTextContent();
    for (const i of contenuto.items) {
      if (!("str" in i) || !i.str.trim()) continue;
      scritte.push({ s: i.str, x: Math.round(i.transform[4]), y: Math.round(i.transform[5] * 10) / 10, pagina: n });
    }
  }
  return scritte;
}
