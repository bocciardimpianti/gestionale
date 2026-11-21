import { useMemo, useRef, useState } from "react";
import { dataIt, leggiTutto, supabase } from "../supabase";
import { applicaCorrezioni, CANDIDATO_IA, CATEGORIE_IMPIANTI, chiaveCorrezione, impiantiDaRapportino, impiantoDaIA, type Correzione, type ImpiantoRilevato } from "../impiantiAuto";
import { chiediImpiantiIA, leggiCorrezioni, stimaCosto, type RapportinoIA } from "../impiantiIA";

// Impianti dai vecchi rapportini: si analizzano tutti i rapportini e i loro materiali, si vede che cosa verrebbe
// catalogato (Clima, Caldaie, Allarmi, Automatismi, TVCC) e solo dopo si importa quello che va bene.
// "Migliora con l'IA" fa ricontrollare a Claude i rapportini (solo le descrizioni dei materiali) e mostra le differenze.

type Rap = Record<string, unknown> & { id: number };
type Riga = Record<string, unknown>;
type Proposta = ImpiantoRilevato & {
  chiave: string; rapporto: Rap; esiste: boolean;
  // Esito del controllo con l'IA
  ia?: "confermato" | "modificato" | "nuovo" | "scartato"; aggiunti?: string[]; tolti?: string[];
};

const DETTAGLI: Record<string, [string, string][]> = {
  Caldaie: [["defangatore", "Defangatore"], ["sdoppiatore", "Sdoppiatore"], ["dosatore", "Dosatore"], ["pompe_valvole", "Pompe/valvole"],
    ["canna_fumaria_m", "Canna fumaria m"], ["canna_fumaria_sezione", "Sezione"], ["impianto_termico", "Riscaldamento"]],
  Clima: [["unita_interne", "Interne"], ["tipo_gas", "Gas"], ["gas_kg", "Kg"]],
  Allarmi: [["componenti", "Componenti"]],
  Automatismi: [["componenti", "Componenti"]],
  TVCC: [["componenti", "Componenti"]],
};
const ETICHETTE_IA = { confermato: "✨ confermato dall'IA", modificato: "✨ corretto dall'IA", nuovo: "✨ trovato dall'IA", scartato: "✨ l'IA lo scarta" };

const descrizioni = (m: unknown) => (Array.isArray(m) ? m.map((x) => String((x as { descrizione?: unknown }).descrizione ?? "")) : []);
const dollari = (v: number) => `$ ${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`;

export default function ImpiantiDaStorico({ onChiudi, onFinito }: { onChiudi: () => void; onFinito: () => void }) {
  const [dal, setDal] = useState("");
  const [stato, setStato] = useState("");
  const [proposte, setProposte] = useState<Proposta[] | null>(null);
  const [scelte, setScelte] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState("");
  const [soloDiffIA, setSoloDiffIA] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [conIA, setConIA] = useState(false);
  // Dati dell'ultima analisi, per il controllo con l'IA
  const letti = useRef<{ rapporti: Rap[]; righe: Map<number, Riga[]>; gia: Set<string>; correzioni: Correzione[] } | null>(null);
  const ferma = useRef(false);

  const analizza = async () => {
    setInCorso(true); setProposte(null); setConIA(false);
    try {
      setStato("Lettura dei rapportini…");
      let rapporti: Rap[];
      try {
        rapporti = await leggiTutto("rapporti", "id, numero, data, cliente_id, matricola, tipo_gas, gas_aggiunto_kg, eliminato_il, cliente:clienti(nome)") as Rap[];
      } catch {
        rapporti = await leggiTutto("rapporti", "id, numero, data, cliente_id, matricola, eliminato_il, cliente:clienti(nome)") as Rap[];
      }
      rapporti = rapporti.filter((r) => !r.eliminato_il && r.cliente_id && (!dal || String(r.data ?? "") >= dal));
      setStato(`Lettura dei materiali di ${rapporti.length} rapportini…`);
      const righe = await leggiTutto("righe_rapporto", "id, rapporto_id, materiale_id, descrizione, quantita, unita_misura");
      const perRapporto = new Map<number, Riga[]>();
      for (const r of righe) {
        if (!String(r.descrizione ?? "").trim()) continue;
        const k = Number(r.rapporto_id); perRapporto.set(k, [...(perRapporto.get(k) ?? []), r]);
      }
      setStato("Controllo degli impianti già catalogati…");
      const gia = new Set((await leggiTutto("impianti", "id, rapporto_id, categoria")).filter((i) => i.rapporto_id).map((i) => `${i.rapporto_id}|${i.categoria}`));
      const correzioni = await leggiCorrezioni();
      letti.current = { rapporti, righe: perRapporto, gia, correzioni };
      const out: Proposta[] = [];
      for (const r of rapporti) {
        const rr = perRapporto.get(r.id) ?? [];
        for (const imp of impiantiDaRapportino(rr, r)) {
          const chiave = `${r.id}|${imp.categoria}`;
          out.push({ ...applicaCorrezioni(imp, rr, correzioni), chiave, rapporto: r, esiste: gia.has(chiave) });
        }
      }
      out.sort((a, b) => String(b.rapporto.data ?? "").localeCompare(String(a.rapporto.data ?? "")));
      setProposte(out);
      setScelte(new Set(out.filter((p) => !p.esiste).map((p) => p.chiave)));
      setStato(`${rapporti.length} rapportini analizzati: ${out.length} impianti trovati con le regole. Controlla e togli la spunta a quelli sbagliati, poi premi Importa — oppure fai ricontrollare all'IA.`);
    } catch (e) {
      setStato("Errore: " + (e as Error).message);
    }
    setInCorso(false);
  };

  const miglioraConIA = async () => {
    const l = letti.current;
    if (!l || !proposte) return;
    const conRegole = new Set(proposte.map((p) => p.rapporto.id));
    const candidati: RapportinoIA[] = l.rapporti
      .filter((r) => conRegole.has(r.id) || (l.righe.get(r.id) ?? []).some((x) => CANDIDATO_IA.test(String(x.descrizione ?? ""))))
      .map((r) => ({ id: r.id, righe: (l.righe.get(r.id) ?? []).map((x) => String(x.descrizione ?? "").trim()) }));
    if (!candidati.length) return alert("Nessun rapportino da far controllare all'IA.");
    if (!confirm(`L'IA ricontrollerà ${candidati.length} rapportini (vengono inviate solo le descrizioni dei materiali, nessun dato dei clienti).\n\n`
      + `Spesa stimata sul conto Anthropic: circa ${dollari(stimaCosto(candidati))} (indicativa).\n\nProcedere?`)) return;

    setInCorso(true); ferma.current = false;
    const gruppi: RapportinoIA[][] = [];
    for (let i = 0; i < candidati.length; i += 12) gruppi.push(candidati.slice(i, i + 12));
    const risultati = new Map<number, ReturnType<typeof impiantoDaIA>[]>();
    let fatti = 0, errori = 0, primoErrore = "", spesa = 0;
    const lavora = async () => {
      while (gruppi.length && !ferma.current) {
        const g = gruppi.shift()!;
        try {
          const { perRapporto, uso } = await chiediImpiantiIA(g);
          if (uso) spesa += ((uso.input_tokens ?? 0) * 4 + (uso.cache_creation_input_tokens ?? 0) * 5
            + (uso.cache_read_input_tokens ?? 0) * 0.4 + (uso.output_tokens ?? 0) * 20) / 1_000_000;
          for (const r of g) {
            const rap = l.rapporti.find((x) => x.id === r.id)!;
            const rr = l.righe.get(r.id) ?? [];
            risultati.set(r.id, (perRapporto.get(r.id) ?? []).map((ia) => impiantoDaIA(ia, rr, rap)));
          }
        } catch (e) {
          errori += g.length; primoErrore ||= (e as Error).message;
          // Chiave mancante, funzione non pubblicata, …: inutile continuare
          if (/chiave|pubblicata|verifica|accesso/i.test((e as Error).message)) ferma.current = true;
        }
        fatti += g.length;
        setStato(`L'IA sta controllando… ${fatti} di ${candidati.length} rapportini (spesa finora circa ${dollari(spesa)})`);
      }
    };
    await Promise.all([lavora(), lavora(), lavora()]);

    // Unione: per i rapportini controllati vale la risposta dell'IA (con le correzioni fatte a mano), con le differenze in evidenza
    const nuove: Proposta[] = [];
    const sceltePrima = new Set(scelte);
    const scelteDopo = new Set<string>();
    for (const p of proposte) if (!risultati.has(p.rapporto.id)) { nuove.push(p); if (sceltePrima.has(p.chiave)) scelteDopo.add(p.chiave); }
    for (const [id, imps] of risultati) {
      const rap = l.rapporti.find((x) => x.id === id)!;
      const rr = l.righe.get(id) ?? [];
      const regole = proposte.filter((p) => p.rapporto.id === id);
      for (const imp of imps) {
        if (!imp) continue;
        const corretto = applicaCorrezioni(imp, rr, l.correzioni);
        const chiave = `${id}|${corretto.categoria}`;
        const prima = regole.find((p) => p.categoria === corretto.categoria);
        const dopoSet = new Set(descrizioni(corretto.dati.materiali).map(chiaveCorrezione));
        const primaSet = new Set(descrizioni(prima?.dati.materiali).map(chiaveCorrezione));
        const aggiunti = descrizioni(corretto.dati.materiali).filter((t) => prima && !primaSet.has(chiaveCorrezione(t)));
        const tolti = descrizioni(prima?.dati.materiali).filter((t) => !dopoSet.has(chiaveCorrezione(t)));
        const esiste = l.gia.has(chiave);
        nuove.push({ ...corretto, chiave, rapporto: rap, esiste, aggiunti, tolti,
          ia: !prima ? "nuovo" : aggiunti.length || tolti.length ? "modificato" : "confermato" });
        if (prima ? sceltePrima.has(chiave) : !esiste) scelteDopo.add(chiave);
      }
      // Trovati dalle regole ma scartati dall'IA: restano in elenco, senza spunta
      for (const p of regole) if (!imps.some((i) => i?.categoria === p.categoria)) nuove.push({ ...p, ia: "scartato" });
    }
    nuove.sort((a, b) => String(b.rapporto.data ?? "").localeCompare(String(a.rapporto.data ?? "")));
    setProposte(nuove); setScelte(scelteDopo); setConIA(true); setInCorso(false);
    const conta = (k: Proposta["ia"]) => nuove.filter((p) => p.ia === k).length;
    setStato(`IA: ${risultati.size} rapportini controllati — ${conta("confermato")} confermati, ${conta("modificato")} corretti, ${conta("nuovo")} nuovi, ${conta("scartato")} scartati. `
      + `Spesa circa ${dollari(spesa)}.${errori ? ` ${errori} rapportini non controllati (${primoErrore}).` : ""}${ferma.current && !errori ? " Interrotto." : ""}`);
  };

  const importa = async () => {
    const da = (proposte ?? []).filter((p) => scelte.has(p.chiave) && p.ia !== "scartato");
    if (!da.length || !confirm(`Catalogare ${da.length} impianti negli Impianti dei clienti?`)) return;
    setInCorso(true);
    let fatti = 0, errori = 0, primoErrore = "";
    for (const p of da) {
      const { error } = await supabase.rpc("registra_impianto", { p_rapporto: p.rapporto.id, p_categoria: p.categoria, p_dati: p.dati });
      if (error) { errori++; primoErrore ||= error.message; } else fatti++;
      if ((fatti + errori) % 10 === 0) setStato(`Importazione… ${fatti + errori} di ${da.length}`);
    }
    setInCorso(false);
    setStato(`Fatto: ${fatti} impianti catalogati${errori ? `, ${errori} non riusciti (${/registra_impianto|Categoria non valida/.test(primoErrore) ? "esegui gli script 0046 e 0047" : primoErrore})` : ""}.`);
    setProposte((pp) => pp?.map((p) => (scelte.has(p.chiave) ? { ...p, esiste: true } : p)) ?? null);
    setScelte(new Set());
    onFinito();
  };

  const conteggi = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of proposte ?? []) if (p.ia !== "scartato") c.set(p.categoria, (c.get(p.categoria) ?? 0) + 1);
    return c;
  }, [proposte]);
  const visibili = (proposte ?? []).filter((p) => (!filtro || p.categoria === filtro) && (!soloDiffIA || (p.ia && p.ia !== "confermato")));
  const spuntabili = visibili.filter((p) => p.ia !== "scartato");

  return (
    <div className="velo" onMouseDown={() => !inCorso && onChiudi()}>
      <div className="finestra finestra-storico-impianti" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Impianti dai vecchi rapportini<button type="button" className="chiudi" disabled={inCorso} onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          <div className="barra-storico">
            <label>Rapportini dal <input type="date" value={dal} onChange={(e) => setDal(e.target.value)} /></label>
            <span className="piccolo">{dal ? "" : "(vuoto = tutti)"}</span>
            <button type="button" className="btn blu" disabled={inCorso} onClick={analizza}>{proposte ? "Analizza di nuovo" : "Analizza"}</button>
            {proposte && !conIA && <button type="button" className="btn viola" disabled={inCorso} onClick={miglioraConIA}>✨ Migliora con l'IA</button>}
            {inCorso && conIA === false && proposte && <button type="button" className="btn grigio" onClick={() => { ferma.current = true; }}>Ferma</button>}
          </div>
          {stato && <p className={stato.startsWith("Errore") ? "errore" : "piccolo"}>{stato}</p>}
          {proposte && proposte.length > 0 && (
            <>
              <div className="filtri-categoria pillole-sezione">
                <button type="button" className={filtro ? "" : "attiva"} onClick={() => setFiltro("")}>Tutti <span className="conteggio-categoria">{[...conteggi.values()].reduce((a, b) => a + b, 0)}</span></button>
                {CATEGORIE_IMPIANTI.map((c) => (
                  <button type="button" key={c.nome} className={filtro === c.nome ? "attiva" : ""} style={filtro === c.nome ? { background: c.colore, borderColor: c.colore } : { borderColor: c.colore }}
                    onClick={() => setFiltro(filtro === c.nome ? "" : c.nome)}>{c.icona} {c.nome} <span className="conteggio-categoria">{conteggi.get(c.nome) ?? 0}</span></button>
                ))}
                {conIA && <label className="solo-diff-ia"><input type="checkbox" checked={soloDiffIA} onChange={(e) => setSoloDiffIA(e.target.checked)} /> Solo quelli cambiati dall'IA</label>}
              </div>
              <div className="elenco-storico-impianti">
                <table className="griglia">
                  <thead><tr>
                    <th><input type="checkbox" checked={spuntabili.length > 0 && spuntabili.every((p) => scelte.has(p.chiave))} aria-label="Tutti"
                      onChange={(e) => setScelte((s) => { const n = new Set(s); for (const p of spuntabili) { if (e.target.checked) n.add(p.chiave); else n.delete(p.chiave); } return n; })} /></th>
                    <th>Data</th><th>Rapp.</th><th>Cliente</th><th>Categoria</th><th>Macchina</th><th>Dettagli trovati</th>
                  </tr></thead>
                  <tbody>
                    {visibili.slice(0, 500).map((p) => (
                      <tr key={p.chiave + (p.ia === "scartato" ? "-x" : "")} className={[p.esiste ? "gia-catalogato" : "", p.ia === "scartato" ? "scartato-ia" : ""].join(" ")}>
                        <td>{p.ia !== "scartato" && <input type="checkbox" checked={scelte.has(p.chiave)} onChange={(e) => setScelte((s) => { const n = new Set(s); if (e.target.checked) n.add(p.chiave); else n.delete(p.chiave); return n; })} />}</td>
                        <td>{dataIt(p.rapporto.data)}</td>
                        <td>{String(p.rapporto.numero ?? "")}</td>
                        <td>{typeof p.rapporto.cliente === "string" ? p.rapporto.cliente : String((p.rapporto.cliente as { nome?: string } | null)?.nome ?? "")}</td>
                        <td>{CATEGORIE_IMPIANTI.find((c) => c.nome === p.categoria)?.icona} {p.categoria}
                          {p.esiste && <div className="piccolo">già catalogato</div>}
                          {p.ia && <div className={`esito-ia esito-${p.ia}`}>{ETICHETTE_IA[p.ia]}</div>}</td>
                        <td className="macchina-storico">{String(p.dati.modello ?? "")}</td>
                        <td className="dettagli-storico">
                          {(DETTAGLI[p.categoria] ?? []).filter(([k]) => p.dati[k] != null && p.dati[k] !== "").map(([k, t]) => (
                            <div key={k}><b>{t}:</b> {String(p.dati[k])}</div>
                          ))}
                          {Array.isArray(p.dati.materiali) && <div><b>Materiali allegati:</b> {p.dati.materiali.length}</div>}
                          {!!p.aggiunti?.length && <div className="diff-ia piu">+ {p.aggiunti.join("; ")}</div>}
                          {!!p.tolti?.length && <div className="diff-ia meno">– {p.tolti.join("; ")}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visibili.length > 500 && <p className="piccolo">Mostrati i primi 500 di {visibili.length} (si importano comunque tutti quelli spuntati).</p>}
              </div>
            </>
          )}
          {proposte && !proposte.length && <p className="vuoto-linguetta">Nessun impianto riconosciuto dalle regole: prova "Migliora con l'IA".</p>}
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" disabled={inCorso} onClick={onChiudi}>Chiudi</button>
          <span style={{ flex: 1 }} />
          {proposte && proposte.length > 0 && (
            <button type="button" className="btn blu" disabled={inCorso || !scelte.size} onClick={importa}>Importa {scelte.size} impianti</button>
          )}
        </div>
      </div>
    </div>
  );
}
