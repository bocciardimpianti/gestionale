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
  // Nuovi materiali di questo fornitore: codice interno = codice articolo del fornitore (es. CLLAT)
  codiceInternoDalFornitore?: boolean;
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

// ---------------------------------------------------------------------------
// MEF s.r.l.: "Documento di Trasporto nr° 6001366048" del "10.07.2026"
// Colonne: Pos | Codice articolo | Descrizione | U.M. | Quantità | Prezzo unitario (es. "15,08" o "79,93/100") | Totale €
// Il prezzo stampato è arrotondato: il costo esatto è totale ÷ quantità. Il totale del documento serve da controllo.
// ---------------------------------------------------------------------------
function mef(scritte: Scritta[]): DdtPdf {
  const out: DdtPdf = { modello: "MEF", fornitore: /\bmef\b/i, numeroDdt: "", data: "", note: "", righe: [], errori: [], avvisi: [] };
  const righe = righeDiTesto(scritte);
  const note: string[] = [];
  const testoRiga = (r: { el: Scritta[] }) => r.el.map((e) => e.s.trim()).join(" ");

  // Intestazione (prima pagina, in alto): numero e data
  for (const r of righe) {
    if (r.pagina !== 1 || r.y < 600) continue;
    for (const e of r.el) {
      const t = e.s.trim();
      if (!out.numeroDdt && /^\d{9,12}$/.test(t)) out.numeroDdt = t;
      const d = t.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!out.data && d) out.data = `${d[3]}-${d[2]}-${d[1]}`;
    }
  }
  if (!out.numeroDdt) out.errori.push("Numero del documento non trovato");
  if (!out.data) out.errori.push("Data del documento non trovata");
  if (!/Documento di Trasporto/i.test(scritte.map((x) => x.s).join(" "))) out.errori.push("Il documento non è un Documento di Trasporto");

  // Numero ripetuto in fondo alla pagina (es. "6 0 0 1 3 6 6 0 4 8"): controllo
  const controlli = righe.filter((r) => r.y < 40).flatMap((r) => r.el.map((e) => e.s.replace(/\s/g, ""))).filter((t) => /^\d{9,12}$/.test(t));
  if (controlli.length && controlli.some((c) => c !== out.numeroDdt)) out.errori.push(`Il numero del documento non corrisponde a quello stampato in fondo alla pagina (${controlli[0]})`);

  // Totale del documento (numero seguito da "€" nel riquadro TOTALE): si prende l'ultimo
  let totaleDoc: number | null = null;
  for (const r of righe) {
    const iEuro = r.el.findIndex((e) => e.s.trim() === "€");
    if (iEuro > 0 && eNumeroIt(r.el[iEuro - 1].s.trim()) && r.el[iEuro - 1].x > 400) totaleDoc = numeroIt(r.el[iEuro - 1].s.trim());
  }

  // Righe articolo, tra l'intestazione delle colonne e "ASPETTO ESTERIORE" di ogni pagina
  let inTabella = false;
  let dopoRiferimento = false;
  let posVisti = 0;
  for (const r of righe) {
    const testo = testoRiga(r);
    if (/^POS\b.*DESCRIZIONE/i.test(testo)) { inTabella = true; continue; }
    if (/^ASPETTO ESTERIORE/i.test(testo)) { inTabella = false; continue; }
    if (!inTabella) continue;
    if (/^RIFERIMENTO ORDINE/i.test(testo)) { note.push(testo); dopoRiferimento = true; continue; }
    const el = r.el;
    const pos = el[0].x < 58 && /^\d{1,4}$/.test(el[0].s.trim());
    if (pos && el.length >= 5) {
      posVisti++;
      dopoRiferimento = false;
      const codice = el[1].s.trim();
      const [qta, prezzoTxt, totaleTxt] = el.slice(-3).map((e) => e.s.trim());
      const pezzi = el.slice(2, -3).map((e) => e.s.trim());
      let um = pezzi.length > 1 && /^[A-Z]{1,4}$/.test(pezzi[pezzi.length - 1]) ? pezzi.pop()! : "";
      let descrizione = pezzi.join(" ").replace(/\s+/g, " ").trim();
      if (!um) {
        const m = descrizione.match(/^(.*?)\s+([A-Z]{1,4})$/);
        if (m) { descrizione = m[1]; um = m[2]; }
      }
      const prezzoM = prezzoTxt.match(/^([\d.,]+)(?:\/(\d+))?$/);
      if (!eNumeroIt(qta) || !eNumeroIt(totaleTxt) || !prezzoM || !eNumeroIt(prezzoM[1])) {
        out.errori.push(`Riga ${codice}: valori non leggibili (${qta} ${prezzoTxt} ${totaleTxt})`);
        continue;
      }
      const quantita = numeroIt(qta);
      const totale = numeroIt(totaleTxt);
      const prezzoStampato = numeroIt(prezzoM[1]) / Number(prezzoM[2] ?? 1);
      const riga: RigaPdf = {
        codice, codiceProduttore: "", descrizione, um, quantita,
        prezzo: quantita ? Math.round((totale / quantita) * 10000) / 10000 : 0, importo: totale, iva: 22,
      };
      if (!(quantita > 0)) out.errori.push(`Riga ${codice}: quantità non valida`);
      if (Math.abs(prezzoStampato * quantita - totale) > quantita * 0.005 + 0.011)
        out.errori.push(`Riga ${codice}: quantità × prezzo (${(prezzoStampato * quantita).toFixed(2)}) diverso dal totale (${totale.toFixed(2)})`);
      if (!um) out.avvisi.push(`Riga ${codice}: unità di misura non trovata`);
      out.righe.push(riga);
      continue;
    }
    // Testo sotto il riferimento ordine (es. nome di chi ritira) o seconda riga della descrizione
    if (el.every((e) => e.x >= 140 && e.x < 350)) {
      if (dopoRiferimento || !out.righe.length) note.push(testo);
      else out.righe[out.righe.length - 1].descrizione += " " + testo;
    }
  }
  if (!out.righe.length) out.errori.push("Nessuna riga articolo trovata");
  if (posVisti !== out.righe.length) out.errori.push(`Righe lette ${out.righe.length} su ${posVisti}`);
  const somma = Math.round(out.righe.reduce((t, x) => t + (x.importo ?? 0), 0) * 100) / 100;
  if (totaleDoc === null) out.errori.push("Totale del documento non trovato");
  else if (Math.abs(somma - totaleDoc) > 0.005) out.errori.push(`La somma delle righe (${somma.toFixed(2)}) non corrisponde al totale del documento (${totaleDoc.toFixed(2)})`);
  out.note = note.join("\n");
  return out;
}

// ---------------------------------------------------------------------------
// CLLAT: modulo prestampato, nel PDF ci sono solo i dati. Riga di testata "DESTINATARIO|MITTENTE  VENDITA  1  8361  13/10/26",
// righe: Codice CLLAT | Codice fornitore (produttore) | Descrizione | UM | Quantità | Prezzo (netto, 5 decimali).
// Nessun totale: controlli su data ripetuta in fondo e numero/anno nel nome del file (es. "001D_20260008361.pdf").
// ---------------------------------------------------------------------------
function cllat(scritte: Scritta[], nomeFile = ""): DdtPdf {
  const out: DdtPdf = { modello: "CLLAT", fornitore: /cllat/i, codiceInternoDalFornitore: true, numeroDdt: "", data: "", note: "", righe: [], errori: [], avvisi: [] };
  const righe = righeDiTesto(scritte);
  const note: string[] = [];
  const anno = (aa: string) => (aa.length === 2 ? `20${aa}` : aa);

  // Testata: riga con "VENDITA", numero e data gg/mm/aa
  let yTestata = -1;
  for (const r of righe) {
    if (!r.el.some((e) => /^VENDITA$/i.test(e.s.trim()))) continue;
    for (const e of r.el) {
      const t = e.s.trim();
      const d = t.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
      if (d) out.data = `${anno(d[3])}-${d[2]}-${d[1]}`;
      else if (e.x > 400 && /^\d{1,9}$/.test(t)) out.numeroDdt = t.replace(/^0+(?=\d)/, "");
    }
    yTestata = r.y;
    break;
  }
  if (!out.numeroDdt) out.errori.push("Numero del documento non trovato");
  if (!out.data) out.errori.push("Data del documento non trovata");

  // Controlli: data ripetuta in fondo (gg.mm.aa) e nome del file
  const dateInFondo = righe.filter((r) => r.y < 300).flatMap((r) => r.el.map((e) => e.s.trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/))).filter(Boolean) as RegExpMatchArray[];
  if (out.data && dateInFondo.length && !dateInFondo.some((d) => `${anno(d[3])}-${d[2]}-${d[1]}` === out.data))
    out.errori.push(`La data del documento non corrisponde a quella stampata in fondo (${dateInFondo[0][0]})`);
  const f = nomeFile.match(/_(\d{4})(\d{7})\b/);
  if (f && out.numeroDdt && (String(Number(f[2])) !== out.numeroDdt || (out.data && !out.data.startsWith(f[1]))))
    out.errori.push(`Numero o anno non corrispondono al nome del file (${nomeFile})`);

  // Righe: codice numerico a sinistra; in fondo alla riga UM, quantità e prezzo
  let ultimaY = -1;
  let codiciVisti = 0;
  let fine = false;
  for (const r of righe) {
    if (fine || yTestata < 0 || r.y >= yTestata) continue;
    const el = r.el;
    const testo = el.map((e) => e.s.trim()).join(" ");
    // "Punti ddt …": fine delle righe articolo
    if (/^Punti ddt/i.test(testo)) { fine = true; continue; }
    if (el[0].x < 60 && /^\d{5,9}$/.test(el[0].s.trim()) && el.length >= 4) {
      codiciVisti++;
      ultimaY = r.y;
      const [qta, prezzo] = el.slice(-2).map((e) => e.s.trim());
      const pezzi = el.slice(1, -2).map((e) => ({ s: e.s.trim(), x: e.x }));
      const um = pezzi.length && /^[A-Z]{1,4}$/.test(pezzi[pezzi.length - 1].s) ? pezzi.pop()!.s : "";
      const codProd = pezzi.length && pezzi[0].x < 160 ? pezzi.shift()!.s : "";
      const descrizione = pezzi.map((p) => p.s).join(" ").replace(/\s+/g, " ").trim();
      const codice = el[0].s.trim();
      if (!eNumeroIt(qta) || !eNumeroIt(prezzo)) { out.errori.push(`Riga ${codice}: valori non leggibili (${qta} ${prezzo})`); continue; }
      const riga: RigaPdf = { codice, codiceProduttore: codProd, descrizione, um, quantita: numeroIt(qta), prezzo: numeroIt(prezzo), importo: null, iva: 22 };
      if (!(riga.quantita > 0)) out.errori.push(`Riga ${codice}: quantità non valida`);
      if (!um) out.avvisi.push(`Riga ${codice}: unità di misura non trovata`);
      out.righe.push(riga);
      continue;
    }
    // Riga subito sotto (stessa spaziatura): seguito della descrizione; più distante: nota (es. chi ha ritirato)
    if (out.righe.length && ultimaY > 0 && ultimaY - r.y < 12 && el.every((e) => e.x >= 150 && e.x < 415)) {
      out.righe[out.righe.length - 1].descrizione += " " + testo;
      ultimaY = r.y;
      continue;
    }
    ultimaY = -1;
    if (out.righe.length && r.y > 250 && el.every((e) => e.x >= 150 && e.x < 415)) note.push(testo);
  }
  if (!out.righe.length) out.errori.push("Nessuna riga articolo trovata");
  if (codiciVisti !== out.righe.length) out.errori.push(`Righe lette ${out.righe.length} su ${codiciVisti}`);
  out.note = note.join("\n");
  return out;
}

// Letture disponibili: si riconosce il fornitore dal testo del PDF
const MODELLI: { nome: string; riconosci: RegExp; leggi: (s: Scritta[], nomeFile?: string) => DdtPdf }[] = [
  { nome: "Palagini", riconosci: /PALAGINI PIERO & FIGLI/i, leggi: palagini },
  { nome: "MEF", riconosci: /MEF S\.r\.l\. - Società/i, leggi: mef },
  { nome: "CLLAT", riconosci: /Punti ddt \d+, totale punti/i, leggi: cllat },
];

export const MODELLI_DISPONIBILI = MODELLI.map((m) => m.nome);

export function leggiDdt(scritte: Scritta[], nomeFile = ""): DdtPdf | null {
  const tutto = scritte.map((s) => s.s).join(" ");
  const m = MODELLI.find((x) => x.riconosci.test(tutto));
  return m ? m.leggi(scritte, nomeFile) : null;
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
