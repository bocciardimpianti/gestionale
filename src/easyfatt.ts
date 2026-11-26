// Collegamento con Danea Easy Fatt: il gestionale prepara una fattura nel formato Easyfatt-XML (.DefXml),
// lo stesso che Easy Fatt esporta e importa. Si importa in Easy Fatt e si controlla prima di emetterla.
// Formato: https://www.danea.it/software/easyfatt/xml

export type RigaFattura = { descrizione: string; quantita?: number | null; um?: string | null; prezzo?: number | null; iva?: number | null };
export type ClienteFattura = {
  nome: string; codice_fiscale?: string | null; piva?: string | null; email?: string | null;
  indirizzo_fatturazione?: string | null; tipologia_pagamento?: string | null;
};

const xml = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const r2 = (x: number) => Math.round(x * 100) / 100;
const num = (x: number) => String(r2(x));

/** "Via Roma 1, 56029 Santa Croce sull'Arno (PI)" → indirizzo, CAP, città, provincia (quello che si riesce a capire) */
export function divisoIndirizzo(t: string | null | undefined) {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  const m = s.match(/^(.*?)[,\s-]*\b(\d{5})\b\s*[-,]?\s*([^,(]*?)\s*(?:\(\s*([A-Za-z]{2})\s*\)|\s([A-Z]{2}))?\s*$/);
  if (!m) return { indirizzo: s, cap: "", citta: "", provincia: "" };
  return { indirizzo: m[1].replace(/[,\s-]+$/, ""), cap: m[2], citta: m[3].trim(), provincia: (m[4] ?? m[5] ?? "").toUpperCase() };
}

/** Fattura ("I") o DDT ("D") in formato Easyfatt-XML; il numero lo assegna Easy Fatt */
export function fatturaEasyfatt(c: ClienteFattura, righe: RigaFattura[], data = new Date(), tipo: "I" | "D" = "I") {
  const ind = divisoIndirizzo(c.indirizzo_fatturazione);
  const conPrezzo = righe.filter((r) => r.prezzo != null);
  const imponibile = r2(conPrezzo.reduce((t, r) => t + (r.quantita ?? 1) * (r.prezzo ?? 0), 0));
  const iva = r2(conPrezzo.reduce((t, r) => t + r2((r.quantita ?? 1) * (r.prezzo ?? 0) * (r.iva ?? 22) / 100), 0));
  const giorno = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
  const riga = (r: RigaFattura) => r.prezzo == null ? `
        <Row>
          <Code></Code>
          <Description>${xml(r.descrizione)}</Description>
          <Qty></Qty>
          <Um></Um>
          <Price></Price>
          <Discounts></Discounts>
          <VatCode></VatCode>
          <Total></Total>
          <Notes></Notes>
        </Row>` : `
        <Row>
          <Code></Code>
          <Description>${xml(r.descrizione)}</Description>
          <Qty>${num(r.quantita ?? 1)}</Qty>
          <Um>${xml(r.um ?? "")}</Um>
          <Price>${num(r.prezzo)}</Price>
          <Discounts></Discounts>
          <VatCode Perc="${r.iva ?? 22}" Class="Imponibile" Description="Imponibile ${r.iva ?? 22}%">${r.iva ?? 22}</VatCode>
          <Total>${num((r.quantita ?? 1) * r.prezzo)}</Total>
          <Notes></Notes>
        </Row>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- File in formato Easyfatt-XML preparato dal gestionale Bocciardi Impianti: importarlo in Danea Easy Fatt e controllarlo prima di emettere la fattura -->
<EasyfattDocuments AppVersion="2" Creator="Gestionale Bocciardi Impianti" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://www.danea.it/public/easyfatt-xml.xsd">
  <Company>
    <Name>Bocciardi Impianti srl</Name>
    <Address>Via Ugo Foscolo, 6</Address>
    <Postcode>56029</Postcode>
    <City>Staffoli - Santa Croce sull'Arno</City>
    <Province>PI</Province>
    <FiscalCode>01721730503</FiscalCode>
    <VatCode>01721730503</VatCode>
    <Tel>057137592</Tel>
    <Email>info@bocciardimpianti.it</Email>
  </Company>
  <Documents>
    <Document>
      <CustomerName>${xml(c.nome)}</CustomerName>
      <CustomerAddress>${xml(ind.indirizzo)}</CustomerAddress>
      <CustomerPostcode>${xml(ind.cap)}</CustomerPostcode>
      <CustomerCity>${xml(ind.citta)}</CustomerCity>
      <CustomerProvince>${xml(ind.provincia)}</CustomerProvince>
      <CustomerCountry></CustomerCountry>
      <CustomerFiscalCode>${xml(c.codice_fiscale ?? "")}</CustomerFiscalCode>
      <CustomerVatCode>${xml(c.piva ?? "")}</CustomerVatCode>
      <CustomerEmail>${xml(c.email ?? "")}</CustomerEmail>
      <DocumentType>${tipo}</DocumentType>
      <Date>${giorno}</Date>
      <Number></Number>
      <Numbering></Numbering>
      <TotalWithoutTax>${num(imponibile)}</TotalWithoutTax>
      <VatAmount>${num(iva)}</VatAmount>
      <WithholdingTaxAmount>0</WithholdingTaxAmount>
      <Total>${num(imponibile + iva)}</Total>
      <PricesIncludeVat>false</PricesIncludeVat>
      <PaymentName>${tipo === "I" ? xml(c.tipologia_pagamento ?? "") : ""}</PaymentName>${tipo === "D" ? `
      <Carrier></Carrier>
      <TransportReason></TransportReason>
      <GoodsAppearance></GoodsAppearance>
      <NumOfPieces></NumOfPieces>
      <TransportDateTime></TransportDateTime>
      <ShipmentTerms></ShipmentTerms>
      <TransportedWeight></TransportedWeight>` : ""}
      <InternalComment>Preparata dal gestionale il ${giorno}</InternalComment>
      <Rows>${righe.map(riga).join("")}
      </Rows>
    </Document>
  </Documents>
</EasyfattDocuments>
`;
}

/** Scarica il file .DefXml sul dispositivo */
export function scaricaEasyfatt(contenuto: string, nome: string) {
  const url = URL.createObjectURL(new Blob([contenuto], { type: "text/xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome.replace(/[\\/:*?"<>|]+/g, " ").trim() + ".DefXml";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// DDT come quelli fatti in Easy Fatt: i materiali (uguali sommati, in ordine alfabetico) come "n. 20 DESCRIZIONE",
// "mt. 100 DESCRIZIONE" tutti in una riga (come in Easy Fatt), oppure una riga per materiale (predefinito). Senza prezzi.
export type MaterialeDdt = { descrizione: string; quantita: number | null; um: string | null };
const prefissoUm = (um: string | null) => {
  const u = String(um ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!u || /^(nr|n|pz|pezzi|num)$/.test(u)) return "n.";
  if (/^(mt|m|ml|metri)$/.test(u)) return "mt.";
  return u + ".";
};
export function righeDdt(materiali: MaterialeDdt[], unaRiga: boolean): RigaFattura[] {
  const somma = new Map<string, MaterialeDdt>();
  for (const m of materiali) {
    const k = `${m.descrizione.trim().toUpperCase()}|${prefissoUm(m.um)}`;
    const g = somma.get(k);
    if (g) g.quantita = (g.quantita ?? 0) + (m.quantita ?? 0); else somma.set(k, { ...m, quantita: m.quantita ?? 0 });
  }
  const ordinati = [...somma.values()].sort((a, b) => a.descrizione.localeCompare(b.descrizione, "it"));
  if (!ordinati.length) return [];
  // Una riga per materiale: quantità e unità di misura nelle loro colonne
  if (!unaRiga) return ordinati.map((m) => ({ descrizione: m.descrizione.trim(), quantita: m.quantita ?? 1, um: (m.um ?? "").trim() || "NR", prezzo: 0, iva: 22 }));
  const elenco = ordinati.map((m) => `${prefissoUm(m.um)} ${Number(m.quantita ?? 0).toLocaleString("it-IT", { maximumFractionDigits: 2 })} ${m.descrizione.trim()}`);
  return [{ descrizione: elenco.join("\n"), quantita: 1, prezzo: 0, iva: 22 }];
}
