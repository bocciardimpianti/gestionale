// Lettura dei DDT di acquisto in PDF (PDF "veri" ricevuti per e-mail, non scansioni).
// Il testo viene letto con le sue coordinate. Alcuni fornitori hanno una lettura su misura del loro modello;
// tutti gli altri passano dalla lettura automatica, che cerca la tabella dalle intestazioni delle colonne.

export interface Scritta { s: string; x: number; y: number; pagina: number; w?: number }

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
  // Lettura automatica (nessuna lettura su misura): numero e data sono correggibili, il fornitore va cercato
  generico?: boolean;
  nomeFornitore?: string;
  pivaFornitore?: string;
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

// ---------------------------------------------------------------------------
// LETTURA AUTOMATICA per i fornitori senza lettura su misura (solo PDF con testo, non scansioni).
// Trova la riga di intestazione della tabella, assegna ogni valore alla sua colonna e, quando c'è l'importo,
// verifica quantità × prezzo. Ciò che non torna diventa errore o avviso: l'utente controlla sempre prima di salvare.
// ---------------------------------------------------------------------------
type Tipo = "codice" | "descrizione" | "um" | "quantita" | "prezzo" | "sconto" | "importo" | "iva";
interface Cella { s: string; x: number; fine: number }
interface Colonna { tipo: Tipo; x: number; fine: number }

const INTESTAZIONI: [Tipo, RegExp][] = [
  ["um", /^u\.?\s*\/?\s*m\.?$|^unit[àa'].*mis|^mis(ura)?\.?$/],
  ["quantita", /^q\.?\s*t[àa'y]?['.]?$|^q\.?t[àa]'?\.?$|^qta|quantit|^pezzi$|^n\.?\s*pezzi$/],
  ["descrizione", /descr|denominaz|^prodotto$/],
  ["prezzo", /prezzo|^p\.?\s*unit|^pr\.?\s*unit|^costo|^listino/],
  ["sconto", /^%?\s*sc(\.|\s|$)|sconto|sconti|^%$/],
  ["importo", /importo|^tot(ale|\.)?(\s|$)|^valore|^netto|ammontare/],
  ["iva", /(^|[\s.])i\.?v\.?a\.?($|\s)|^c\.?\s*iva|aliq/],
  ["codice", /^cod|^art(\.|icolo)?|^rif\.?|^ref\.?|^sku|^ean|^item/],
];
const tipoDi = (s: string) => INTESTAZIONI.find(([, re]) => re.test(s.trim().toLowerCase()))?.[0];
const TIPI_NUMERICI: Tipo[] = ["quantita", "prezzo", "sconto", "importo", "iva"];
const ALIQUOTE = [0, 4, 5, 10, 22];
const UM_NOTE = /^(pz|pc|nr|n|mt|ml|m|kg|gr|g|cf|lt|l|mq|rt|cp|pa|ct|sc|br|bs|cartone|conf|confezione|rotolo|paio|coppia|set|kit)\.?$/i;

// Numero scritto all'italiana o all'inglese, con eventuale € o %. "1.500" vale 1500; se non è un numero: null
export function numeroLibero(testo: string): number | null {
  const t = testo.replace(/[€%\s]/g, "").replace(/^eur/i, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t)) return numeroIt(t);
  if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(t)) return Number(t.replace(/,/g, ""));
  if (/^-?\d+\.\d{1,2}$/.test(t) || /^-?\d+\.\d{4,}$/.test(t) || /^-?\d+$/.test(t)) return Number(t);
  return null;
}

// Prezzo per centinaio o migliaio: "79,93/100"
function prezzoLibero(testo: string) {
  const m = testo.trim().match(/^(.+?)\s*\/\s*(1000|100|10)$/);
  const n = numeroLibero(m ? m[1] : testo);
  return n === null ? null : n / Number(m ? m[2] : 1);
}

// Sconti in cascata: "10+5" → 0,145
function scontoLibero(testo: string): number | null {
  const pezzi = testo.replace(/[%\s]/g, "").split("+");
  let resta = 1;
  for (const p of pezzi) {
    const n = numeroLibero(p);
    if (n === null || n < 0 || n >= 100) return null;
    resta *= 1 - n / 100;
  }
  return 1 - resta;
}

function cellaDa(e: Scritta): Cella[] {
  const larga = e.w && e.w > 0 ? e.w : e.s.length * 4.6;
  const passo = larga / Math.max(e.s.length, 1);
  const celle: Cella[] = [];
  const re = /\S+(?:\s\S+)*/g;
  for (let m = re.exec(e.s); m; m = re.exec(e.s)) {
    celle.push({ s: m[0], x: e.x + m.index * passo, fine: e.x + (m.index + m[0].length) * passo });
  }
  return celle;
}

// Colonne riconosciute in un gruppo di celle; una cella come "Codice Descrizione" viene divisa in parole
function colonneDa(celle: Cella[]) {
  const colonne: Colonna[] = [];
  for (const c of celle) {
    const intero = tipoDi(c.s);
    if (intero) { colonne.push({ tipo: intero, x: c.x, fine: c.fine }); continue; }
    const passo = (c.fine - c.x) / Math.max(c.s.length, 1);
    const re = /\S+/g;
    for (let m = re.exec(c.s); m; m = re.exec(c.s)) {
      const tipo = tipoDi(m[0]);
      if (tipo) colonne.push({ tipo, x: c.x + m.index * passo, fine: c.x + (m.index + m[0].length) * passo });
    }
  }
  colonne.sort((a, b) => a.x - b.x);
  // "Cod. Art." sono due parole della stessa colonna
  return colonne.filter((c, i) => !(i > 0 && colonne[i - 1].tipo === c.tipo && c.x - colonne[i - 1].fine < 6));
}
const eTabella = (c: Colonna[]) => {
  const t = new Set(c.map((x) => x.tipo));
  return t.has("quantita") && (t.has("descrizione") || t.has("codice"));
};

// Quale colonna contiene una cella: quella con la sovrapposizione maggiore, altrimenti la più vicina.
// La descrizione occupa tutto lo spazio libero fino alla colonna successiva.
function colonnaDi(c: Cella, colonne: Colonna[]) {
  let migliore = colonne[0];
  let punti = -Infinity;
  colonne.forEach((col, i) => {
    const fine = col.tipo === "descrizione" ? (colonne[i + 1]?.x ?? Infinity) - 2 : col.fine;
    const sovrapposizione = Math.min(c.fine, fine) - Math.max(c.x, col.x);
    if (sovrapposizione > punti) { punti = sovrapposizione; migliore = col; }
  });
  return migliore;
}

const dataDa = (testo: string) => {
  const m = testo.match(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/);
  if (!m) return "";
  const [g, me, a] = [Number(m[1]), Number(m[2]), Number(m[3].length === 2 ? `20${m[3]}` : m[3])];
  if (g < 1 || g > 31 || me < 1 || me > 12 || a < 2000 || a > new Date().getFullYear() + 1) return "";
  return `${a}-${String(me).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
};
// Riferimento di legge sui DDT, da non confondere con numero e data: "D.P.R. 472 del 14/08/1996"
const senzaLegge = (t: string) => t.replace(/d\.?\s*p\.?\s*r\.?\s*(n\.?\s*)?[\d/\s]*(del\s+[\d/.-]+)?/gi, " ");
const numeroValido = (v: string) => /\d/.test(v) && !dataDa(v) && !/^(IT)?\d{11}$/i.test(v) && v.length <= 25;

function testataGenerica(righe: { y: number; pagina: number; el: Scritta[] }[], out: DdtPdf) {
  const celleRiga = righe.map((r) => r.el.flatMap(cellaDa));
  const testi = righe.map((r) => senzaLegge(r.el.map((e) => e.s.trim()).join(" ")));
  // Cerca il valore accanto o sotto un'etichetta (es. "Numero" con il numero nella riga sotto)
  const vicino = (i: number, c: Cella, accetta: (s: string) => boolean) => {
    const accanto = celleRiga[i].filter((x) => x.x >= c.fine - 1).find((x) => accetta(x.s));
    if (accanto) return accanto.s;
    for (let j = i + 1; j < righe.length && righe[i].y - righe[j].y < 32 && righe[j].pagina === righe[i].pagina; j++) {
      const sotto = celleRiga[j].find((x) => accetta(x.s) && x.fine > c.x - 15 && x.x < c.fine + 15);
      if (sotto) return sotto.s;
    }
    return "";
  };
  let rigaNumero = -1;
  const inLinea = /(?:d\.?\s*d\.?\s*t\.?|document[oi]\s+di\s+trasporto|bolla(?:\s+di\s+consegna)?|documento)(?:\s+di\s+vendita)?\s*(?:n(?:r|um|umero)?\s*[.°º:]*)?\s*[:.]?\s*([A-Z]{0,4}[-/]?\d[\w/.-]*)/i;
  testi.some((t, i) => {
    const v = t.match(inLinea)?.[1]?.replace(/[.,:]+$/, "");
    if (v && numeroValido(v)) { out.numeroDdt = v; rigaNumero = i; return true; }
    return false;
  });
  const etichettaNumero = /^(n(r|um|umero)?\s*[.°º]*\s*(d\.?d\.?t\.?|doc\w*\.?|bolla)?|numero.*|d\.?d\.?t\.?)\s*:?$/i;
  if (!out.numeroDdt) celleRiga.some((celle, i) => celle.some((c) => {
    if (!etichettaNumero.test(c.s)) return false;
    const v = vicino(i, c, (s) => numeroValido(s) && !etichettaNumero.test(s));
    if (v) { out.numeroDdt = v; rigaNumero = i; }
    return !!v;
  }));
  if (!out.numeroDdt) testi.some((t, i) => {
    const v = t.match(/(?:^|\s)n(?:r|um|umero)?\s*[.°º:]+\s*([A-Z]{0,4}[-/]?\d[\w/.-]*)/i)?.[1];
    if (v && numeroValido(v)) { out.numeroDdt = v; rigaNumero = i; return true; }
    return false;
  });

  if (rigaNumero >= 0) out.data = dataDa(testi[rigaNumero]);
  if (!out.data) celleRiga.some((celle, i) => celle.some((c) => {
    if (!/^data\b.{0,15}$/i.test(c.s)) return false;
    out.data = dataDa(c.s) || dataDa(vicino(i, c, (s) => !!dataDa(s)));
    return !!out.data;
  }));
  if (!out.data) testi.some((t) => { out.data = dataDa(t); return !!out.data; });
}

// Nome e partita IVA di chi ha emesso il documento: la prima ragione sociale che non è la nostra
function mittenteGenerico(righe: { y: number; pagina: number; el: Scritta[] }[], out: DdtPdf) {
  const prima = righe.filter((r) => r.pagina === 1);
  const forma = /\b(s\.?\s?r\.?\s?l\.?s?|s\.?\s?p\.?\s?a\.?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?s\.?)(?![a-z])/i;
  const iRiga = prima.findIndex((r) => forma.test(r.el.map((e) => e.s).join(" ")) && !/bocciardi/i.test(r.el.map((e) => e.s).join(" ")));
  if (iRiga < 0) return;
  const riga = prima[iRiga];
  const cella = riga.el.flatMap(cellaDa).find((c) => forma.test(c.s));
  out.nomeFornitore = (cella?.s ?? riga.el.map((e) => e.s.trim()).join(" ")).replace(/\s+/g, " ").trim();
  // La partita IVA stampata più vicino alla ragione sociale
  const candidati = prima.flatMap((r, i) => [...r.el.map((e) => e.s).join(" ").matchAll(/(?<!\d)(?:IT\s?)?(\d{11})(?!\d)/gi)].map((m) => ({ piva: m[1], distanza: Math.abs(i - iRiga) })));
  out.pivaFornitore = candidati.sort((a, b) => a.distanza - b.distanza)[0]?.piva ?? "";
}

function generico(scritte: Scritta[]): DdtPdf {
  const out: DdtPdf = { modello: "Lettura automatica", generico: true, fornitore: /$^/, numeroDdt: "", data: "", note: "", righe: [], errori: [], avvisi: [] };
  const righe = righeDiTesto(scritte);
  const celleRiga = righe.map((r) => r.el.flatMap(cellaDa));

  // Intestazioni: una riga (o due vicine) con almeno quantità e descrizione/codice
  const inizi = new Map<number, { indice: number; colonne: Colonna[] }>();
  righe.forEach((r, i) => {
    if (inizi.has(r.pagina)) return;
    const qui = colonneDa(celleRiga[i]);
    if (qui.length < 2) return;
    const unite = [...celleRiga[i]];
    let ultimo = i;
    for (let j = i + 1; j < righe.length && righe[j].pagina === r.pagina && r.y - righe[j].y < 14; j++) {
      unite.push(...celleRiga[j]);
      ultimo = j;
    }
    const colonne = eTabella(qui) ? qui : colonneDa(unite);
    if (eTabella(colonne)) inizi.set(r.pagina, { indice: eTabella(qui) ? i : ultimo, colonne });
  });
  const primaTabella = [...inizi.values()][0];
  const prima = primaTabella ? righe.slice(0, primaTabella.indice) : righe.filter((r) => r.pagina === 1);
  testataGenerica(prima, out);
  mittenteGenerico(righe, out);

  const testo = scritte.map((x) => x.s).join(" ");
  if (/fattura|preventivo|offerta|conferma d.ordine/i.test(prima.map((r) => r.el.map((e) => e.s).join(" ")).join(" ")) && !/d\.?\s*d\.?\s*t\b|trasporto|bolla|consegna/i.test(testo))
    out.errori.push("Il documento non sembra un DDT: controlla che sia il PDF giusto");
  if (!out.numeroDdt) out.avvisi.push("Numero del documento non trovato: scrivilo nel campo qui sopra");
  if (!out.data) out.avvisi.push("Data del documento non trovata: scrivila nel campo qui sopra");
  if (!primaTabella) {
    out.errori.push("Tabella degli articoli non trovata: usa \"Correggi a mano\"");
    return out;
  }

  const FINE = /^(tot(ale|\.)?\b|imponibile|aspetto|causale|vettore|porto\b|annotazioni|firma|segue|peso|n\.?\s*colli|colli\b|scadenz|banca|contributo|pagamento|condizioni)/i;
  const NOTA = /^(rif\b|rif\.|vs\.?\s*ord|ns\.?\s*ord|ordine\b|ritira|note?\b)/i;
  const note: string[] = [];
  const importi: number[] = [];
  let senzaPrezzo = false;
  let ivaAssente = false;
  let colonne = primaTabella.colonne;
  let attiva = false;
  let finita = false;
  let paginaCorrente = 0;
  let yUltima = -1;

  righe.forEach((r, i) => {
    if (r.pagina !== paginaCorrente) {
      paginaCorrente = r.pagina;
      const inizio = inizi.get(r.pagina);
      if (inizio) colonne = inizio.colonne;
      // Pagina senza intestazioni: la tabella prosegue solo se non era già terminata
      attiva = !inizio && !finita && !!out.righe.length;
      finita = false;
      yUltima = -1;
    }
    const inizio = inizi.get(r.pagina);
    if (inizio && i <= inizio.indice) { if (i === inizio.indice) attiva = true; return; }
    if (!attiva || !celleRiga[i].length) return;
    const celle = celleRiga[i];
    const testoRiga = celle.map((c) => c.s).join(" ");
    if (/^(tot(ale|\.)?\b|imponibile)/i.test(celle[0].s)) { attiva = false; finita = true; return; }

    const valori: Record<Tipo, Cella[]> = { codice: [], descrizione: [], um: [], quantita: [], prezzo: [], sconto: [], importo: [], iva: [] };
    for (const c of celle) {
      let col = colonnaDi(c, colonne);
      // Numero allineato a destra che sconfina a sinistra della sua colonna
      const successiva = colonne[colonne.indexOf(col) + 1];
      if (col.tipo === "descrizione" && successiva && numeroLibero(c.s) !== null && TIPI_NUMERICI.includes(successiva.tipo) && c.fine > successiva.x - 30) col = successiva;
      if (TIPI_NUMERICI.includes(col.tipo) && col.tipo !== "sconto" && numeroLibero(c.s) === null && prezzoLibero(c.s) === null && !(col.tipo === "iva" && /\d/.test(c.s))) {
        // Testo finito in una colonna di numeri: unità di misura o seguito della descrizione
        if (UM_NOTE.test(c.s)) valori.um.push(c);
        else valori.descrizione.push(c);
      } else if (col.tipo === "um" && numeroLibero(c.s) !== null) valori.quantita.push(c);
      else valori[col.tipo].push(c);
    }
    const qtaTxt = valori.quantita.map((c) => numeroLibero(c.s)).filter((n): n is number => n !== null)[0] as number | undefined;

    if (qtaTxt === undefined) {
      if (FINE.test(celle[0].s)) { attiva = false; finita = true; return; }
      if (NOTA.test(testoRiga)) { note.push(testoRiga); return; }
      if (valori.codice.length && valori.descrizione.length && !valori.importo.length) {
        out.avvisi.push(`Riga senza quantità non importata: ${testoRiga}`);
        return;
      }
      if (out.righe.length && yUltima > 0 && yUltima - r.y < 16 && valori.descrizione.length === celle.length) {
        const ultima = out.righe[out.righe.length - 1];
        ultima.descrizione = `${ultima.descrizione} ${testoRiga}`.replace(/\s+/g, " ").trim();
        yUltima = r.y;
      } else yUltima = -1;
      return;
    }

    yUltima = r.y;
    const codici = valori.codice.map((c) => c.s);
    let descrizione = valori.descrizione.map((c) => c.s).join(" ").replace(/\s+/g, " ").trim();
    let um = valori.um.map((c) => c.s).join(" ").trim();
    if (!um) {
      const m = descrizione.match(/^(.*\S)\s+([A-Za-z]{1,4}\.?)$/);
      if (m && UM_NOTE.test(m[2])) { descrizione = m[1]; um = m[2]; }
    }
    um = um.replace(/\.$/, "").toUpperCase();
    let codice = codici[0] ?? "";
    if (!descrizione && codici.length > 1) descrizione = codici.slice(1).join(" ");
    // Colonna unica "Articolo" con il testo dell'articolo e nessuna descrizione separata
    if (!descrizione && /\s/.test(codice)) { descrizione = codice; codice = ""; }
    if (!descrizione && !codice) return;
    const etichetta = codice || descrizione.slice(0, 40);

    let quantita = qtaTxt;
    let prezzo = valori.prezzo.map((c) => prezzoLibero(c.s)).filter((n): n is number => n !== null)[0] ?? null;
    let importo = valori.importo.map((c) => numeroLibero(c.s)).filter((n): n is number => n !== null).pop() ?? null;
    const sconto = valori.sconto.map((c) => scontoLibero(c.s)).find((n) => n !== null) ?? 0;
    const netto = (q: number, p: number, sc: number) => q * p * (1 - sc);
    const torna = (q: number, p: number, sc: number, t: number) => Math.abs(netto(q, p, sc) - t) <= Math.max(0.011, Math.abs(q) * 0.005 + 0.011);
    const numeri = [...valori.quantita, ...valori.prezzo, ...valori.importo].sort((a, b) => a.x - b.x).map((c) => prezzoLibero(c.s)).filter((n): n is number => n !== null);
    const coerente = prezzo !== null && importo !== null && torna(quantita, prezzo, sconto, importo);
    if (!coerente && numeri.length >= 3) {
      // Colonne non allineate: si cerca tra i numeri della riga la terna quantità × prezzo = importo
      let trovata = false;
      for (let a = 0; a < numeri.length && !trovata; a++) for (let b = a + 1; b < numeri.length && !trovata; b++) for (let c = b + 1; c < numeri.length && !trovata; c++) {
        if (numeri[a] > 0 && torna(numeri[a], numeri[b], sconto, numeri[c])) {
          [quantita, prezzo, importo] = [numeri[a], numeri[b], numeri[c]];
          trovata = true;
        }
      }
      if (!trovata) out.errori.push(`Riga ${etichetta}: quantità, prezzo e importo non tornano (${numeri.join(" ")})`);
    }
    else if (!coerente && prezzo !== null && importo !== null) {
      out.errori.push(`Riga ${etichetta}: quantità × prezzo (${netto(quantita, prezzo, sconto).toFixed(2)}) diverso dall'importo (${importo.toFixed(2)})`);
    }
    // Il costo è quello netto: importo ÷ quantità se c'è l'importo, altrimenti il prezzo scontato
    let costoNetto = 0;
    if (importo !== null && quantita) costoNetto = Math.round((importo / quantita) * 10000) / 10000;
    else if (prezzo !== null) costoNetto = Math.round(netto(1, prezzo, sconto) * 10000) / 10000;
    else senzaPrezzo = true;

    const ivaTesto = valori.iva.map((c) => c.s.match(/\d+(?:[.,]\d+)?/)?.[0]).find(Boolean);
    const ivaLetta = ivaTesto ? numeroLibero(ivaTesto) : null;
    let iva = 22;
    if (ivaLetta !== null && ALIQUOTE.includes(ivaLetta)) iva = ivaLetta;
    else ivaAssente = true;

    if (!(quantita > 0)) out.errori.push(`Riga ${etichetta}: quantità non valida`);
    if (!um) out.avvisi.push(`Riga ${etichetta}: unità di misura non trovata`);
    if (importo !== null) importi.push(importo);
    out.righe.push({ codice, codiceProduttore: codici[1] && descrizione !== codici[1] ? codici[1] : "", descrizione, um, quantita, prezzo: costoNetto, importo, iva });
  });

  if (!out.righe.length) out.errori.push("Nessuna riga articolo trovata: usa \"Correggi a mano\"");
  if (senzaPrezzo) out.avvisi.push("Prezzi non presenti nel documento: le righe senza prezzo hanno costo 0");
  if (ivaAssente) out.avvisi.push("IVA non letta su alcune righe: impostata al 22%");

  // Controllo con il totale, se stampato: non bloccante perché può includere spese o IVA
  const somma = Math.round(importi.reduce((t, x) => t + x, 0) * 100) / 100;
  if (importi.length) {
    const totali = righe.flatMap((r, i) => /^(tot|imponibile)/i.test(celleRiga[i][0]?.s ?? "") || /totale|imponibile/i.test(r.el.map((e) => e.s).join(" "))
      ? celleRiga[i].map((c) => numeroLibero(c.s)).filter((n): n is number => n !== null) : []);
    if (totali.length && !totali.some((t) => Math.abs(t - somma) <= 0.02))
      out.avvisi.push(`La somma delle righe (${somma.toFixed(2)}) non compare tra i totali del documento: controlla che non manchino righe`);
  }
  out.note = note.join("\n");
  out.avvisi.unshift("Fornitore senza lettura dedicata: confronta righe, quantità e prezzi con il PDF prima di salvare");
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
  // Quasi nessun testo: è una scansione, non si può leggere
  if (tutto.replace(/\s/g, "").length < 30) return null;
  const m = MODELLI.find((x) => x.riconosci.test(tutto));
  return m ? m.leggi(scritte, nomeFile) : generico(scritte);
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
      scritte.push({ s: i.str, x: Math.round(i.transform[4]), y: Math.round(i.transform[5] * 10) / 10, pagina: n, w: i.width });
    }
  }
  return scritte;
}
