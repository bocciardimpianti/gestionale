// Etichette QR dei materiali, come in ReportOne: il QR contiene il codice a barre del materiale
// (di solito uguale al codice interno), che si legge con la fotocamera nei rapportini.
// Foglio A4 con 3 × 8 etichette da 70 × 37 mm (fogli adesivi standard); si può partire da una posizione qualsiasi.
// Margine interno di 5 mm: le stampanti laser non stampano vicino al bordo del foglio.

import { supabase } from "./supabase";

type Materiale = Record<string, unknown>;

// Foto del materiale rimpicciolita (lato lungo 360 px) e incorporata nella pagina: la stampa non dipende da link che scadono
async function fotoPiccola(percorso: string): Promise<string> {
  try {
    const { data } = await supabase.storage.from("materiali").download(percorso);
    if (!data) return "";
    const bitmap = await createImageBitmap(data);
    const scala = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
    const tela = document.createElement("canvas");
    tela.width = Math.max(1, Math.round(bitmap.width * scala));
    tela.height = Math.max(1, Math.round(bitmap.height * scala));
    const ctx = tela.getContext("2d")!;
    ctx.fillStyle = "#fff"; // le immagini trasparenti diventerebbero nere
    ctx.fillRect(0, 0, tela.width, tela.height);
    ctx.drawImage(bitmap, 0, 0, tela.width, tela.height);
    return tela.toDataURL("image/jpeg", 0.85);
  } catch {
    return "";
  }
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Testo contenuto nel QR: codice a barre, altrimenti codice interno
export const testoQr = (m: Materiale) => String(m.codice_barre ?? "").trim() || String(m.codice_interno ?? "").trim();

async function svgQr(testo: string) {
  const { QRCodeWriter, BarcodeFormat, EncodeHintType } = await import("@zxing/library");
  const suggerimenti = new Map();
  suggerimenti.set(EncodeHintType.MARGIN, 0);
  suggerimenti.set(EncodeHintType.ERROR_CORRECTION, "M");
  const matrice = new QRCodeWriter().encode(testo, BarcodeFormat.QR_CODE, 0, 0, suggerimenti);
  const lato = matrice.getWidth();
  let percorso = "";
  for (let y = 0; y < lato; y++) for (let x = 0; x < lato; x++) if (matrice.get(x, y)) percorso += `M${x} ${y}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lato} ${lato}" shape-rendering="crispEdges"><path d="${percorso}"/></svg>`;
}

export async function stampaEtichette(materiali: Materiale[]) {
  // La finestra si apre subito (prima delle attese), altrimenti il browser la blocca
  const finestra = window.open("", "_blank");
  if (!finestra) throw new Error("Il browser ha bloccato la finestra di stampa: consenti le finestre popup per questo sito");
  finestra.document.write("<p style='font:14px Arial;padding:20px'>Preparazione delle etichette…</p>");
  const senzaCodice = materiali.filter((m) => !testoQr(m));
  const conCodice = materiali.filter((m) => testoQr(m));
  const qr = new Map<string, string>();
  for (const m of conCodice) if (!qr.has(testoQr(m))) qr.set(testoQr(m), await svgQr(testoQr(m)));
  // Foto dei materiali, scaricate qualche alla volta
  const foto = new Map<string, string>();
  const percorsi = [...new Set(conCodice.map((m) => (typeof m.foto === "string" ? m.foto : "")).filter(Boolean))];
  for (let i = 0; i < percorsi.length; i += 6) {
    finestra.document.body.innerHTML = `<p style='font:14px Arial;padding:20px'>Preparazione delle etichette… foto ${i} di ${percorsi.length}</p>`;
    const lotto = percorsi.slice(i, i + 6);
    const immagini = await Promise.all(lotto.map(fotoPiccola));
    lotto.forEach((p, k) => foto.set(p, immagini[k]));
  }
  // Ogni etichetta è già pronta; copie e posizione di partenza si scelgono nella finestra (anteprima subito aggiornata)
  const etichette = conCodice.map((m) => {
    const immagine = typeof m.foto === "string" ? foto.get(m.foto) : "";
    return `<div class="etichetta">
      <div class="sopra">
        <div class="qr">${qr.get(testoQr(m))}</div>
        <div class="foto">${immagine ? `<img src="${immagine}" alt="">` : ""}</div>
        <div class="codici">
          <div class="codice">${esc(m.codice_interno || testoQr(m))}</div>
          ${testoQr(m) !== String(m.codice_interno ?? "").trim() ? `<div class="barre">${esc(testoQr(m))}</div>` : ""}
        </div>
      </div>
      <div class="descrizione">${esc(m.descrizione)}</div>
    </div>`;
  });
  finestra.document.open();
  finestra.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Etichette materiali</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, sans-serif; }
      .foglio { width: 210mm; height: 297mm; display: grid; grid-template-columns: repeat(3, 70mm); grid-template-rows: repeat(8, 37.125mm); page-break-after: always; overflow: hidden; }
      .foglio:last-child { page-break-after: auto; }
      .etichetta { display: flex; flex-direction: column; justify-content: center; gap: 1mm; padding: 4.5mm 5mm; overflow: hidden; }
      .sopra { display: flex; align-items: center; gap: 2mm; height: 20mm; }
      .qr { flex: none; width: 20mm; height: 20mm; }
      .qr svg { width: 100%; height: 100%; display: block; }
      .foto { flex: none; width: 20mm; height: 20mm; display: grid; place-items: center; overflow: hidden; }
      .foto img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
      .foto:empty { border: 0.2mm dashed #bbb; border-radius: 1mm; }
      .codici { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 0.8mm; }
      .codice { font-size: 11pt; font-weight: 700; letter-spacing: .2pt; overflow-wrap: anywhere; }
      .descrizione { font-size: 6.5pt; line-height: 1.15; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .barre { font-size: 6pt; color: #444; overflow-wrap: anywhere; }
      .comandi { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; padding: 10px 16px; background: #123b45; color: #fff; font-size: 14px; }
      .comandi input { width: 64px; font-size: 16px; padding: 4px 6px; }
      .comandi button { font-size: 15px; padding: 8px 18px; border: 0; border-radius: 6px; background: #f2a541; color: #123b45; font-weight: 700; cursor: pointer; }
      .avviso { font-size: 13px; padding: 10px 16px; background: #fff3cd; }
      @media screen { body { background: #ddd; } .foglio { background: #fff; margin: 10mm auto; box-shadow: 0 2px 10px rgba(0,0,0,.2); } .etichetta { outline: 1px dashed #ccc; } }
      @media print { .comandi, .avviso { display: none; } }
    </style></head><body>
    <div class="comandi">
      <span>${conCodice.length} ${conCodice.length === 1 ? "materiale" : "materiali"} · foglio A4 da 24 etichette (70 × 37 mm)</span>
      <label>Copie per materiale <input id="copie" type="number" min="1" max="99" value="1"></label>
      <label>Inizia dalla posizione <input id="inizio" type="number" min="1" max="24" value="1"></label>
      <button type="button" onclick="window.print()">Stampa</button>
    </div>
    ${senzaCodice.length ? `<div class="avviso">${senzaCodice.length} materiali senza codice non vengono stampati: ${senzaCodice.slice(0, 5).map((m) => esc(m.descrizione)).join(", ")}${senzaCodice.length > 5 ? "…" : ""}</div>` : ""}
    <div id="fogli"></div>
    <script>
      const etichette = ${JSON.stringify(etichette)};
      function disegna() {
        const copie = Math.max(1, Math.min(99, parseInt(document.getElementById("copie").value) || 1));
        const inizio = Math.max(1, Math.min(24, parseInt(document.getElementById("inizio").value) || 1));
        const celle = Array(inizio - 1).fill('<div class="etichetta"></div>');
        for (const e of etichette) for (let k = 0; k < copie; k++) celle.push(e);
        let html = "";
        for (let i = 0; i < celle.length; i += 24) html += '<div class="foglio">' + celle.slice(i, i + 24).join("") + "</div>";
        document.getElementById("fogli").innerHTML = html;
      }
      document.getElementById("copie").oninput = disegna;
      document.getElementById("inizio").oninput = disegna;
      disegna();
    </script>
  </body></html>`);
  finestra.document.close();
}
