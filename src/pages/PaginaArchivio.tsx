import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import readXlsxFile from "read-excel-file";
import writeXlsxFile from "write-excel-file";
import {
  ChevronRight, Columns3, Database, Filter, FileDown, FileUp, Folder, FolderOpen, FolderPlus, Printer, QrCode, RefreshCw, UserCheck,
  RotateCcw, Search, Sheet, Trash2, Undo2,
} from "lucide-react";
import { dataIso, leggiTutto, registra, supabase, vuoto } from "../supabase";
import { senzaPrezzi } from "../prezzi";
import { useAuth } from "../auth";
import Griglia, { mostra as mostraValore } from "../components/Griglia";
import Scheda from "../components/Scheda";
import ImportaReportOne from "../components/ImportaReportOne";
import ImportaDdtPdf from "../components/ImportaDdtPdf";
import { categoriaDa } from "../categorie";
import { stampaEtichette } from "../etichette";
import { prendiInCarico } from "../archivi";
import BannerNotifiche from "../components/BannerNotifiche";
import { avvisaRichiesta } from "../notifiche";
import FiltriCategoria from "../components/FiltriCategoria";
import { linkWhatsapp } from "../whatsapp";
import { Miniatura } from "../components/CampoImmagine";
import type { Archivio } from "../archivi";
import MicDettatura from "../components/MicDettatura";
import { intestazioneRiservata, stileRiservato } from "../stampe";

type Riga = Record<string, unknown> & { id: number; archivio_id?: number | null; eliminato_il?: string | null };
type Vista = { tipo: "tutti" } | { tipo: "archivio"; id: number; nome: string } | { tipo: "cestino" } | { tipo: "rapida"; indice: number };
export interface Cartella { id: number; nome: string }

const normalizza = (s: unknown) => String(s ?? "").trim().toLowerCase();
const due = (n: number) => String(n).padStart(2, "0");

// Le date lette dall'Excel arrivano come "ora del foglio" in UTC: vanno lette in UTC,
// altrimenti il fuso orario italiano sposta le ore (+1/+2) e, dopo le 22, anche il giorno
function dataExcel(v: unknown) {
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getUTCFullYear()}-${due(v.getUTCMonth() + 1)}-${due(v.getUTCDate())}`;
  return dataIso(v);
}
function oraExcel(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return `${due(v.getUTCHours())}:${due(v.getUTCMinutes())}`;
  if (typeof v === "number" && v >= 0 && v < 1) {
    const m = Math.round(v * 24 * 60);
    return `${due(Math.floor(m / 60))}:${due(m % 60)}`;
  }
  const t = String(v ?? "").match(/(\d{1,2})[:.](\d{2})/);
  return t ? `${due(Number(t[1]))}:${t[2]}` : null;
}
const testo = (v: unknown) => (vuoto(v) ? "" : String(v));

// Colonne nascoste, ricordate per utente su questo dispositivo
const chiaveLayout = (sezione: string) => `colonne-nascoste:${sezione}`;
function leggiNascoste(sezione: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(chiaveLayout(sezione)) ?? "[]");
  } catch {
    return [];
  }
}

export default function PaginaArchivio({ cfg }: { cfg: Archivio }) {
  const { puo, profilo, puoWhatsapp, vedePrezzi } = useAuth();
  // Casella spuntata direttamente nella griglia (es. Pagato nello scadenziario): salvataggio immediato
  const spunta = async (r: Riga, chiave: string, valore: boolean) => {
    setRighe((rr) => rr.map((x) => (x.id === r.id ? { ...x, [chiave]: valore } : x)));
    const { error } = await supabase.from(cfg.tabella).update({ [chiave]: valore }).eq("id", r.id);
    if (error) {
      alert("Errore: " + error.message);
      setRighe((rr) => rr.map((x) => (x.id === r.id ? { ...x, [chiave]: !valore } : x)));
      return;
    }
    await registra(`${cfg.sezione}_modificato`, { id: r.id, [chiave]: valore });
  };
  const apriNuovo = async (extra: Record<string, unknown> = {}) => {
    const base = vista.tipo === "archivio" ? { archivio_id: vista.id } : {};
    const proposti = (await cfg.valoriNuovo?.({ utenteId: profilo?.id ?? "", admin: profilo?.ruolo === "admin" })) ?? {};
    setScheda({ ...proposti, ...base, ...extra });
  };
  const [righe, setRighe] = useState<Riga[]>([]);
  const [visibili, setVisibili] = useState<Riga[]>([]);
  const [cartelle, setCartelle] = useState<Cartella[]>([]);
  const [vista, setVista] = useState<Vista>({ tipo: "tutti" });
  const [selezionata, setSelezionata] = useState<number | null>(null);
  const [scheda, setScheda] = useState<Record<string, unknown> | null>(null);
  // Righe spuntate nella griglia (es. materiali di cui stampare le etichette)
  const [selezionate, setSelezionate] = useState<Riga[]>([]);
  const [menu, setMenu] = useState<"" | "azioni" | "tabella" | "archivi">("");
  const [sceltaColonne, setSceltaColonne] = useState(false);
  const [importaReportOne, setImportaReportOne] = useState(false);
  const [importaPdf, setImportaPdf] = useState(false);
  const [nascoste, setNascoste] = useState<string[]>(() => leggiNascoste(cfg.sezione));
  const [messaggio, setMessaggio] = useState("");
  const [ricerca, setRicerca] = useState("");
  // Colonna in cui cercare ("" = tutte)
  const [colonnaRicerca, setColonnaRicerca] = useState("");
  const [galleria, setGalleria] = useState(false);
  const [categoriaRapida, setCategoriaRapida] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const carica = useCallback(async () => {
    try {
      const [tutte, { data: arch }] = await Promise.all([
        leggiTutto(cfg.tabella, cfg.select) as Promise<Riga[]>,
        supabase.from("archivi").select("id, nome").eq("sezione", cfg.sezione).order("nome"),
      ]);
      setRighe(tutte);
      setCartelle(arch ?? []);
    } catch (e) {
      setMessaggio("Errore: " + (e as Error).message);
    }
  }, [cfg.tabella, cfg.sezione]);

  useEffect(() => {
    carica();
  }, [carica]);

  // Indirizzo con "?apri=ID" (es. toccando una notifica): si apre la scheda di quel record
  useEffect(() => {
    const apriDaIndirizzo = () => {
      const [percorso, query] = location.hash.split("?");
      const id = new URLSearchParams(query ?? "").get("apri");
      if (!id) return;
      history.replaceState(null, "", location.pathname + location.search + percorso);
      supabase.from(cfg.tabella).select(cfg.select ?? "*").eq("id", Number(id)).maybeSingle().then(({ data }) => {
        if (!data) return setMessaggio("Il documento non è più disponibile");
        const r = { ...(data as unknown as Record<string, unknown>) };
        for (const [k, v] of Object.entries(r)) if (v && typeof v === "object" && "nome" in v) r[k] = (v as { nome: unknown }).nome;
        setScheda(r);
      });
    };
    apriDaIndirizzo();
    window.addEventListener("hashchange", apriDaIndirizzo);
    return () => window.removeEventListener("hashchange", apriDaIndirizzo);
  }, [cfg.tabella, cfg.select]);

  // Arrivo dalle richieste di intervento: nuovo rapportino già compilato, oppure il rapportino collegato
  useEffect(() => {
    if (cfg.sezione !== "rapporti") return;
    const nuovo = sessionStorage.getItem("nuovo-rapporto");
    const daAprire = sessionStorage.getItem("apri-rapporto");
    sessionStorage.removeItem("nuovo-rapporto");
    sessionStorage.removeItem("apri-rapporto");
    if (nuovo) {
      try { apriNuovo(JSON.parse(nuovo)); } catch { /* dati non validi */ }
    } else if (daAprire) {
      supabase.from(cfg.tabella).select(cfg.select ?? "*").eq("id", Number(daAprire)).single().then(({ data }) => {
        if (!data) return;
        const r = { ...(data as unknown as Record<string, unknown>) };
        for (const [k, v] of Object.entries(r)) if (v && typeof v === "object" && "nome" in v) r[k] = (v as { nome: unknown }).nome;
        setScheda(r);
      });
    }
  }, [cfg.sezione]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvaNascoste = (n: string[]) => {
    setNascoste(n);
    try {
      localStorage.setItem(chiaveLayout(cfg.sezione), JSON.stringify(n));
    } catch {
      /* archiviazione locale non disponibile */
    }
  };

  const nelCestino = vista.tipo === "cestino";
  // Memorizzati: la griglia ricalcola filtri e ordinamento solo quando cambiano davvero
  const idArchivio = vista.tipo === "archivio" ? vista.id : null;
  const rapida = vista.tipo === "rapida" ? cfg.visteRapide?.[vista.indice] : undefined;
  const righeVista = useMemo(
    () => righe.filter((r) =>
      nelCestino ? !!r.eliminato_il
        : !r.eliminato_il && (idArchivio === null || r.archivio_id === idArchivio) && (!rapida || rapida.filtro(r)),
    ),
    [righe, nelCestino, idArchivio, rapida],
  );
  // Materiali: pulsanti rapidi per categoria (se manca quella salvata vale quella proposta dalla descrizione)
  const categoriaDiRiga = (r: Riga) => String(r.categoria || categoriaDa(r.descrizione));
  const conteggiCategorie = useMemo(() => {
    const conta = new Map<string, number>();
    if (cfg.sezione === "materiali") for (const r of righeVista) {
      const c = categoriaDiRiga(r);
      conta.set(c, (conta.get(c) ?? 0) + 1);
    }
    return conta;
  }, [cfg.sezione, righeVista]);
  const righeFiltrate = useMemo(
    () => (categoriaRapida ? righeVista.filter((r) => categoriaDiRiga(r) === categoriaRapida) : righeVista),
    [righeVista, categoriaRapida],
  );
  // Senza il permesso "Totali" le colonne con totali e importi non compaiono (né nella griglia né nell'esportazione Excel)
  const colonne = useMemo(() => senzaPrezzi(cfg.colonne, vedePrezzi).filter((c) => !nascoste.includes(c.chiave)), [cfg.colonne, nascoste, vedePrezzi]);
  const rigaSel = righeVista.find((r) => r.id === selezionata);
  // Nome leggibile nelle conferme: il cliente o la descrizione invece, per esempio, della data
  const colonnaNome = cfg.colonne.find((c) => /nome|fornitore|cliente|descrizione|impianto/i.test(c.chiave)) ?? cfg.colonne[0];
  const nomeDi = (r: Riga) => String(r[colonnaNome.chiave] ?? r[cfg.colonne[0].chiave] ?? "");

  const aggiorna = async (id: number, campi: Record<string, unknown>, azione: string, nome: string) => {
    const { error } = await supabase.from(cfg.tabella).update(campi).eq("id", id);
    if (error) {
      setMessaggio("Errore: " + error.message);
      return false;
    }
    await registra(`${cfg.sezione}_${azione}`, { id, nome });
    await carica();
    return true;
  };

  // Propone la categoria a tutti i materiali che non ne hanno una: quelle già scelte non cambiano
  const assegnaCategorie = async () => {
    const senza = righe.filter((r) => !r.categoria);
    if (!senza.length) return setMessaggio("Tutti i materiali hanno già una categoria.");
    if (!confirm(`Assegnare la categoria a ${senza.length} materiali in base alla descrizione?\n\nQuelli incerti finiscono in "Da controllare". Le categorie si possono cambiare in ogni scheda.`)) return;
    const gruppi = new Map<string, number[]>();
    for (const r of senza) {
      const c = categoriaDa(r.descrizione);
      gruppi.set(c, [...(gruppi.get(c) ?? []), r.id]);
    }
    let fatti = 0;
    for (const [categoria, ids] of gruppi) {
      for (let i = 0; i < ids.length; i += 200) {
        const parte = ids.slice(i, i + 200);
        const { error } = await supabase.from(cfg.tabella).update({ categoria }).in("id", parte);
        if (error) return setMessaggio(`Errore: ${error.message} (assegnati ${fatti} su ${senza.length})`);
        fatti += parte.length;
        setMessaggio(`Assegnazione categorie… ${fatti} di ${senza.length}`);
      }
    }
    await registra("materiali_categorie_assegnate", { quanti: fatti });
    setMessaggio(`Categorie assegnate a ${fatti} materiali. I dubbi sono in Filtri → Categorie da controllare.`);
    carica();
  };

  const spostaNelCestino = async (r: Riga) => {
    if (!confirm(`Eliminare "${nomeDi(r)}"?\n\nVerrà spostato nel Cestino (Azioni → Cestino), da dove si può ripristinare. ` +
      "I documenti già fatti (es. rapporti di intervento) restano invariati e non verrà più proposto nelle nuove schede.")) return;
    if (await aggiorna(r.id, { eliminato_il: new Date().toISOString() }, "eliminato", nomeDi(r))) {
      setSelezionata(null);
      setScheda(null);
    }
  };

  const ripristina = async (r: Riga) => {
    if (await aggiorna(r.id, { eliminato_il: null }, "ripristinato", nomeDi(r))) setSelezionata(null);
  };

  const eliminaDefinitivo = async (r: Riga) => {
    if (!confirm(`Eliminare definitivamente "${nomeDi(r)}"? L'operazione non si può annullare.\n\n` +
      "I documenti collegati (es. rapporti di intervento) perderanno il riferimento. Se vuoi solo toglierlo dagli elenchi, lascialo nel Cestino.")) return;
    const { error } = await supabase.from(cfg.tabella).delete().eq("id", r.id);
    if (error) return setMessaggio("Errore: " + error.message);
    await registra(`${cfg.sezione}_eliminato_definitivamente`, { id: r.id, nome: nomeDi(r) });
    setSelezionata(null);
    carica();
  };

  // Più righe spuntate insieme: nel Cestino, ripristino, eliminazione definitiva
  const suSpuntate = async (azione: "cestino" | "ripristina" | "definitivo") => {
    const elenco = selezionate;
    if (!elenco.length) return;
    const n = elenco.length === 1 ? `"${nomeDi(elenco[0])}"` : `${elenco.length} elementi`;
    const domanda = {
      cestino: `Eliminare ${n}?\n\nVerranno spostati nel Cestino (Azioni → Cestino), da dove si possono ripristinare.`,
      ripristina: `Ripristinare ${n} dal Cestino?`,
      definitivo: `Eliminare DEFINITIVAMENTE ${n}? L'operazione non si può annullare.\n\nI documenti collegati perderanno il riferimento.`,
    }[azione];
    if (!confirm(domanda)) return;
    const ids = elenco.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 200) {
      const parte = ids.slice(i, i + 200);
      const { error } = azione === "definitivo"
        ? await supabase.from(cfg.tabella).delete().in("id", parte)
        : await supabase.from(cfg.tabella).update({ eliminato_il: azione === "cestino" ? new Date().toISOString() : null }).in("id", parte);
      if (error) { setMessaggio("Errore: " + error.message); carica(); return; }
    }
    const fatto = { cestino: "eliminato", ripristina: "ripristinato", definitivo: "eliminato_definitivamente" }[azione];
    await registra(`${cfg.sezione}_${fatto}`, { id: ids, nomi: elenco.slice(0, 50).map(nomeDi) });
    setMessaggio(`${elenco.length === 1 ? "1 elemento" : `${elenco.length} elementi`} ${{ cestino: "spostati nel Cestino", ripristina: "ripristinati", definitivo: "eliminati definitivamente" }[azione]}`);
    setSelezionata(null);
    carica();
  };

  const spostaInArchivio = async (r: Riga, archivio: Cartella | null) => {
    if (await aggiorna(r.id, { archivio_id: archivio?.id ?? null }, "spostato", nomeDi(r))) {
      setScheda(null);
      setMessaggio(archivio ? `"${nomeDi(r)}" spostato in ${archivio.nome}` : `"${nomeDi(r)}" tolto dall'archivio`);
    }
  };

  const nuovoArchivio = async () => {
    const nome = prompt("Nome del nuovo archivio:")?.trim();
    if (!nome) return;
    const { data, error } = await supabase.from("archivi").insert({ sezione: cfg.sezione, nome }).select("id, nome").single();
    if (error) return setMessaggio("Errore: " + error.message);
    await carica();
    setVista({ tipo: "archivio", ...data });
  };

  const eliminaArchivio = async (a: Cartella) => {
    if (!confirm(`Eliminare l'archivio "${a.nome}"? I record contenuti restano nell'elenco completo.`)) return;
    const { error } = await supabase.from("archivi").delete().eq("id", a.id);
    if (error) return setMessaggio("Errore: " + error.message);
    setVista({ tipo: "tutti" });
    carica();
  };

  const esporta = async () => {
    const intestazione = colonne.map((c) => ({ value: c.excel, fontWeight: "bold" as const }));
    const dati = visibili.map((r) => colonne.map((c) => ({ type: String, value: testo(r[c.chiave]) })));
    await writeXlsxFile([intestazione, ...dati], { fileName: `${cfg.titolo}.xlsx` });
    await registra(`${cfg.sezione}_esportato`, { righe: visibili.length });
  };

  const stampa = () => {
    const finestra = window.open("", "_blank");
    if (!finestra) return setMessaggio("Errore: il browser ha bloccato la finestra di stampa");
    const esc = (v: unknown) => testo(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    finestra.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(cfg.titolo)}</title>
      <style>body{font:11px Arial,sans-serif;margin:16px}h1{font-size:16px;margin:0 0 8px}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}
      th{background:#eee}@page{size:landscape;margin:10mm}${stileRiservato}</style></head><body>
      ${intestazioneRiservata(esc(titoloVista))}<table><thead><tr>${colonne.filter((c) => c.tipo !== "immagine" && c.tipo !== "miniatura").map((c) => `<th>${esc(c.titolo)}</th>`).join("")}</tr></thead>
      <tbody>${visibili.map((r) => `<tr>${colonne.filter((c) => c.tipo !== "immagine" && c.tipo !== "miniatura").map((c) => `<td${["euro", "numero", "percentuale"].includes(c.tipo ?? "") ? ' style="text-align:right;white-space:nowrap"' : ""}>${esc(mostraValore(c, r))}</td>`).join("")}</tr>`).join("")}</tbody></table>
      <script>window.onload=()=>{const i=document.querySelector("img");if(i&&!i.complete){i.onload=i.onerror=()=>window.print()}else window.print()}</script></body></html>`);
    finestra.document.close();
  };

  // Importazione dall'export Excel del programma originale: aggiorna i record esistenti (stesso nome), aggiunge i nuovi
  const importa = async (file: File) => {
    setMessaggio("Lettura del file…");
    try {
      const celle = await readXlsxFile(file);
      const indiceIntestazione = celle.findIndex((r) => r.some((v) => cfg.colonne.some((c) => normalizza(c.excel) === normalizza(v))));
      if (indiceIntestazione < 0) throw new Error("Il file non contiene le colonne attese");
      const intestazione = celle[indiceIntestazione].map(normalizza);
      // Colonne della griglia + colonne aggiuntive che possono esserci nell'export (es. Ora inizio)
      const colonneImport = [
        ...cfg.colonne.filter((c) => c.tipo !== "immagine" && c.tipo !== "miniatura")
          .map((c) => ({ chiave: c.chiave, excel: [c.excel], tipo: c.tipo as string | undefined, extra: false })),
        ...(cfg.importaExtra ?? []).map((e) => ({ chiave: e.chiave, excel: e.excel, tipo: e.tipo as string | undefined, extra: true })),
      ];
      const mappa = colonneImport
        .map((c) => ({ ...c, i: intestazione.findIndex((h) => c.excel.some((x) => normalizza(x) === h)) }))
        .filter((m) => m.i >= 0);

      // Valori ammessi per i campi a scelta (valori sconosciuti vengono lasciati vuoti)
      const ammessi: Record<string, Set<string>> = {};
      for (const c of cfg.campi.filter((c) => c.opzioniDa)) {
        const { data } = await supabase.from(c.opzioniDa!).select("nome");
        ammessi[c.chiave] = new Set((data ?? []).map((o) => o.nome));
      }

      const chiavi = Array.isArray(cfg.chiaveImport) ? cfg.chiaveImport : [cfg.chiaveImport];
      const chiaveDi = (o: Record<string, unknown>) => chiavi.map((k) => normalizza(o[k])).join("|");
      const colonnaDi = (k: string) => cfg.colonne.find((c) => c.chiave === k);

      const record = celle
        .slice(indiceIntestazione + 1)
        .map((r) => {
          const o: Record<string, string | null> = {};
          for (const m of mappa) {
            const v = r[m.i];
            // Le colonne aggiuntive vuote non cancellano valori ricavati da altre colonne
            if (m.extra && vuoto(v)) continue;
            // Ora contenuta nella data (es. 19/10/2026 18:30) → ora inizio/fine, come nell'agenda originale
            const oraIn = colonnaDi(m.chiave)?.oraIn;
            const ora = v instanceof Date ? oraExcel(v) : null;
            if (oraIn && ora && ora !== "00:00") for (const k of oraIn) (o as Record<string, unknown>)[k] = ora;
            const tipo = m.tipo;
            (o as Record<string, unknown>)[m.chiave] =
              tipo === "data" ? dataExcel(v)
              : tipo === "ora" ? oraExcel(v)
              : tipo === "booleano" ? v === 1 || v === true || ["1", "si", "sì", "true", "vero"].includes(normalizza(v))
              : tipo === "euro" ? (vuoto(v) || isNaN(Number(v)) ? 0 : Math.round(Number(v) * 10000) / 10000)
              : tipo === "numero" || tipo === "percentuale" ? (vuoto(v) || isNaN(Number(String(v).replace(",", "."))) ? 0 : Number(String(v).replace(",", ".")))
              : vuoto(v) ? null : String(v).trim();
            if (ammessi[m.chiave] && o[m.chiave] && !ammessi[m.chiave].has(o[m.chiave]!)) o[m.chiave] = null;
          }
          return o;
        })
        .filter((o) => chiavi.some((k) => !vuoto(o[k])));

      const esistenti = new Map(righe.map((r) => [chiaveDi(r), r]));
      const idEsistente = new Map(record.map((o) => [o, esistenti.get(chiaveDi(o))?.id]));

      // Colonne collegate (es. Cliente): il nome viene trasformato nell'id del record collegato
      let nonTrovati = 0;
      for (const c of cfg.colonne.filter((c) => c.riferimento && mappa.some((m) => m.chiave === c.chiave))) {
        const collegati = await leggiTutto(c.riferimento!.tabella, "id, nome");
        const perNome = new Map(collegati.map((r) => [normalizza(r.nome), r.id]));
        // Nomi non presenti: si propone di crearli, per non perdere il collegamento
        const mancanti = [...new Map(record
          .map((o) => o[c.chiave])
          .filter((nome): nome is string => !!nome && !perNome.has(normalizza(nome)))
          .map((nome) => [normalizza(nome), nome.trim()])).values()];
        if (mancanti.length && confirm(
          `${mancanti.length} nomi della colonna "${c.titolo}" non sono presenti in ${c.riferimento!.tabella}:\n` +
          mancanti.slice(0, 15).join("\n") + (mancanti.length > 15 ? "\n…" : "") +
          `\n\nVuoi crearli automaticamente?`,
        )) {
          const { data, error } = await supabase.from(c.riferimento!.tabella).insert(mancanti.map((nome) => ({ nome }))).select("id, nome");
          if (error) throw error;
          for (const r of data ?? []) perNome.set(normalizza(r.nome), r.id);
        }
        for (const o of record) {
          const nome = o[c.chiave];
          const id = nome ? perNome.get(normalizza(nome)) : undefined;
          if (nome && id === undefined) nonTrovati++;
          (o as Record<string, unknown>)[c.riferimento!.campo] = id ?? null;
          delete o[c.chiave];
        }
      }

      const nuovi = record.filter((o) => idEsistente.get(o) === undefined);
      const daAggiornare = record.filter((o) => idEsistente.get(o) !== undefined);
      const avviso = nonTrovati ? `\n\nAttenzione: ${nonTrovati} righe fanno riferimento a nomi non presenti in anagrafica e resteranno senza collegamento.` : "";

      if (!confirm(`Trovate ${record.length} righe nel file:\n• ${nuovi.length} nuove da aggiungere\n• ${daAggiornare.length} già presenti da aggiornare${avviso}\n\nProcedere?`)) {
        setMessaggio("");
        return;
      }

      for (let i = 0; i < nuovi.length; i += 500) {
        setMessaggio(`Importazione… ${i} / ${nuovi.length}`);
        const { error } = await supabase.from(cfg.tabella).insert(nuovi.slice(i, i + 500));
        if (error) throw error;
      }
      for (const [n, o] of daAggiornare.entries()) {
        if (n % 50 === 0) setMessaggio(`Aggiornamento… ${n} / ${daAggiornare.length}`);
        const { error } = await supabase.from(cfg.tabella).update(o).eq("id", idEsistente.get(o)!);
        if (error) throw error;
      }
      await registra(`${cfg.sezione}_importato`, { file: file.name, nuovi: nuovi.length, aggiornati: daAggiornare.length });
      setMessaggio(`Importazione completata: ${nuovi.length} aggiunti, ${daAggiornare.length} aggiornati`);
      carica();
    } catch (e) {
      setMessaggio("Errore: " + (e as Error).message);
    }
  };

  const voce = (Icona: typeof RefreshCw, colore: string, etichetta: string, azione: () => void, abilitata = true, freccia = false) =>
    abilitata && (
      <button
        key={etichetta}
        onClick={(e) => {
          if (freccia) {
            e.stopPropagation();
            setMenu(menu === "tabella" ? "azioni" : "tabella");
            return;
          }
          setMenu("");
          azione();
        }}
      >
        <Icona size={22} strokeWidth={1.6} color={colore} />
        <span>{etichetta}</span>
        {freccia && <ChevronRight size={14} className="freccia-sotto" />}
      </button>
    );

  const titoloVista =
    vista.tipo === "cestino" ? `${cfg.titolo} - Cestino`
    : vista.tipo === "archivio" ? `${cfg.titolo} - ${vista.nome}`
    : rapida ? `${cfg.titolo} - ${rapida.nome}` : cfg.titolo;

  return (
    <div className="pagina-archivio" onClick={() => menu && setMenu("")}>
      <div className="testata">
        <h1>{titoloVista}</h1>
        <div className="ricerca">
          <select value={colonnaRicerca} onChange={(e) => setColonnaRicerca(e.target.value)} title="Colonna in cui cercare">
            <option value="">Tutte le colonne</option>
            {colonne.filter((c) => c.tipo !== "immagine" && c.tipo !== "miniatura" && c.tipo !== "booleano").map((c) => (
              <option key={c.chiave} value={c.chiave}>{c.titolo}</option>
            ))}
          </select>
          <label>
            <Search size={16} />
            <input
              type="search"
              placeholder={colonnaRicerca ? `Cerca in "${colonne.find((c) => c.chiave === colonnaRicerca)?.titolo ?? ""}"…` : "Cerca in tutte le colonne…"}
              value={ricerca}
              onChange={(e) => setRicerca(e.target.value)}
            />
          </label>
          <MicDettatura onTesto={setRicerca} />
        </div>
        <div className="pulsanti" onClick={(e) => e.stopPropagation()}>
          {cfg.galleria && (
            <>
              <button className={`btn giallo${galleria ? " attivo" : ""}`} onClick={() => setGalleria(true)}>Galleria</button>
              <button className={`btn giallo${galleria ? "" : " attivo"}`} onClick={() => setGalleria(false)}>Tabella</button>
            </>
          )}
          {cfg.sezione === "ddt_acquisto" && !nelCestino && vedePrezzi && puo(cfg.sezione, "creare") && (
            <button className="btn blu" onClick={() => setImportaPdf(true)} title="Legge il DDT dal PDF del fornitore">Da PDF</button>
          )}
          {puo(cfg.sezione, "creare") && !nelCestino && (
            <button className="btn blu" onClick={() => apriNuovo()}>Nuovo</button>
          )}
          <div className="tendina">
            <button className="btn verde" onClick={() => setMenu(menu ? "" : "azioni")}>Azioni <span className="punta">⌵</span></button>
            {(menu === "azioni" || menu === "tabella") && (
              <div className="voci con-icone">
                {voce(RefreshCw, "#b59b1b", "Aggiorna", carica)}
                {cfg.sezione === "materiali" && voce(Filter, "#3a7dc0", "Assegna categorie automatiche", assegnaCategorie, profilo?.ruolo === "admin")}
                {voce(Sheet, "#4a8a3a", "Tabella", () => {}, true, true)}
                {voce(FileDown, "#3a8a3a", "Esporta", esporta, puo(cfg.sezione, "esportare"))}
                {voce(Printer, "#444", "Stampa", stampa, puo(cfg.sezione, "esportare"))}
                {cfg.sezione === "richieste" && rigaSel && !["Completata", "Annullata"].includes(String(rigaSel.stato)) && voce(UserCheck, "#8e44ad", `Prendi in carico "${nomeDi(rigaSel)}"`,
                  () => { prendiInCarico(rigaSel).then((ok) => { if (ok) carica(); }); })}
                {cfg.sezione === "materiali" && selezionate.length > 0 && voce(QrCode, "#123b45", `Etichette QR dei materiali spuntati (${selezionate.length})`,
                  () => stampaEtichette(selezionate).catch((e) => setMessaggio("Errore: " + (e as Error).message)))}
                {cfg.sezione === "materiali" && !selezionate.length && rigaSel && voce(QrCode, "#123b45", `Etichetta QR di "${nomeDi(rigaSel)}"`,
                  () => stampaEtichette([rigaSel]).catch((e) => setMessaggio("Errore: " + (e as Error).message)))}
                {cfg.sezione === "materiali" && voce(QrCode, "#123b45", `Etichette QR dei materiali in elenco (${visibili.length})`, () => {
                  if (visibili.length > 48 && !confirm(`Stampare le etichette di ${visibili.length} materiali (${Math.ceil(visibili.length / 24)} fogli)?\nPer stamparne solo alcuni, filtra prima l'elenco (es. con la ricerca).`)) return;
                  stampaEtichette(visibili).catch((e) => setMessaggio("Errore: " + (e as Error).message));
                }, visibili.length > 0)}
                {selezionate.length > 0 ? (
                  <>
                    {!nelCestino && voce(Trash2, "#d9342b", `Elimina ${selezionate.length === 1 ? "lo spuntato" : `i ${selezionate.length} spuntati`}`, () => suSpuntate("cestino"), puo(cfg.sezione, "eliminare"))}
                    {nelCestino && voce(Undo2, "#3a7dc0", `Ripristina ${selezionate.length === 1 ? "lo spuntato" : `i ${selezionate.length} spuntati`}`, () => suSpuntate("ripristina"), puo(cfg.sezione, "eliminare"))}
                    {nelCestino && voce(Trash2, "#d9342b", `Elimina definitivamente ${selezionate.length === 1 ? "lo spuntato" : `i ${selezionate.length} spuntati`}`, () => suSpuntate("definitivo"), puo(cfg.sezione, "eliminare"))}
                  </>
                ) : (
                  <>
                    {!nelCestino && rigaSel && voce(Trash2, "#d9342b", `Elimina "${nomeDi(rigaSel)}"`, () => spostaNelCestino(rigaSel), puo(cfg.sezione, "eliminare"))}
                    {nelCestino && rigaSel && voce(Undo2, "#3a7dc0", "Ripristina", () => ripristina(rigaSel), puo(cfg.sezione, "eliminare"))}
                    {nelCestino && rigaSel && voce(Trash2, "#d9342b", "Elimina definitivamente", () => eliminaDefinitivo(rigaSel), puo(cfg.sezione, "eliminare"))}
                  </>
                )}
                {nelCestino
                  ? voce(Undo2, "#666", "Esci dal Cestino", () => setVista({ tipo: "tutti" }))
                  : voce(Trash2, "#666", "Cestino", () => setVista({ tipo: "cestino" }), puo(cfg.sezione, "eliminare"))}
                {menu === "tabella" && (
                  <div className="voci con-icone sottomenu" onClick={(e) => e.stopPropagation()}>
                    {voce(Columns3, "#3a7dc0", "Scegli colonne", () => setSceltaColonne(true))}
                    {voce(RotateCcw, "#666", "Ripristina colonne", () => salvaNascoste([]))}
                    {voce(FileUp, "#3a8a3a", "Importa da Excel", () => fileRef.current?.click(),
                      !nelCestino && puo(cfg.sezione, "creare") && puo(cfg.sezione, "modificare"))}
                    {["rapporti", "preventivi", "ddt_acquisto", "scadenziario", "richieste"].includes(cfg.sezione) && voce(Database, "#d9822b", "Importa da ReportOne (file .json)", () => setImportaReportOne(true),
                      !nelCestino && profilo?.ruolo === "admin")}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="tendina">
            <button className="btn verde" onClick={() => setMenu(menu === "archivi" ? "" : "archivi")}>Filtri <span className="punta">⌵</span></button>
            {menu === "archivi" && (
              <div className="voci con-icone">
                {voce(Folder, "#f5a623", "Elenco completo", () => setVista({ tipo: "tutti" }))}
                {cartelle.map((a) => voce(FolderOpen, "#f5a623", a.nome, () => setVista({ tipo: "archivio", ...a })))}
                {cfg.visteRapide?.map((v, i) => voce(Filter, "#3a7dc0", v.nome, () => setVista({ tipo: "rapida", indice: i })))}
                {voce(FolderPlus, "#3a7dc0", "Nuovo Archivio", nuovoArchivio, puo(cfg.sezione, "modificare"))}
                {vista.tipo === "archivio" &&
                  voce(Trash2, "#d9342b", `Elimina archivio "${vista.nome}"`, () => eliminaArchivio(vista), puo(cfg.sezione, "eliminare"))}
              </div>
            )}
          </div>
        </div>
      </div>

      <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) importa(f);
      }} />
      {messaggio && <p className={messaggio.startsWith("Errore") ? "errore" : "ok"}>{messaggio}</p>}

      {cfg.sezione === "richieste" && <BannerNotifiche />}
      {cfg.sezione === "materiali" && <FiltriCategoria valore={categoriaRapida} onCambia={setCategoriaRapida} conteggi={conteggiCategorie} />}

      {galleria && cfg.galleria && (
        <Galleria cfg={cfg} righe={visibili} archivio={cfg.sezione} onApri={(r) => setScheda(r)} />
      )}
      <div style={{ display: galleria ? "none" : "contents" }}>
      <Griglia
        key={vista.tipo + (vista.tipo === "archivio" ? vista.id : vista.tipo === "rapida" ? vista.indice : "")}
        colonne={colonne}
        righe={righeFiltrate}
        selezionata={selezionata}
        onSeleziona={setSelezionata}
        onApri={(r) => setScheda(r)}
        onVisibili={setVisibili}
        ordineIniziale={rapida?.ordine ?? cfg.ordineIniziale}
        ricerca={ricerca}
        colonnaRicerca={colonnaRicerca}
        onSpunta={!nelCestino && puo(cfg.sezione, "modificare") ? spunta : undefined}
        selezionabile={!cfg.colonne.some((c) => c.somma)}
        onSelezionate={setSelezionate}
        azioniRiga={(r) => [
          { testo: "Apri", esegui: () => setScheda(r) },
          ...(cfg.sezione === "richieste" && !["Completata", "Annullata"].includes(String(r.stato))
            ? [{ testo: "Prendi in carico", esegui: () => { prendiInCarico(r).then((ok) => { if (ok) carica(); }); } }]
            : []),
          ...(puoWhatsapp && ["clienti", "fornitori"].includes(cfg.sezione) && (linkWhatsapp(r.cellulare) ?? linkWhatsapp(r.telefono))
            ? [{ testo: "Scrivi su WhatsApp", esegui: () => window.open((linkWhatsapp(r.cellulare) ?? linkWhatsapp(r.telefono))!, "_blank", "noopener") }]
            : []),
          ...(puo(cfg.sezione, "eliminare")
            ? nelCestino
              ? [
                  { testo: "Ripristina", esegui: () => ripristina(r) },
                  { testo: "Elimina definitivamente", pericolo: true, esegui: () => eliminaDefinitivo(r) },
                ]
              : [{ testo: "Elimina", pericolo: true, esegui: () => spostaNelCestino(r) }]
            : []),
        ]}
      />
      </div>

      {scheda && (
        <Scheda
          cfg={cfg}
          valori={scheda}
          cartelle={cartelle}
          nelCestino={nelCestino}
          onChiudi={() => setScheda(null)}
          onSalvato={(id) => {
            // Richiesta salvata: avviso sul telefono al tecnico scelto, o a tutti i tecnici se non è assegnata
            if (cfg.sezione === "richieste") avvisaRichiesta(id).then((m) => { if (m) setMessaggio(m); });
            // Rapportino creato da una richiesta di intervento: la richiesta diventa "Completata"
            if (scheda?._richiesta_id && scheda.id === undefined) {
              supabase.rpc("completa_richiesta", { p_richiesta: scheda._richiesta_id, p_rapporto: id })
                .then(({ error }) => setMessaggio(error ? "Rapportino salvato, ma la richiesta non è stata chiusa: " + error.message : "Rapportino salvato: la richiesta di intervento è stata completata"));
            }
            // Nelle viste rapide (es. materiali senza foto) si passa subito all'articolo successivo
            const i = visibili.findIndex((r) => r.id === id);
            const successivo = rapida && i >= 0 ? visibili[i + 1] : undefined;
            setScheda(successivo ?? null);
            setSelezionata(successivo?.id ?? id);
            carica();
          }}
          onElimina={() => spostaNelCestino(scheda as Riga)}
          onSposta={(a) => spostaInArchivio(scheda as Riga, a)}
          onRipristina={async () => { await ripristina(scheda as Riga); setScheda(null); }}
        />
      )}

      {importaReportOne && <ImportaReportOne onChiudi={() => setImportaReportOne(false)} onFinito={carica} />}
      {importaPdf && <ImportaDdtPdf onChiudi={() => setImportaPdf(false)} onFinito={carica} onCorreggi={(v) => { setImportaPdf(false); setScheda(v); }} />}
      {sceltaColonne && (
        <div className="velo" onMouseDown={() => setSceltaColonne(false)}>
          <div className="finestra stretta" onMouseDown={(e) => e.stopPropagation()}>
            <div className="finestra-titolo">Colonne visibili<button className="chiudi" onClick={() => setSceltaColonne(false)}>×</button></div>
            <div className="finestra-corpo elenco-colonne">
              {senzaPrezzi(cfg.colonne, vedePrezzi).map((c) => (
                <label key={c.chiave} className="interruttore">
                  <input
                    type="checkbox"
                    checked={!nascoste.includes(c.chiave)}
                    onChange={(e) => salvaNascoste(e.target.checked ? nascoste.filter((n) => n !== c.chiave) : [...nascoste, c.chiave])}
                  />
                  {c.titolo}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Vista a schede con fotografia (es. Materiali → Galleria)
function Galleria({ cfg, righe, archivio, onApri }: {
  cfg: Archivio;
  righe: Riga[];
  archivio: string;
  onApri: (r: Riga) => void;
}) {
  const g = cfg.galleria!;
  const [quante, setQuante] = useState(120);
  const mostrate = righe.slice(0, quante);
  return (
    <div className="galleria" onScroll={(e) => {
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight > el.scrollHeight - 300 && quante < righe.length) setQuante((q) => q + 120);
    }}>
      {mostrate.map((r) => (
        <button key={r.id} className="carta" onDoubleClick={() => onApri(r)} onClick={() => onApri(r)}>
          <div className="carta-foto">
            {typeof r[g.foto] === "string" && r[g.foto] ? <Miniatura percorso={r[g.foto] as string} archivio={archivio} /> : <span>Nessuna foto</span>}
          </div>
          <div className="carta-titolo">{String(r[g.titolo] ?? "")}</div>
          <div className="carta-dettagli">{g.dettagli(r)}</div>
        </button>
      ))}
    </div>
  );
}
