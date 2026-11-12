import JSZip from "jszip";
import writeXlsxFile from "write-excel-file";
import { supabase } from "./supabase";

// Tabelle incluse nel backup: foglio Excel e colonna per l'ordinamento
// "intera": elenco breve salvato sempre per intero, anche nel backup incrementale
const TABELLE: { tabella: string; foglio: string; ordine: string; intera?: boolean }[] = [
  { tabella: "clienti", foglio: "Clienti", ordine: "id" },
  { tabella: "fornitori", foglio: "Fornitori", ordine: "id" },
  { tabella: "tecnici", foglio: "Tecnici", ordine: "id" },
  { tabella: "impianti", foglio: "Impianti", ordine: "id" },
  { tabella: "rapporti", foglio: "Rapporti di intervento", ordine: "id" },
  { tabella: "righe_rapporto", foglio: "Righe rapporti", ordine: "id" },
  { tabella: "preventivi", foglio: "Preventivi", ordine: "id" },
  { tabella: "righe_preventivo", foglio: "Righe preventivi", ordine: "id" },
  { tabella: "ddt_acquisto", foglio: "DDT di acquisto", ordine: "id" },
  { tabella: "righe_ddt_acquisto", foglio: "Righe DDT di acquisto", ordine: "id" },
  { tabella: "abbinamenti_fornitore", foglio: "Abbinamenti codici fornitore", ordine: "id" },
  { tabella: "scadenziario", foglio: "Scadenziario", ordine: "id" },
  { tabella: "richieste", foglio: "Richieste di intervento", ordine: "id" },
  { tabella: "materiali", foglio: "Materiali", ordine: "id" },
  { tabella: "archivi", foglio: "Archivi", ordine: "id", intera: true },
  { tabella: "tipologie_pagamento", foglio: "Tipologie pagamento", ordine: "ordine", intera: true },
  { tabella: "modalita_pagamento", foglio: "Modalità pagamento", ordine: "ordine", intera: true },
  { tabella: "banche", foglio: "Banche", ordine: "ordine", intera: true },
  { tabella: "province", foglio: "Province", ordine: "ordine", intera: true },
  { tabella: "nazioni", foglio: "Nazioni", ordine: "ordine", intera: true },
  { tabella: "periodi", foglio: "Periodi", ordine: "ordine", intera: true },
  { tabella: "stati_documento", foglio: "Stati documento", ordine: "ordine", intera: true },
  { tabella: "tariffe", foglio: "Tariffe", ordine: "ordine", intera: true },
  { tabella: "unita_misura", foglio: "Unità di misura", ordine: "ordine", intera: true },
  { tabella: "note_dashboard", foglio: "Note dashboard", ordine: "id", intera: true },
  { tabella: "profili", foglio: "Utenti", ordine: "email", intera: true },
  { tabella: "permessi", foglio: "Permessi", ordine: "utente_id", intera: true },
  { tabella: "registro", foglio: "Registro attività", ordine: "id" },
];

// File (foto e firme) collegati ai record: archivio file e colonne che contengono il percorso
const FILE: { archivio: string; tabella: string; colonne: string[] }[] = [
  { archivio: "rapporti", tabella: "rapporti", colonne: ["firma", "foto1", "foto2", "foto3", "foto4"] },
  { archivio: "materiali", tabella: "materiali", colonne: ["foto"] },
  { archivio: "preventivi", tabella: "preventivi", colonne: ["firma"] },
  { archivio: "ddt_acquisto", tabella: "ddt_acquisto", colonne: ["pdf"] },
];

// Righe di dettaglio senza date proprie: nel backup incrementale vanno con il documento modificato
const RIGHE_DI: Record<string, { padre: string; campo: string }> = {
  righe_rapporto: { padre: "rapporti", campo: "rapporto_id" },
  righe_preventivo: { padre: "preventivi", campo: "preventivo_id" },
  righe_ddt_acquisto: { padre: "ddt_acquisto", campo: "ddt_id" },
};

// "dal": solo i record creati o modificati da quel momento (backup incrementale).
// Le tabelle senza date (elenchi brevi come province o tariffe) vengono salvate sempre per intero.
async function leggiTabella(tabella: string, ordine: string, dal?: string) {
  const d = `"${dal}"`;
  const filtri: (string | null)[] = dal ? [`modificato_il.gte.${d},creato_il.gte.${d}`, `creato_il.gte.${d}`, `il.gte.${d}`, null] : [null];
  for (const filtro of filtri) {
    const tutte: Record<string, unknown>[] = [];
    let riuscita = true;
    for (let da = 0; ; da += 1000) {
      let q = supabase.from(tabella).select("*");
      if (filtro) q = q.or(filtro);
      const { data, error } = await q.order(ordine).range(da, da + 999);
      // Filtro non applicabile (colonna assente): si prova il successivo; tabella non ancora creata: si salta
      if (error) { riuscita = false; break; }
      tutte.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    if (riuscita) return tutte;
  }
  return [];
}

// Righe dei soli documenti presenti nel backup incrementale
async function leggiRighe(tabella: string, campo: string, idPadri: unknown[]) {
  const tutte: Record<string, unknown>[] = [];
  for (let i = 0; i < idPadri.length; i += 200) {
    const { data, error } = await supabase.from(tabella).select("*").in(campo, idPadri.slice(i, i + 200)).order("id");
    if (error) return tutte;
    tutte.push(...(data ?? []));
  }
  return tutte;
}

const cella = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return { type: Number, value: v };
  if (typeof v === "boolean") return { type: Boolean, value: v };
  if (typeof v === "object") return { type: String, value: JSON.stringify(v) };
  return { type: String, value: String(v) };
};

export const nomeBackup = (incrementale = false) => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `Backup gestionale ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())} ${incrementale ? "incrementale" : "completo"}.zip`;
};

// Con "dal" il backup è incrementale: solo ciò che è stato creato o modificato da quella data (con foto e PDF nuovi)
export async function creaBackup(
  avanzamento: (messaggio: string) => void,
  opzioni: { fotoMateriali: boolean; dal?: string } = { fotoMateriali: true },
): Promise<Blob> {
  const zip = new JSZip();
  const dati: Record<string, Record<string, unknown>[]> = {};
  const dal = opzioni.dal;

  for (const [i, t] of TABELLE.entries()) {
    avanzamento(`Lettura ${t.foglio}… (${i + 1}/${TABELLE.length})`);
    const righe = RIGHE_DI[t.tabella];
    dati[t.tabella] = dal && righe
      ? await leggiRighe(t.tabella, righe.campo, (dati[righe.padre] ?? []).map((r) => r.id))
      : await leggiTabella(t.tabella, t.ordine, t.intera ? undefined : dal);
  }

  avanzamento("Creazione del file Excel…");
  const fogli = TABELLE.filter((t) => dati[t.tabella].length);
  const contenuto = fogli.map((t) => {
    const righe = dati[t.tabella];
    const colonne = Object.keys(righe[0]);
    return [
      colonne.map((c) => ({ value: c, fontWeight: "bold" as const })),
      ...righe.map((r) => colonne.map((c) => cella(r[c]))),
    ];
  });
  const excel = (await writeXlsxFile(contenuto as never, { sheets: fogli.map((t) => t.foglio) } as never)) as unknown as Blob;
  zip.file("Dati gestionale.xlsx", excel);
  zip.file("dati.json", JSON.stringify({ creato_il: new Date().toISOString(), tipo: dal ? "incrementale" : "completo", modifiche_dal: dal ?? null, tabelle: dati }));

  // Foto e firme
  const percorsi: { archivio: string; percorso: string }[] = [];
  for (const f of FILE) {
    if (f.archivio === "materiali" && !opzioni.fotoMateriali) continue;
    for (const r of dati[f.tabella] ?? []) {
      for (const c of f.colonne) if (typeof r[c] === "string" && r[c]) percorsi.push({ archivio: f.archivio, percorso: r[c] as string });
    }
  }
  let mancanti = 0;
  for (const [i, f] of percorsi.entries()) {
    if (i % 10 === 0) avanzamento(`Download foto e firme… ${i}/${percorsi.length}`);
    const { data } = await supabase.storage.from(f.archivio).download(f.percorso);
    if (data) zip.file(`foto/${f.archivio}/${f.percorso}`, data);
    else mancanti++;
  }

  zip.file(
    "LEGGIMI.txt",
    [
      `Backup ${dal ? "INCREMENTALE" : "COMPLETO"} del gestionale Bocciardi Impianti - ${new Date().toLocaleString("it-IT")}`,
      ...(dal ? [
        `Contiene solo i dati creati o modificati dal ${new Date(dal).toLocaleString("it-IT")} (con le loro foto, firme e PDF);`,
        `gli elenchi brevi sono sempre completi (${TABELLE.filter((t) => t.intera).map((t) => t.foglio).join(", ")}).`,
        "Per un ripristino servono l'ultimo backup COMPLETO e, in ordine di data, tutti gli INCREMENTALI successivi.",
      ] : []),
      "",
      "Dati gestionale.xlsx  tutte le tabelle, un foglio per tabella",
      "dati.json             gli stessi dati in formato completo (per un eventuale ripristino)",
      `foto/                 foto e firme dei rapporti${opzioni.fotoMateriali ? ", foto dei materiali" : " (foto dei materiali escluse)"}`,
      "",
      ...TABELLE.map((t) => `${t.foglio}: ${dati[t.tabella].length} righe`),
      `Foto e firme: ${percorsi.length - mancanti} file${mancanti ? ` (${mancanti} non scaricati)` : ""}`,
    ].join("\r\n"),
  );

  avanzamento("Compressione…");
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

type Destinazione = { scrivi: (b: Blob) => Promise<void> };

// Chiede dove salvare (cartella Documenti proposta) quando il browser lo permette, altrimenti scarica nei Download.
// Va chiamata subito al clic: il browser apre la finestra di salvataggio solo in risposta a un'azione dell'utente.
export async function scegliDestinazione(nome: string): Promise<Destinazione | null> {
  const w = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  };
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: nome,
        startIn: "documents",
        types: [{ description: "Backup (zip)", accept: { "application/zip": [".zip"] } }],
      });
      return {
        scrivi: async (b) => {
          const out = await handle.createWritable();
          await out.write(b);
          await out.close();
        },
      };
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
    }
  }
  return {
    scrivi: async (b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    },
  };
}
