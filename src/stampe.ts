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
