import { useEffect, useRef, useState } from "react";
import { Camera, ExternalLink, FileSpreadsheet, FileText, FileUp, Image as IconaFoto, Trash2 } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../auth";
import { urlFirmato } from "./CampoImmagine";
import { TIPI_SPESA } from "../speseAziendali";

// Spese aziendali → "Carica file": PDF, Excel, CSV o foto da cui poi estrarre le spese (script 0050).
// I file restano nell'archivio privato "spese" con lo stato "Da elaborare" finché non vengono letti.

type Documento = {
  id: number; nome_file: string; percorso: string; tipo_file: string | null; dimensione: number | null;
  tipo_spesa: string | null; stato: "Da elaborare" | "Elaborato"; spese_create: number; note: string | null; creato_il: string;
};
const MAX_MB = 25;
const ACCETTA = ".pdf,.xls,.xlsx,.xlsm,.csv,.ods,application/pdf,image/*";
const dimensione = (b: number | null) => (b == null ? "" : b >= 1048576 ? `${(b / 1048576).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const quando = (s: string) => new Date(s).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const genere = (d: { nome_file: string; tipo_file: string | null }) =>
  /pdf/i.test(d.tipo_file ?? "") || /\.pdf$/i.test(d.nome_file) ? "pdf"
    : /sheet|excel|csv|spreadsheet/i.test(d.tipo_file ?? "") || /\.(xlsx?|xlsm|csv|ods)$/i.test(d.nome_file) ? "excel"
      : /^image\//.test(d.tipo_file ?? "") ? "foto" : "altro";

export default function DocumentiSpese({ onChiudi }: { onChiudi: () => void }) {
  const { puo } = useAuth();
  const [documenti, setDocumenti] = useState<Documento[] | null>(null);
  const [errore, setErrore] = useState("");
  const [stato, setStato] = useState("");
  const [filtro, setFiltro] = useState<"Da elaborare" | "Elaborato" | "">("Da elaborare");
  const [tipoSpesa, setTipoSpesa] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [sopra, setSopra] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const puoCaricare = puo("spese_aziendali", "creare");
  const puoEliminare = puo("spese_aziendali", "eliminare");

  const carica = async () => {
    const { data, error } = await supabase.from("documenti_spese").select("*").is("eliminato_il", null).order("creato_il", { ascending: false });
    if (error) {
      setDocumenti([]);
      return setErrore(/documenti_spese|schema cache|does not exist/i.test(error.message) ? "Esegui su Supabase lo script 0050_documenti_spese.sql" : error.message);
    }
    setErrore(""); setDocumenti((data ?? []) as Documento[]);
  };
  useEffect(() => { carica(); }, []);

  const caricaFile = async (files: File[]) => {
    if (!files.length || inCorso) return;
    const troppo = files.filter((f) => f.size > MAX_MB * 1048576);
    if (troppo.length) alert(`Questi file superano ${MAX_MB} MB e non vengono caricati:\n${troppo.map((f) => f.name).join("\n")}`);
    const daCaricare = files.filter((f) => f.size <= MAX_MB * 1048576);
    if (!daCaricare.length) return;
    setInCorso(true);
    let ok = 0; const errori: string[] = [];
    for (const [i, f] of daCaricare.entries()) {
      setStato(`Caricamento ${i + 1} di ${daCaricare.length}: ${f.name}…`);
      const oggi = new Date();
      const nomePulito = f.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-120);
      const percorso = `${oggi.getFullYear()}/${String(oggi.getMonth() + 1).padStart(2, "0")}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${nomePulito}`;
      const su = await supabase.storage.from("spese").upload(percorso, f, { contentType: f.type || undefined, upsert: false });
      if (su.error) { errori.push(`${f.name}: ${su.error.message}`); continue; }
      const { error } = await supabase.from("documenti_spese").insert({
        nome_file: f.name, percorso, tipo_file: f.type || null, dimensione: f.size, tipo_spesa: tipoSpesa || null,
      });
      if (error) { await supabase.storage.from("spese").remove([percorso]); errori.push(`${f.name}: ${error.message}`); continue; }
      ok++;
    }
    setInCorso(false);
    const bucket = errori.some((e) => /bucket|not found/i.test(e));
    setStato(`${ok} file caricati${errori.length ? `, ${errori.length} non riusciti${bucket ? " (esegui lo script 0050_documenti_spese.sql)" : ""}: ${errori.slice(0, 3).join(" · ")}` : "."}`);
    setFiltro("Da elaborare");
    carica();
  };

  const scegli = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    caricaFile(files);
  };
  const apri = async (d: Documento) => {
    const finestra = window.open("", "_blank");
    const url = await urlFirmato("spese", d.percorso);
    if (finestra) { if (url) finestra.location.href = url; else finestra.close(); }
    if (!url) alert("Non riesco ad aprire il file");
  };
  const aggiorna = async (d: Documento, campi: Partial<Documento>) => {
    const { error } = await supabase.from("documenti_spese").update(campi).eq("id", d.id);
    if (error) return alert(error.message);
    setDocumenti((ds) => ds?.map((x) => (x.id === d.id ? { ...x, ...campi } : x)) ?? null);
  };
  const elimina = async (d: Documento) => {
    if (!confirm(`Eliminare definitivamente "${d.nome_file}"?`)) return;
    const { error } = await supabase.from("documenti_spese").delete().eq("id", d.id);
    if (error) return alert(error.message);
    await supabase.storage.from("spese").remove([d.percorso]);
    setDocumenti((ds) => ds?.filter((x) => x.id !== d.id) ?? null);
  };

  const conta = (s: string) => (documenti ?? []).filter((d) => !s || d.stato === s).length;
  const visibili = (documenti ?? []).filter((d) => !filtro || d.stato === filtro);
  const Icona = ({ d }: { d: Documento }) => {
    const g = genere(d);
    return g === "pdf" ? <FileText size={20} color="#d9342b" /> : g === "excel" ? <FileSpreadsheet size={20} color="#3a8a3a" />
      : g === "foto" ? <IconaFoto size={20} color="#3a7dc0" /> : <FileText size={20} color="#898781" />;
  };

  return (
    <div className="velo" onMouseDown={() => !inCorso && onChiudi()}>
      <div className="finestra finestra-documenti-spese" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">File delle spese<button type="button" className="chiudi" disabled={inCorso} onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          {errore && <p className="errore">{errore}</p>}
          {puoCaricare && (
            <div className={`ds-zona${sopra ? " sopra" : ""}${inCorso ? " in-corso" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setSopra(true); }} onDragLeave={() => setSopra(false)}
              onDrop={(e) => { e.preventDefault(); setSopra(false); caricaFile([...e.dataTransfer.files]); }}>
              <FileUp size={30} color="#3a7dc0" />
              <div className="ds-zona-testo">
                <b>{touch ? "Carica i file delle spese" : "Trascina qui i file delle spese"}</b>
                <span>PDF, Excel (.xls, .xlsx), CSV o foto · anche più file insieme · max {MAX_MB} MB l'uno</span>
              </div>
              <div className="ds-zona-comandi">
                <label className="ds-tipo">Tipo (facoltativo)
                  <select value={tipoSpesa} onChange={(e) => setTipoSpesa(e.target.value)}>
                    <option value="">Da capire dal file</option>
                    {TIPI_SPESA.map((t) => <option key={t.nome} value={t.nome}>{t.icona} {t.nome}</option>)}
                  </select>
                </label>
                {touch && <button type="button" className="btn blu" disabled={inCorso} onClick={() => fotoRef.current?.click()}><Camera size={16} /> Scatta</button>}
                <button type="button" className="btn blu" disabled={inCorso} onClick={() => fileRef.current?.click()}><FileUp size={16} /> Scegli file</button>
              </div>
              <input ref={fileRef} type="file" accept={ACCETTA} multiple hidden onChange={scegli} />
              <input ref={fotoRef} type="file" accept="image/*" capture="environment" hidden onChange={scegli} />
            </div>
          )}
          {stato && <p className="piccolo">{stato}</p>}

          <div className="filtri-categoria pillole-sezione ds-filtri">
            {(["Da elaborare", "Elaborato", ""] as const).map((s) => (
              <button type="button" key={s || "tutti"} className={filtro === s ? "attiva" : ""} onClick={() => setFiltro(s)}>
                {s === "" ? "Tutti" : s === "Elaborato" ? "Elaborati" : "Da elaborare"} <span className="conteggio-categoria">{conta(s)}</span>
              </button>
            ))}
          </div>
          {!documenti ? <p className="vuoto-linguetta">Caricamento…</p>
            : !visibili.length ? <p className="vuoto-linguetta">{filtro === "Da elaborare" ? "Nessun file da elaborare." : "Nessun file."}</p>
              : (
                <ul className="ds-elenco">
                  {visibili.map((d) => (
                    <li key={d.id} className="ds-voce">
                      <Icona d={d} />
                      <div className="ds-info">
                        <button type="button" className="ds-nome" onClick={() => apri(d)} title="Apri il file">{d.nome_file}</button>
                        <span className="piccolo">{quando(d.creato_il)} · {dimensione(d.dimensione)}{d.stato === "Elaborato" && d.spese_create ? ` · ${d.spese_create} spese ricavate` : ""}</span>
                      </div>
                      <select className="ds-tipo-voce" value={d.tipo_spesa ?? ""} onChange={(e) => aggiorna(d, { tipo_spesa: e.target.value || null })} aria-label="Tipo di spesa">
                        <option value="">Tipo da capire</option>
                        {TIPI_SPESA.map((t) => <option key={t.nome} value={t.nome}>{t.icona} {t.nome}</option>)}
                      </select>
                      <button type="button" className={`ds-stato ${d.stato === "Elaborato" ? "fatto" : ""}`}
                        title={d.stato === "Elaborato" ? "Segna di nuovo da elaborare" : "Segna come elaborato"}
                        onClick={() => aggiorna(d, { stato: d.stato === "Elaborato" ? "Da elaborare" : "Elaborato" })}>
                        {d.stato === "Elaborato" ? "✓ Elaborato" : "Da elaborare"}
                      </button>
                      <button type="button" className="btn grigio piccolo-btn" onClick={() => apri(d)} title="Apri"><ExternalLink size={14} /></button>
                      {puoEliminare && <button type="button" className="btn grigio piccolo-btn" onClick={() => elimina(d)} title="Elimina"><Trash2 size={14} /></button>}
                    </li>
                  ))}
                </ul>
              )}
          <p className="piccolo ds-nota">I file restano archiviati qui. La lettura automatica delle spese da PDF ed Excel verrà aggiunta quando avremo deciso come interpretarli.</p>
        </div>
        <div className="finestra-piede">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn grigio" disabled={inCorso} onClick={onChiudi}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}
