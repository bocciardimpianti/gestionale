import JSZip from "jszip";
import writeXlsxFile from "write-excel-file";
import { supabase } from "./supabase";

// Tabelle incluse nel backup: foglio Excel e colonna per l'ordinamento
const TABELLE: { tabella: string; foglio: string; ordine: string }[] = [
  { tabella: "clienti", foglio: "Clienti", ordine: "id" },
  { tabella: "fornitori", foglio: "Fornitori", ordine: "id" },
  { tabella: "tecnici", foglio: "Tecnici", ordine: "id" },
  { tabella: "impianti", foglio: "Impianti", ordine: "id" },
  { tabella: "rapporti", foglio: "Rapporti di intervento", ordine: "id" },
  { tabella: "righe_rapporto", foglio: "Righe rapporti", ordine: "id" },
  { tabella: "materiali", foglio: "Materiali", ordine: "id" },
  { tabella: "archivi", foglio: "Archivi", ordine: "id" },
  { tabella: "tipologie_pagamento", foglio: "Tipologie pagamento", ordine: "ordine" },
  { tabella: "modalita_pagamento", foglio: "Modalità pagamento", ordine: "ordine" },
  { tabella: "banche", foglio: "Banche", ordine: "ordine" },
  { tabella: "province", foglio: "Province", ordine: "ordine" },
  { tabella: "nazioni", foglio: "Nazioni", ordine: "ordine" },
  { tabella: "periodi", foglio: "Periodi", ordine: "ordine" },
  { tabella: "stati_documento", foglio: "Stati documento", ordine: "ordine" },
  { tabella: "tariffe", foglio: "Tariffe", ordine: "ordine" },
  { tabella: "unita_misura", foglio: "Unità di misura", ordine: "ordine" },
  { tabella: "note_dashboard", foglio: "Note dashboard", ordine: "id" },
  { tabella: "profili", foglio: "Utenti", ordine: "email" },
  { tabella: "permessi", foglio: "Permessi", ordine: "utente_id" },
  { tabella: "registro", foglio: "Registro attività", ordine: "id" },
];

// File (foto e firme) collegati ai record: archivio file e colonne che contengono il percorso
const FILE: { archivio: string; tabella: string; colonne: string[] }[] = [
  { archivio: "rapporti", tabella: "rapporti", colonne: ["firma", "foto1", "foto2", "foto3", "foto4"] },
  { archivio: "materiali", tabella: "materiali", colonne: ["foto"] },
];

async function leggiTabella(tabella: string, ordine: string) {
  const tutte: Record<string, unknown>[] = [];
  for (let da = 0; ; da += 1000) {
    const { data, error } = await supabase.from(tabella).select("*").order(ordine).range(da, da + 999);
    // Una tabella non ancora creata (script non eseguito) non blocca il backup
    if (error) return tutte;
    tutte.push(...(data ?? []));
    if (!data || data.length < 1000) return tutte;
  }
}

const cella = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return { type: Number, value: v };
  if (typeof v === "boolean") return { type: Boolean, value: v };
  if (typeof v === "object") return { type: String, value: JSON.stringify(v) };
  return { type: String, value: String(v) };
};

export const nomeBackup = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `Backup gestionale ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.zip`;
};

// Crea il backup completo: un file Excel con un foglio per tabella, i dati in formato JSON e tutte le foto/firme
export async function creaBackup(
  avanzamento: (messaggio: string) => void,
  opzioni: { fotoMateriali: boolean } = { fotoMateriali: true },
): Promise<Blob> {
  const zip = new JSZip();
  const dati: Record<string, Record<string, unknown>[]> = {};

  for (const [i, t] of TABELLE.entries()) {
    avanzamento(`Lettura ${t.foglio}… (${i + 1}/${TABELLE.length})`);
    dati[t.tabella] = await leggiTabella(t.tabella, t.ordine);
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
  zip.file("dati.json", JSON.stringify({ creato_il: new Date().toISOString(), tabelle: dati }));

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
      `Backup del gestionale Bocciardi Impianti - ${new Date().toLocaleString("it-IT")}`,
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
