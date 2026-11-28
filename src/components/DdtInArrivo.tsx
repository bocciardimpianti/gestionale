import { useEffect, useState } from "react";
import { CloudDownload, RefreshCw } from "lucide-react";
import { supabase } from "../supabase";
import { controllaDrive, importaDdtInArrivo, RIPROVA_A_MANO, type InArrivo } from "../ddtAutomatici";
import ImportaDdtPdf from "./ImportaDdtPdf";
import { recuperaOriginali } from "../ddtOriginali";

// DDT di Acquisto: i PDF arrivati dalla cartella Google Drive. Quelli sicuri si importano da soli;
// quelli da controllare si aprono qui nella finestra "Importa DDT da PDF" già caricati.

const STATI: Record<string, { testo: string; classe: string }> = {
  da_importare: { testo: "In coda", classe: "giallo" },
  in_corso: { testo: "Importazione…", classe: "giallo" },
  importato: { testo: "Importato", classe: "verde" },
  da_controllare: { testo: "Da controllare", classe: "rosso" },
  errore: { testo: "Errore", classe: "rosso" },
  scartato: { testo: "Scartato", classe: "grigio" },
};

export default function DdtInArrivo({ onFinito, puoImportare, onCorreggi }: {
  onFinito: () => void; puoImportare: boolean;
  // "Correggi a mano": si apre la scheda di un nuovo DDT già compilata (il PDF in arrivo viene segnato come sistemato a mano)
  onCorreggi: (valori: Record<string, unknown>) => void;
}) {
  const [righe, setRighe] = useState<InArrivo[] | null>(null);
  const [stato, setStato] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [aperto, setAperto] = useState<{ x: InArrivo; file: File } | null>(null);
  const [tutti, setTutti] = useState(false);
  // Passo dell'importazione automatica in corso
  const [passo, setPasso] = useState("");

  const carica = async () => {
    const settimana = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data, error } = await supabase.from("ddt_in_arrivo").select("*").or(`stato.neq.importato,creato_il.gte.${settimana}`).order("id", { ascending: false }).limit(60);
    if (error) return setRighe(null); // script 0057 non ancora eseguito: il riquadro non si mostra
    setRighe((data ?? []) as InArrivo[]);
  };
  useEffect(() => {
    carica();
    const aggiorna = () => { carica(); onFinito(); };
    const avanza = (e: Event) => { const t = String((e as CustomEvent).detail ?? ""); setPasso(t); if (!t) carica(); };
    window.addEventListener("ddt-in-arrivo", aggiorna);
    window.addEventListener("ddt-avanzamento", avanza);
    return () => { window.removeEventListener("ddt-in-arrivo", aggiorna); window.removeEventListener("ddt-avanzamento", avanza); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const controllaAdesso = async () => {
    setInCorso(true);
    try {
      // Importazioni rimaste a metà (pagina chiusa o bloccata): si rimettono in coda
      const vecchie = (righe ?? []).filter((x) => x.stato === "in_corso" && !passo);
      for (const x of vecchie) await supabase.from("ddt_in_arrivo").update({ stato: "da_importare" }).eq("id", x.id);
      setStato("Controllo della cartella Drive…");
      const d = await controllaDrive().catch((e) => { setStato("Cartella Drive: " + (e as Error).message); return null; });
      await carica();
      const e = await importaDdtInArrivo(setStato);
      if (e.giaInCorso) { await carica(); setInCorso(false); return controllaAdesso(); }
      setStato([
        d ? `${d.nuovi} PDF nuovi su Drive` : "",
        e.importati ? `${e.importati} DDT importati` : "", e.daControllare ? `${e.daControllare} da controllare` : "", e.errori ? `${e.errori} con errori` : "",
      ].filter(Boolean).join(" · ") || "Niente di nuovo.");
      if (e.importati) onFinito();
    } catch (e) { setStato("Errore: " + (e as Error).message); }
    await carica();
    setInCorso(false);
  };

  // DDT importati prima dello script 0064: si riprendono dal PDF codice e descrizione del fornitore
  const recupera = async () => {
    const importati = (righe ?? []).filter((x) => x.stato === "importato" && x.ddt_id);
    if (!importati.length) return setStato("Nessun DDT importato negli ultimi 7 giorni.");
    setInCorso(true);
    let righeFatte = 0, ddtFatti = 0;
    try {
      for (const [k, x] of importati.entries()) {
        setStato(`Rilettura dei PDF: ${k + 1} di ${importati.length} (${x.nome_file})…`);
        const n = await recuperaOriginali(x.ddt_id!);
        if (n) { righeFatte += n; ddtFatti++; }
      }
      setStato(righeFatte ? `Completate ${righeFatte} righe in ${ddtFatti} DDT con codice e descrizione del fornitore.` : "Niente da completare: i DDT hanno già i dati del fornitore.");
    } catch (e) { setStato("Errore: " + (e as Error).message); }
    setInCorso(false);
  };

  const apri = async (x: InArrivo) => {
    const { data, error } = await supabase.storage.from("ddt_acquisto").download(x.percorso);
    if (error || !data) return setStato("PDF non trovato: " + (error?.message ?? ""));
    setAperto({ x, file: new File([data], x.nome_file, { type: "application/pdf" }) });
  };
  const cambiaStato = async (x: InArrivo, stato: string, messaggio: string | null, ddt_id: number | null = null) => {
    await supabase.from("ddt_in_arrivo").update({ stato, messaggio, ddt_id, aggiornato_il: new Date().toISOString() }).eq("id", x.id);
    await carica();
  };

  if (!righe) return null;
  const aperti = righe.filter((x) => x.stato !== "importato" && x.stato !== "scartato");
  const visibili = tutti ? righe : aperti;
  return (
    <div className="ddt-in-arrivo">
      <div className="dia-testa">
        <CloudDownload size={18} />
        <b>DDT in arrivo da Drive</b>
        <span className="piccolo">{aperti.length ? `${aperti.length} da sistemare` : "tutto importato"} · {righe.filter((x) => x.stato === "importato").length} importati negli ultimi 7 giorni</span>
        <span style={{ flex: 1 }} />
        {righe.length > aperti.length && <button type="button" className="link" onClick={() => setTutti(!tutti)}>{tutti ? "Solo da sistemare" : "Mostra tutti"}</button>}
        {puoImportare && <span className="dia-pulsanti">
          <button type="button" className="btn grigio piccolo-btn" disabled={inCorso} onClick={recupera}
            title="Rilegge i PDF dei DDT importati negli ultimi 7 giorni e aggiunge alle righe codice e descrizione scritti dal fornitore">Recupera codici fornitore</button>
          <button type="button" className="btn grigio piccolo-btn" disabled={inCorso} onClick={controllaAdesso}><RefreshCw size={14} /> Controlla adesso</button>
        </span>}
      </div>
      {passo && <p className="piccolo">⏳ {passo}</p>}
      {stato && <p className={stato.startsWith("Errore") || stato.startsWith("Cartella") ? "errore" : "piccolo"}>{stato}</p>}
      {visibili.map((x) => {
        const s = STATI[x.stato] ?? { testo: x.stato, classe: "grigio" };
        return (
          <div key={x.id} className="dia-riga">
            <span className={`etichetta-pdf ${s.classe}`}>{s.testo}</span>
            <span className="dia-testi"><b>{x.nome_file}</b>
              <span className="piccolo">arrivato {new Date(x.creato_il).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{x.messaggio ? ` · ${x.messaggio}` : ""}</span></span>
            {puoImportare && (["da_controllare", "errore"].includes(x.stato) || (x.stato === "in_corso" && !passo)) && <>
              <button type="button" className="btn blu piccolo-btn" onClick={() => apri(x)}>Controlla</button>
              <button type="button" className="btn grigio piccolo-btn" onClick={() => confirm(`Scartare "${x.nome_file}"? Non verrà importato.`) && cambiaStato(x, "scartato", "Scartato a mano")}>Scarta</button>
            </>}
            {puoImportare && x.stato === "scartato" && <button type="button" className="btn grigio piccolo-btn" onClick={() => cambiaStato(x, "da_importare", RIPROVA_A_MANO)}>Riprova</button>}
          </div>
        );
      })}
      {!visibili.length && <p className="piccolo">Metti i PDF dei DDT nella cartella Drive "DDT BOCCIARDI IMPIANTI": vengono importati da soli.</p>}
      {aperto && (
        <ImportaDdtPdf
          fileIniziale={aperto.file}
          onChiudi={() => { setAperto(null); carica(); }}
          onFinito={onFinito}
          onCorreggi={(v) => { const x = aperto.x; setAperto(null); cambiaStato(x, "scartato", "Inserito a mano con la scheda del DDT"); onCorreggi(v); }}
          onSalvatoIniziale={(id, messaggio) => cambiaStato(aperto.x, "importato", messaggio, id)}
        />
      )}
    </div>
  );
}
