import { dataIt } from "./supabase";

// Dati dell'azienda in intestazione ai documenti
export const AZIENDA = {
  nome: "BOCCIARDI IMPIANTI S.R.L.",
  indirizzo: "VIA UGO FOSCOLO N° 6 - 56029, Staffoli (PI)",
  piva: "01721730503",
  telefono: "0571 37592",
  email: "info@bocciardimpianti.it",
};

// Indirizzo completo del logo (la stampa si apre in una finestra nuova)
export const logo = () => new URL("logo.png", location.href).href;

// Stampe interne (elenchi, scadenziario, agenda…): logo, dicitura di riservatezza in testa e in fondo a ogni pagina
export const DICITURA_RISERVATA = "Documento riservato – ad uso esclusivo interno";
export const stileRiservato = `
  .intestazione-riservata { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #123b45; padding-bottom: 6px; margin-bottom: 8px; }
  .intestazione-riservata img { height: 46px; }
  .intestazione-riservata .titoli { flex: 1; }
  .intestazione-riservata h1 { font-size: 16px; margin: 0; }
  .intestazione-riservata .data { font-size: 10px; color: #555; }
  .intestazione-riservata .riservato { border: 1.5px solid #b5431f; color: #b5431f; font-weight: 700; font-size: 10px; letter-spacing: .4px; padding: 3px 8px; text-transform: uppercase; }
  .piede-riservato { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 9px; color: #b5431f; }
  @media print { body { margin-bottom: 14mm; } }`;
export const intestazioneRiservata = (titolo: string) => `
  <div class="intestazione-riservata">
    <img src="${logo()}" alt="">
    <div class="titoli"><h1>${titolo}</h1><div class="data">${AZIENDA.nome} · stampato il ${new Date().toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</div></div>
    <div class="riservato">${DICITURA_RISERVATA}</div>
  </div>
  <div class="piede-riservato">${DICITURA_RISERVATA} – ${AZIENDA.nome}</div>`;

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const euro = (v: unknown) =>
  v === null || v === undefined || v === "" || Number(v) === 0
    ? ""
    : Number(v).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const num = (v: unknown) =>
  v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Rapporto di intervento, impaginato come il PDF del programma originale
export function stampaRapporto(d: Record<string, unknown>, righe: Record<string, unknown>[], senzaPrezzi = false) {
  // Senza il permesso "Totali": i materiali con i loro prezzi sì, i totali del documento no
  const ore = Number(d.totale_ore ?? 0) * Number(d.tariffa_oraria ?? 0);
  const km = Number(d.km_percorsi ?? 0) * Number(d.tariffa_km ?? 0);
  const imponibile = Number(d.imponibile ?? 0);
  const iva = Number(d.iva ?? 0);
  const totale = Number(d._totale ?? imponibile) * (1 + iva / 100);
  const titolo = `RAPPORTO INTERVENTO N. ${d.numero ?? ""} DEL ${dataIt(d.data)}`;

  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(titolo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font: 11px Calibri, Arial, sans-serif; color: #222; margin: 0; }
  .alto { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 12px; }
  .alto > * { min-width: 0; }
  /* Intestazione come nel programma originale: logo grande, dati aziendali sotto */
  .azienda img { height: 95px; margin-top: 6px; display: block; }
  .azienda h1 { color: #1e88e5; font-size: 17px; margin: 12px 0 4px; }
  .azienda div { font-size: 11.5px; line-height: 1.35; }
  .box { border: 1.5px solid #1e88e5; }
  .celle { display: grid; }
  .celle > div { border-right: 1px solid #1e88e5; padding: 2px 4px; min-height: 40px; }
  .celle > div:last-child { border-right: none; }
  .etichetta { font-size: 9.5px; }
  .valore { font-size: 13px; text-align: center; margin-top: 3px; }
  .grande { font-size: 15px; font-weight: 700; }
  .dest { background: #dcecfb; border: 1.5px solid #1e88e5; border-top: none; padding: 3px 4px; min-height: 70px; }
  .dest .nome { color: #1e88e5; font-size: 15px; font-weight: 700; margin: 6px 0 4px; }
  .riga { display: grid; border: 1.5px solid #1e88e5; border-top: none; }
  .riga > div { border-right: 1px solid #1e88e5; padding: 2px 4px; min-height: 36px; }
  .riga > div:last-child { border-right: none; }
  table.materiali { width: 100%; border-collapse: separate; border-spacing: 4px 0; margin-top: 8px; table-layout: fixed; }
  table.materiali th { background: #a9d1f5; font-size: 10px; padding: 2px; }
  table.materiali td { background: #dcecfb; padding: 3px 4px; vertical-align: top; }
  table.materiali td:nth-child(2) { background: #e9f3fd; }
  table.materiali tr.riempi td { height: ${Math.max(14, 180 - righe.length * 18)}px; }
  .tariffe { display: grid; grid-template-columns: repeat(6, 1fr); border: 1.5px solid #1e88e5; margin-top: 8px; }
  .tariffe > div { border-right: 1px solid #1e88e5; padding: 2px 4px; min-height: 40px; }
  .tariffe > div:last-child { border-right: none; }
  .tariffe .valore { text-align: right; }
  .totali { width: 36%; margin-left: auto; margin-top: 6px; }
  .totali > div { background: #e9f3fd; padding: 2px 4px; margin-bottom: 2px; min-height: 30px; }
  .totali .vuoto { background: #b9dbf8; min-height: 10px; }
  .totali .valore { text-align: right; font-size: 13px; }
  .totali .documento { background: #1e88e5; color: #fff; }
  .totali .documento .valore { font-weight: 700; font-size: 16px; }
  .annotazioni { background: #e9f3fd; padding: 3px 4px; min-height: 30px; margin-top: 6px; }
  .firma { width: 36%; margin-left: auto; margin-top: 6px; min-height: 50px; }
  .pagina { text-align: center; margin-top: 6px; font-size: 9px; }
  /* Righe dei materiali che non si spezzano a metà tra due pagine */
  table.materiali tr { break-inside: avoid; }
  .tariffe, .totali, .firma { break-inside: avoid; }
</style></head><body>
<div class="alto">
  <div class="azienda">
    <img src="${logo()}" alt="">
    <h1>${esc(AZIENDA.nome)}</h1>
    <div>${esc(AZIENDA.indirizzo)}<br>P.Iva/C.F.: ${esc(AZIENDA.piva)}<br>Tel. ${esc(AZIENDA.telefono)}<br>E-mail: ${esc(AZIENDA.email)}</div>
  </div>
  <div>
    <div class="box celle" style="grid-template-columns: 2fr 1fr">
      <div><div class="etichetta">Tipo Documento</div><div class="valore grande">Rapporto intervento</div></div>
      <div><div class="etichetta">Nr. Documento</div><div class="valore grande">${esc(d.numero)}</div></div>
    </div>
    <div class="box celle" style="grid-template-columns: repeat(5, 1fr); border-top: none">
      <div><div class="etichetta">Data</div><div class="valore">${dataIt(d.data)}</div></div>
      <div><div class="etichetta">Ora inizio</div><div class="valore">${esc(String(d.ora_inizio ?? "").slice(0, 5))}</div></div>
      <div><div class="etichetta">Ora fine</div><div class="valore">${esc(String(d.ora_fine ?? "").slice(0, 5))}</div></div>
      <div><div class="etichetta">Totale ore</div><div class="valore">${num(d.totale_ore)}</div></div>
      <div><div class="etichetta">KM percorsi</div><div class="valore">${d.km_percorsi ? num(d.km_percorsi) : ""}</div></div>
    </div>
    <div class="dest" style="margin-top: 6px; border-top: 1.5px solid #1e88e5">
      <div class="etichetta">Destinatario</div>
      <div class="nome">${esc(d.cliente)}</div>
      <div>P.Iva/C.F.: ${esc(d.cliente_piva)}</div>
      <div>E-mail: ${esc(d.cliente_email)}</div>
    </div>
  </div>
</div>
<div class="riga" style="grid-template-columns: 4fr 1.3fr; border-top: 1.5px solid #1e88e5">
  <div><div class="etichetta">Attività svolte</div><div style="font-size: 13px; margin: 4px 6px">${esc(d.attivita).replace(/\n/g, "<br>")}</div></div>
  <div><div class="etichetta">Tecnico</div></div>
</div>
<div class="riga" style="grid-template-columns: repeat(5, 1fr)">
  <div><div class="etichetta">Tipo impianto</div>${esc(d.tipo_impianto)}</div>
  <div><div class="etichetta">Impianto</div>${esc(d.impianto)}</div>
  <div><div class="etichetta">Marca</div>${esc(d.marca)}</div>
  <div><div class="etichetta">Modello</div>${esc(d.modello)}</div>
  <div><div class="etichetta">Matricola</div>${esc(d.matricola)}</div>
</div>
<table class="materiali">
  <thead><tr><th style="width: 42%">Descrizione</th><th style="width: 10%">Q.tà</th><th style="width: 7%">U.m.</th><th style="width: 18%"></th><th>Totale</th></tr></thead>
  <tbody>
    ${righe.map((r) => `<tr><td>${esc(r.descrizione || r.nome_articolo)}</td><td>${num(r.quantita)}</td><td style="text-align: center">${esc(r.unita_misura)}</td><td></td><td style="text-align: right">${euro(r.totale)}</td></tr>`).join("")}
    <tr class="riempi"><td></td><td></td><td></td><td></td><td></td></tr>
  </tbody>
</table>
${senzaPrezzi ? "" : `<div class="tariffe">
  <div><div class="etichetta">Diritto di chiamata</div><div class="valore">${euro(d.diritto_chiamata)}</div></div>
  <div><div class="etichetta">Tariffa fissa</div><div class="valore">${euro(d.tariffa_fissa)}</div></div>
  <div><div class="etichetta">Tariffa oraria</div><div class="valore">${euro(d.tariffa_oraria)}</div></div>
  <div><div class="etichetta">Tariffa KM</div><div class="valore">${euro(d.tariffa_km)}</div></div>
  <div><div class="etichetta">Totale prezzo per ore</div><div class="valore">${euro(ore)}</div></div>
  <div><div class="etichetta">Totale prezzo per KM</div><div class="valore">${euro(km)}</div></div>
</div>
<div class="totali">
  <div><div class="etichetta">Totale Parziale</div><div class="valore">${euro(imponibile) || "0,00 €"}</div></div>
  <div class="vuoto"></div>
  <div><div style="font-size: 13px">Imponibile</div><div class="valore">${euro(imponibile) || "0,00 €"}</div></div>
  <div style="background: none; min-height: 30px"><div class="etichetta">Iva ${iva ? num(iva) + "%" : ""}</div></div>
  <div class="documento"><div class="etichetta">Totale Documento</div><div class="valore">${euro(totale) || "0,00 €"}</div></div>
</div>`}
<div class="annotazioni"><div class="etichetta">Annotazioni</div>${esc(d.note).replace(/\n/g, "<br>")}</div>
<div class="firma"><div class="etichetta">Firma Cliente</div>${d._firma_url ? `<img src="${esc(d._firma_url)}" alt="" style="max-height: 70px; max-width: 100%">` : ""}</div>
<div class="pagina">Pagina: 1 / 1</div>
<script>window.onload = () => window.print()</script>
</body></html>`;
}

// Preventivo, con la stessa grafica del rapporto di intervento
export function stampaPreventivo(d: Record<string, unknown>, righe: Record<string, unknown>[], senzaPrezzi = false) {
  const titolo = `PREVENTIVO ${d.numero ?? ""} DEL ${dataIt(d.data)}`;
  const n = (v: unknown) => Number(v ?? 0);
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(titolo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font: 11px Calibri, Arial, sans-serif; color: #222; margin: 0; }
  .alto { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 12px; }
  .alto > * { min-width: 0; }
  /* Intestazione come nel programma originale: logo grande, dati aziendali sotto */
  .azienda img { height: 95px; margin-top: 6px; display: block; }
  .azienda h1 { color: #1e88e5; font-size: 17px; margin: 12px 0 4px; }
  .azienda div { font-size: 11.5px; line-height: 1.35; }
  .box { border: 1.5px solid #1e88e5; display: grid; }
  .box > div { border-right: 1px solid #1e88e5; padding: 2px 4px; min-height: 40px; }
  .box > div:last-child { border-right: none; }
  .etichetta { font-size: 9.5px; }
  .valore { font-size: 13px; text-align: center; margin-top: 3px; }
  .grande { font-size: 15px; font-weight: 700; }
  .dest { background: #dcecfb; border: 1.5px solid #1e88e5; padding: 3px 4px; min-height: 70px; margin-top: 6px; }
  .dest .nome { color: #1e88e5; font-size: 15px; font-weight: 700; margin: 6px 0 4px; }
  table.righe { width: 100%; border-collapse: separate; border-spacing: 4px 0; margin-top: 14px; }
  table.righe th { background: #a9d1f5; font-size: 10px; padding: 2px; }
  table.righe td { background: #dcecfb; padding: 3px 4px; vertical-align: top; }
  table.righe tr.riempi td { height: ${Math.max(40, 360 - righe.length * 18)}px; }
  .destra { text-align: right; }
  .totali { width: 40%; margin-left: auto; margin-top: 8px; }
  .totali > div { background: #e9f3fd; padding: 3px 6px; margin-bottom: 3px; display: flex; justify-content: space-between; font-size: 12.5px; }
  .totali .documento { background: #1e88e5; color: #fff; font-weight: 700; font-size: 15px; padding: 6px; }
  .annotazioni { background: #e9f3fd; padding: 3px 4px; min-height: 34px; margin-top: 10px; }
  .firma { width: 40%; margin-left: auto; margin-top: 14px; min-height: 60px; }
</style></head><body>
<div class="alto">
  <div class="azienda">
    <img src="${logo()}" alt="">
    <h1>${esc(AZIENDA.nome)}</h1>
    <div>${esc(AZIENDA.indirizzo)}<br>P.Iva/C.F.: ${esc(AZIENDA.piva)}<br>Tel. ${esc(AZIENDA.telefono)}<br>E-mail: ${esc(AZIENDA.email)}</div>
  </div>
  <div>
    <div class="box" style="grid-template-columns: 1fr 1.4fr 1fr">
      <div><div class="etichetta">Tipo Documento</div><div class="valore grande">Preventivo</div></div>
      <div><div class="etichetta">Oggetto</div><div class="valore grande">${esc(d.numero)}</div></div>
      <div><div class="etichetta">Data</div><div class="valore">${dataIt(d.data)}</div></div>
    </div>
    <div class="dest">
      <div class="etichetta">Destinatario</div>
      <div class="nome">${esc(d.cliente)}</div>
      <div>${esc(d.cliente_indirizzo_fatturazione)}</div>
      <div>P.Iva/C.F.: ${esc(d.cliente_piva || d.cliente_codice_fiscale)}</div>
      <div>E-mail: ${esc(d.email || d.cliente_email)}</div>
    </div>
  </div>
</div>
<table class="righe">
  <thead><tr><th style="width: 52%">Descrizione</th><th style="width: 9%">Q.tà</th><th style="width: 7%">U.m.</th><th style="width: 14%">Prezzo</th><th>Totale</th></tr></thead>
  <tbody>
    ${righe.map((r) => `<tr><td>${esc(r.descrizione)}</td><td>${num(r.quantita)}</td><td style="text-align:center">${esc(r.unita_misura)}</td><td class="destra">${euro(r.prezzo)}</td><td class="destra">${euro(r.totale)}</td></tr>`).join("")}
    <tr class="riempi"><td></td><td></td><td></td><td></td><td></td></tr>
  </tbody>
</table>
${senzaPrezzi ? "" : `<div class="totali">
  <div><span>Imponibile</span><span>${euro(d.imponibile) || "0,00 €"}</span></div>
  ${n(d.sconto) ? `<div><span>Sconto ${num(d.sconto)}%</span><span>- ${euro(d.sconto_totale)}</span></div>` : ""}
  ${n(d.iva) ? `<div><span>Iva ${num(d.iva)}%</span><span>${euro(d.iva_totale)}</span></div>` : ""}
  <div class="documento"><span>Totale</span><span>${euro(d.totale) || "0,00 €"}</span></div>
</div>`}
${d.tipologia_pagamento || d.modalita_pagamento ? `<p>Pagamento: ${esc([d.modalita_pagamento, d.tipologia_pagamento].filter(Boolean).join(" - "))}</p>` : ""}
<div class="annotazioni"><div class="etichetta">Annotazioni</div>${esc(d.note).replace(/\n/g, "<br>")}</div>
<div class="firma"><div class="etichetta">Firma per accettazione</div>${d._firma_url ? `<img src="${esc(d._firma_url)}" alt="" style="max-height: 70px; max-width: 100%">` : ""}</div>
<script>window.onload = () => window.print()</script>
</body></html>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Preventivo impaginato (come il modello Word della ditta): logo in alto, cliente e data, una o più soluzioni
// con titolo, testo e totale "+ IVA", nota finale e piede con indirizzo e dati bancari su ogni pagina.
export type SoluzionePreventivo = { titolo: string; testo: string; totale: number | null; nuovaPagina?: boolean };
export type PreventivoImpaginato = { soluzioni: SoluzionePreventivo[]; nota: string };
export type PiedePreventivo = { riga1: string; riga2: string };

/** "32095" → "32.095"; con i centesimi solo se ci sono (29050,5 → "29.050,50") */
export const importoPreventivo = (n: number) =>
  n.toLocaleString("it-IT", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

/** Testo scritto nel gestionale → paragrafi ed elenchi puntati (righe che iniziano con "-", "•" o "*") */
export function testoInParagrafi(testo: string) {
  const blocchi: string[] = [];
  let paragrafo: string[] = [];
  let punti: string[] = [];
  const chiudi = () => {
    if (paragrafo.length) blocchi.push(`<p>${paragrafo.map(esc).join("<br>")}</p>`);
    if (punti.length) blocchi.push(`<ul>${punti.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`);
    paragrafo = []; punti = [];
  };
  for (const riga of testo.replace(/\r/g, "").split("\n")) {
    const t = riga.trim();
    const punto = t.match(/^[-•*]\s+(.*)$/);
    if (!t) chiudi();
    else if (punto) { if (paragrafo.length) { const p = paragrafo; paragrafo = []; blocchi.push(`<p>${p.map(esc).join("<br>")}</p>`); } punti.push(punto[1]); }
    else { if (punti.length) chiudi(); paragrafo.push(t); }
  }
  chiudi();
  return blocchi.join("");
}

// Impaginato sempre su fogli A4 veri (210 × 297 mm), uguali a schermo e in stampa: il testo viene distribuito
// sui fogli uno alla volta (paragrafi, punti dell'elenco, titoli); ogni foglio ha logo in alto e piè di pagina.
// Un titolo non resta mai da solo in fondo al foglio; un paragrafo troppo lungo continua sul foglio dopo.
export function htmlPreventivoImpaginato(d: { cliente: string; data: unknown; titolo: string }, p: PreventivoImpaginato, piede: PiedePreventivo, stampa = true) {
  const data = d.data ? new Date(String(d.data)).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
  const soluzioni = p.soluzioni.filter((s) => s.titolo.trim() || s.testo.trim() || s.totale);
  // Blocchi in ordine: ognuno è un pezzo che non si divide (tranne i paragrafi lunghi)
  const blocchi: string[] = [`<div class="cliente"><span>${esc(d.cliente)}</span><span>${esc(data)}</span></div>`];
  soluzioni.forEach((s, i) => {
    if (i > 0) blocchi.push(s.nuovaPagina ? `<div class="salto"></div>` : `<div class="spazio"></div>`);
    if (s.titolo.trim()) blocchi.push(`<h2>${esc(s.titolo.trim())}</h2>`);
    // ogni punto dell'elenco è un blocco a sé (così l'elenco può continuare sul foglio dopo)
    blocchi.push(...testoInParagrafi(s.testo).replace(/<ul>|<\/ul>/g, "").split(/(?=<p>|<li>)/).filter(Boolean)
      .map((b) => (b.startsWith("<li>") ? `<ul>${b}</ul>` : b)));
    if (s.totale) blocchi.push(`<div class="totale">Totale&nbsp; €. ${importoPreventivo(s.totale)} + IVA</div>`);
  });
  if (p.nota.trim()) blocchi.push(`<div class="nota">${esc(p.nota.trim()).replace(/\n/g, "<br>")}</div>`);
  const logoUrl = new URL("logo-preventivo.png", location.href).href;
  const foglio = `<div class="foglio"><div class="testa"><img src="${logoUrl}" alt="Bocciardi Impianti"></div><div class="corpo"></div>
    <div class="piede"><div class="linea"></div><div class="r1">${esc(piede.riga1)}</div><div class="r2">${esc(piede.riga2)}</div></div></div>`;
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(d.titolo || "Preventivo")}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Verdana, "DejaVu Sans", Geneva, sans-serif; font-size: 10pt; line-height: 1.3; color: #111; margin: 0; background: #d9dde1; }
  #fogli { padding: 10px 0; }
  .foglio { width: 210mm; height: 297mm; position: relative; background: #fff; margin: 0 auto 10px; box-shadow: 0 2px 10px rgba(0,0,0,.2); overflow: hidden; break-after: page; page-break-after: always; }
  .foglio:last-child { break-after: auto; page-break-after: auto; }
  .testa { position: absolute; top: 12mm; left: 0; right: 0; text-align: center; padding-left: 12mm; }
  .testa img { width: 76mm; }
  .corpo { position: absolute; top: 42mm; bottom: 26mm; left: 20mm; right: 20mm; overflow: hidden; }
  .piede { position: absolute; left: 12mm; right: 12mm; bottom: 7mm; text-align: center; font-family: Arial, Helvetica, sans-serif; color: #404099; }
  .piede .linea { border-top: 1px solid #404099; margin-bottom: 1.5mm; }
  .piede .r1 { font-size: 8.5pt; }
  .piede .r2 { font-size: 6.5pt; margin-top: .6mm; }
  .cliente { display: flex; justify-content: space-between; border-bottom: 1px solid #222; padding: 0 0 1mm; margin: 4mm 0 11mm; }
  .cliente span:last-child { margin-right: 14mm; }
  .spazio { height: 6mm; }
  .salto { height: 0; }
  h2 { font-size: 10.5pt; font-weight: bold; text-transform: uppercase; margin: 0 0 3.5mm; line-height: 1.25; }
  p { margin: 0 0 3mm; }
  ul { margin: 0 0 .6mm; padding-left: 10mm; }
  ul + p, ul + h2, ul + .totale { margin-top: 3mm; }
  .totale { font-size: 12.5pt; font-weight: bold; margin: 8mm 0 2mm; }
  .nota { font-size: 7.5pt; margin-top: 3mm; }
  #sorgente { position: absolute; left: -9999px; top: 0; width: 170mm; }
  @media print { body { background: none; } #fogli { padding: 0; zoom: 1 !important; } .foglio { margin: 0; box-shadow: none; } }
</style></head><body>
<div id="sorgente">${blocchi.map((b) => `<div class="blocco">${b}</div>`).join("")}</div>
<div id="fogli"></div>
<template id="modello">${foglio}</template>
<script>
(function () {
  var fogli = document.getElementById("fogli");
  var modello = document.getElementById("modello");
  var corpo;
  function nuovo() { fogli.appendChild(modello.content.cloneNode(true)); corpo = fogli.lastElementChild.querySelector(".corpo"); }
  function pieno() { return corpo.scrollHeight > corpo.clientHeight + 1; }
  function impagina() {
    fogli.innerHTML = ""; nuovo();
    var blocchi = Array.prototype.slice.call(document.querySelectorAll("#sorgente > .blocco"));
    for (var i = 0; i < blocchi.length; i++) {
      var b = blocchi[i].firstElementChild.cloneNode(true);
      if (b.classList.contains("salto")) { if (corpo.children.length) nuovo(); continue; }
      if (b.classList.contains("spazio") && !corpo.children.length) continue;
      corpo.appendChild(b);
      if (!pieno()) continue;
      corpo.removeChild(b);
      // paragrafo lungo: quello che ci sta resta qui, il resto continua sul foglio dopo
      if (b.tagName === "P") {
        var parole = b.innerHTML.split(" "), lo = 0, hi = parole.length, prova = b.cloneNode(false);
        corpo.appendChild(prova);
        while (lo < hi) { var m = Math.ceil((lo + hi) / 2); prova.innerHTML = parole.slice(0, m).join(" "); if (pieno()) hi = m - 1; else lo = m; }
        if (lo > 0 && lo < parole.length) { prova.innerHTML = parole.slice(0, lo).join(" "); b.innerHTML = parole.slice(lo).join(" "); }
        else corpo.removeChild(prova);
      }
      // un titolo non resta da solo in fondo al foglio
      var ultimo = corpo.lastElementChild, titolo = ultimo && ultimo.tagName === "H2" ? ultimo : null;
      if (titolo) corpo.removeChild(titolo);
      nuovo();
      if (titolo) corpo.appendChild(titolo);
      if (b.classList.contains("spazio")) continue;
      corpo.appendChild(b);
    }
    adatta();
  }
  // Su schermi stretti (tablet, telefono) i fogli si rimpiccioliscono restando A4
  function adatta() {
    var mm = 210 * 96 / 25.4, z = Math.min(1, (window.innerWidth - 16) / mm);
    fogli.style.zoom = z < 1 ? String(z) : "";
  }
  window.addEventListener("resize", adatta);
  var img = new Image();
  img.onload = img.onerror = function () { impagina(); ${stampa ? "setTimeout(function () { window.print(); }, 300);" : ""} };
  img.src = ${JSON.stringify(logoUrl)};
})();
</script>
</body></html>`;
}
