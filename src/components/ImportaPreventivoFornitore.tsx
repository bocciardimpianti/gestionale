import { useEffect, useMemo, useRef, useState } from "react";
import { FileStack, Search, Upload, X } from "lucide-react";
import { dataIso, dataIt, prossimiCodiciInterni, registra, supabase } from "../supabase";
import { ARCHIVI } from "../archivi";
import { categoriaDa } from "../categorie";
import { PREVENTIVI_FORNITORI, type ProgettoFile } from "../progettiClienti";
import { leggiPdfDdt, umDa, type Rec } from "../ddtImport";

// Preventivi → "Da fornitore": un'offerta di un fornitore (arrivata per mail, sezione Preventivi fornitori, oppure un PDF
// caricato qui) diventa un nuovo preventivo, già salvato, con i suoi materiali. I materiali già in magazzino restano
// collegati (prezzo dell'offerta + ricarico del materiale); quelli che non ci sono vengono creati (segnati "da rivedere").
// Poi si modifica come un preventivo normale e si può impaginare (il testo parte dall'elenco dei materiali).

type Offerta = ProgettoFile & { cliente?: { nome: string } | null };
const RICARICO_PREDEFINITO = 35;

export default function ImportaPreventivoFornitore({ onChiudi, onPronto }: {
  onChiudi: () => void;
  // Preventivo creato: si apre la sua scheda
  onPronto: (id: number) => void;
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
      const rif = [fornitore?.nome ?? "", l.ddt.numeroDdt ? `n. ${l.ddt.numeroDdt}` : "", l.ddt.data ? `del ${dataIt(l.ddt.data)}` : ""].filter(Boolean).join(" ");
      // Materiali: collegati se riconosciuti con sicurezza, altrimenti creati nuovi (uno per codice del fornitore)
      const sicuro = (r: (typeof l.righe)[number]) => !!r.materiale && (r.confermata || ["ricordato", "codice", "proposta", "scelto"].includes(r.stato));
      const daCreare = [...new Map(l.righe.filter((r) => !sicuro(r)).map((r) => [(r.pdf.codice || r.pdf.descrizione).trim().toLowerCase(), r])).values()];
      const creati = new Map<string, Rec>();
      if (daCreare.length) {
        setStato(`Creazione di ${daCreare.length} materiali nuovi…`);
        const codici = await prossimiCodiciInterni(daCreare.length);
        const nuovi = daCreare.map((r, k) => {
          const prezzo = Math.round(Number(r.pdf.prezzo || 0) * 10000) / 10000;
          const simile = r.materiale ?? r.candidati[0];
          return {
            codice_interno: codici[k], codice_barre: codici[k], descrizione: r.pdf.descrizione, categoria: categoriaDa(r.pdf.descrizione),
            unita_misura: umDa(r.pdf.um), fornitore1: fornitore?.nome ?? null, codice_fornitore1: r.pdf.codice || null,
            prezzo_base: prezzo, ricarico: RICARICO_PREDEFINITO, prezzo_ricaricato: Math.round(prezzo * (1 + RICARICO_PREDEFINITO / 100) * 10000) / 10000, giacenza: 0,
            da_rivedere: `Nuovo dall'offerta ${rif}`.trim() + (simile ? ` (forse è già: ${String(simile.descrizione ?? "")})` : ""), da_rivedere_il: new Date().toISOString(),
          };
        });
        let ins = await supabase.from("materiali").insert(nuovi).select("*");
        // Script 0057 non eseguito (niente "da rivedere"): si creano lo stesso
        if (ins.error && /da_rivedere/.test(ins.error.message)) ins = await supabase.from("materiali").insert(nuovi.map(({ da_rivedere: _a, da_rivedere_il: _b, ...m }) => m)).select("*");
        if (ins.error || !ins.data) throw new Error("Nuovi materiali: " + (ins.error?.message ?? "creazione non riuscita"));
        daCreare.forEach((r, k) => creati.set((r.pdf.codice || r.pdf.descrizione).trim().toLowerCase(), ins.data![k] as Rec));
        // I codici del fornitore si ricordano: la prossima offerta o il prossimo DDT li trova già
        if (fornitore) await supabase.from("abbinamenti_fornitore").upsert(daCreare.filter((r) => r.pdf.codice).map((r) => ({
          fornitore_id: fornitore.id, codice: r.pdf.codice, materiale_id: creati.get(r.pdf.codice.trim().toLowerCase())!.id,
        })), { onConflict: "fornitore_id,codice" });
      }
      const cfg = ARCHIVI.preventivi;
      const righe = l.righe.map((r, i) => {
        const m = sicuro(r) ? r.materiale! : creati.get((r.pdf.codice || r.pdf.descrizione).trim().toLowerCase())!;
        const prezzoBase = Math.round(Number(r.pdf.prezzo || 0) * 10000) / 10000;
        const ricarico = m.ricarico != null ? Number(m.ricarico) : RICARICO_PREDEFINITO;
        return cfg.righe!.ricalcola({
          ordine: i, materiale_id: m.id, codice_barre: m.codice_barre ?? m.codice_interno ?? null, descrizione: m.descrizione,
          unita_misura: m.unita_misura ?? umDa(r.pdf.um), quantita: r.pdf.quantita || 1, prezzo_base: prezzoBase, ricarico,
        });
      });
      // Il preventivo si salva subito (così si può impaginare); poi si apre per modificarlo
      setStato("Salvataggio del preventivo…");
      const testata = {
        data: dataIso(new Date()), stato: "Aperto", sconto: 0, iva: 0,
        numero: offerta?.mail?.oggetto?.split("*")[1]?.trim() || `Da offerta ${rif}`.trim(),
        cliente_id: offerta?.cliente_id ?? null,
        note: `Importato dall'offerta ${rif || nome}: ${righe.length} righe (${righe.length - daCreare.length} materiali già in magazzino, ${daCreare.length} creati nuovi). Prezzi: acquisto dell'offerta + ricarico.`,
      };
      const { data: prev, error } = await supabase.from("preventivi").insert({ ...testata, ...cfg.calcolaTotali!(testata, righe) }).select("id").single();
      if (error || !prev) throw new Error("Preventivo: " + (error?.message ?? "salvataggio non riuscito"));
      const { error: e2 } = await supabase.from("righe_preventivo").insert(righe.map((r) => ({ ...r, preventivo_id: prev.id })));
      if (e2) throw new Error("Righe del preventivo: " + e2.message);
      await registra("preventivo_da_fornitore", { id: prev.id, offerta: rif || nome, righe: righe.length, nuovi_materiali: daCreare.length });
      onPronto(prev.id as number);
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
