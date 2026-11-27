import { useEffect, useMemo, useRef, useState } from "react";
import { FileStack, Search, Upload, X } from "lucide-react";
import { dataIso, dataIt, supabase } from "../supabase";
import { PREVENTIVI_FORNITORI, type ProgettoFile } from "../progettiClienti";
import { leggiPdfDdt, umDa } from "../ddtImport";

// Preventivi → "Da fornitore": un'offerta di un fornitore (arrivata per mail, sezione Preventivi fornitori, oppure un PDF
// caricato qui) diventa un nuovo preventivo con i suoi materiali. I materiali già in magazzino restano collegati
// (prezzo dell'offerta + ricarico del materiale), gli altri entrano come righe libere. Poi si modifica come un preventivo
// normale (si aggiungono materiali, si cambiano prezzi) e, salvato, si può impaginare.

type Offerta = ProgettoFile & { cliente?: { nome: string } | null };
const RICARICO_PREDEFINITO = 35;

export default function ImportaPreventivoFornitore({ onChiudi, onPronto }: {
  onChiudi: () => void;
  // Valori del nuovo preventivo (testata + _righe) da aprire nella scheda
  onPronto: (valori: Record<string, unknown>) => void;
}) {
  const [offerte, setOfferte] = useState<Offerta[] | null>(null);
  const [cerca, setCerca] = useState("");
  const [stato, setStato] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const scegli = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("progetti_file").select("*, cliente:clienti(nome)").eq("categoria", PREVENTIVI_FORNITORI.nome).neq("stato", "scartato")
      .order("creato_il", { ascending: false }).limit(300)
      .then(({ data, error }) => { if (error) setStato("Errore: " + error.message); setOfferte((data ?? []) as Offerta[]); });
  }, []);
  const visibili = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return (offerte ?? []).filter((x) => !q || [x.nome_file, x.cliente?.nome, x.mail?.oggetto].some((t) => String(t ?? "").toLowerCase().includes(q)));
  }, [offerte, cerca]);

  // Dal PDF al nuovo preventivo
  const converti = async (file: Blob, nome: string, offerta?: Offerta) => {
    setInCorso(true);
    try {
      const l = await leggiPdfDdt(file, nome, setStato);
      if (!l.righe.length) throw new Error("Nel PDF non ho trovato righe di materiali: inserisci il preventivo a mano con \"Nuovo\".");
      const fornitore = l.fornitori.find((f) => f.id === l.fornitoreId);
      const righe = l.righe.map((r, i) => {
        const m = r.materiale && (r.confermata || ["ricordato", "codice", "proposta", "scelto"].includes(r.stato)) ? r.materiale : null;
        const prezzoBase = Math.round(Number(r.pdf.prezzo || 0) * 10000) / 10000;
        const ricarico = m && m.ricarico != null ? Number(m.ricarico) : RICARICO_PREDEFINITO;
        return {
          ordine: i, materiale_id: m?.id ?? null,
          codice_barre: m ? (m.codice_barre ?? m.codice_interno ?? null) : r.pdf.codice || null,
          descrizione: m ? m.descrizione : r.pdf.descrizione,
          unita_misura: m ? m.unita_misura : umDa(r.pdf.um),
          quantita: r.pdf.quantita || 1,
          prezzo_base: prezzoBase, ricarico,
          prezzo: Math.round(prezzoBase * (1 + ricarico / 100) * 10000) / 10000,
          totale: Math.round((r.pdf.quantita || 1) * prezzoBase * (1 + ricarico / 100) * 100) / 100,
        };
      });
      const collegati = righe.filter((r) => r.materiale_id).length;
      const rif = [fornitore?.nome ?? "", l.ddt.numeroDdt ? `n. ${l.ddt.numeroDdt}` : "", l.ddt.data ? `del ${dataIt(l.ddt.data)}` : ""].filter(Boolean).join(" ");
      onPronto({
        data: dataIso(new Date()), stato: "Aperto", sconto: 0, iva: 0,
        numero: offerta?.mail?.oggetto?.split("*")[1]?.trim() || `Da offerta ${rif}`.trim(),
        ...(offerta?.cliente_id ? { cliente_id: offerta.cliente_id, cliente: offerta.cliente?.nome ?? "" } : {}),
        note: `Importato dall'offerta ${rif || nome}: ${righe.length} righe, ${collegati} collegate a materiali del magazzino (prezzo d'acquisto dell'offerta + ricarico).`,
        _righe: righe,
      });
    } catch (e) {
      setStato("Errore: " + (e as Error).message);
      setInCorso(false);
    }
  };
  const daOfferta = async (x: Offerta) => {
    setStato(`Apertura di ${x.nome_file}…`);
    const { data, error } = await supabase.storage.from("progetti").download(x.percorso);
    if (error || !data) return setStato("PDF non trovato: " + (error?.message ?? ""));
    converti(data, x.nome_file, x);
  };

  return (
    <div className="velo" onMouseDown={onChiudi}>
      <div className="finestra finestra-stampa-conto" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Importa preventivo da fornitore
          <button type="button" className="chiudi" onClick={onChiudi}><X size={20} /></button>
        </div>
        <div className="finestra-corpo">
          <p className="piccolo">Scegli un'offerta arrivata per mail (sezione <b>Preventivi fornitori</b>) o carica un PDF: i materiali diventano le righe di un nuovo preventivo, che poi modifichi come un preventivo normale.</p>
          <div className="ipf-barra">
            <label className="ipf-cerca"><Search size={15} /><input type="search" placeholder="Cerca offerta o cliente…" value={cerca} onChange={(e) => setCerca(e.target.value)} /></label>
            <button type="button" className="btn grigio" disabled={inCorso} onClick={() => scegli.current?.click()}><Upload size={15} /> Carica PDF</button>
            <input ref={scegli} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) converti(f, f.name); }} />
          </div>
          {stato && <p className={stato.startsWith("Errore") || stato.startsWith("PDF") ? "errore" : "piccolo"}>{stato}</p>}
          {!offerte && <p className="piccolo">Caricamento…</p>}
          {offerte && !visibili.length && <p className="vuoto-linguetta">Nessuna offerta{cerca ? " trovata" : " arrivata per mail"}: usa "Carica PDF".</p>}
          {visibili.map((x) => (
            <button key={x.id} type="button" className="sc-voce ipf-voce" disabled={inCorso} onClick={() => daOfferta(x)}>
              <FileStack size={18} />
              <span className="sc-testi"><b>{x.nome_file.replace(/\.pdf$/i, "")}</b>
                <span className="piccolo">{new Date(x.creato_il).toLocaleDateString("it-IT")} · {x.cliente?.nome ? `👤 ${x.cliente.nome}` : "senza cliente"}</span></span>
              <span className="btn blu piccolo-btn">Converti</span>
            </button>
          ))}
        </div>
        <div className="finestra-piede"><span style={{ flex: 1 }} /><button type="button" className="btn grigio" onClick={onChiudi}>Chiudi</button></div>
      </div>
    </div>
  );
}
