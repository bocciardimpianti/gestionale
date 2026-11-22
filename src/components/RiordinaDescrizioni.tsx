import { useEffect, useMemo, useState } from "react";
import { leggiTutto, registra, supabase } from "../supabase";
import { NOMI_REGOLE, riordinaDescrizione, type Regola } from "../descrizioniMateriali";

// Materiali → Azioni → "Riordina descrizioni": anteprima prima → dopo con le regole fisse, scelta articolo per
// articolo, applicazione in un colpo (la descrizione vecchia resta salvata) e ripristino. Codici e prezzi non cambiano.

type Proposta = { id: number; prima: string; dopo: string; regole: Regola[] };
const PAGINA = 150;

export default function RiordinaDescrizioni({ onChiudi, onFinito }: { onChiudi: () => void; onFinito: () => void }) {
  const [proposte, setProposte] = useState<Proposta[] | null>(null);
  const [giaRiordinati, setGiaRiordinati] = useState(0);
  const [scelti, setScelti] = useState<Set<number>>(new Set());
  const [regola, setRegola] = useState<Regola | "">("");
  const [cerca, setCerca] = useState("");
  const [quanti, setQuanti] = useState(PAGINA);
  const [stato, setStato] = useState("Lettura dei materiali…");
  const [inCorso, setInCorso] = useState(false);
  const [doppioni, setDoppioni] = useState<string[]>([]);

  const carica = async () => {
    setProposte(null); setStato("Lettura dei materiali…");
    try {
      let righe: Record<string, unknown>[];
      try { righe = await leggiTutto("materiali", "id, descrizione, descrizione_prima_riordino", true); }
      catch { righe = await leggiTutto("materiali", "id, descrizione", true); }
      const p: Proposta[] = [];
      const conta = new Map<string, number>();
      for (const m of righe) {
        const prima = String(m.descrizione ?? "");
        if (!prima.trim()) continue;
        const { nuova, regole } = riordinaDescrizione(prima);
        conta.set(nuova, (conta.get(nuova) ?? 0) + 1);
        if (nuova !== prima) p.push({ id: Number(m.id), prima, dopo: nuova, regole });
      }
      setGiaRiordinati(righe.filter((m) => m.descrizione_prima_riordino).length);
      setDoppioni([...conta.entries()].filter(([, n]) => n > 1).map(([d]) => d).sort());
      setProposte(p); setScelti(new Set(p.map((x) => x.id)));
      setStato(`${righe.length} materiali: ${p.length} da riordinare.`);
    } catch (e) { setStato("Errore: " + (e as Error).message); }
  };
  useEffect(() => { carica(); }, []);

  const conteggi = useMemo(() => {
    const c = new Map<Regola, number>();
    for (const p of proposte ?? []) for (const r of p.regole) c.set(r, (c.get(r) ?? 0) + 1);
    return c;
  }, [proposte]);
  const parole = cerca.toUpperCase().split(/\s+/).filter(Boolean);
  const visibili = (proposte ?? []).filter((p) => (!regola || p.regole.includes(regola)) && parole.every((w) => p.prima.toUpperCase().includes(w) || p.dopo.includes(w)));
  const tuttiVisibiliScelti = visibili.length > 0 && visibili.every((p) => scelti.has(p.id));

  const applica = async () => {
    const da = (proposte ?? []).filter((p) => scelti.has(p.id));
    if (!da.length || !confirm(`Riordinare la descrizione di ${da.length} materiali?\n\nLa descrizione di prima resta salvata e puoi tornare indietro con "Ripristina". Codici, prezzi e collegamenti non cambiano.`)) return;
    setInCorso(true);
    let fatti = 0;
    try {
      for (let i = 0; i < da.length; i += 500) {
        setStato(`Aggiornamento… ${i} di ${da.length}`);
        const { data, error } = await supabase.rpc("riordina_descrizioni_materiali", { p_righe: da.slice(i, i + 500).map((p) => ({ id: p.id, descrizione: p.dopo })) });
        if (error) throw new Error(/riordina_descrizioni|function/i.test(error.message) ? "Esegui su Supabase lo script 0055_riordino_descrizioni.sql" : error.message);
        fatti += Number(data) || 0;
      }
      await registra("materiali_descrizioni_riordinate", { quanti: fatti });
      onFinito();
      await carica();
      setStato(`Fatto: ${fatti} descrizioni riordinate.`);
    } catch (e) { setStato("Errore: " + (e as Error).message + (fatti ? ` (${fatti} già aggiornate)` : "")); }
    setInCorso(false);
  };

  const ripristina = async () => {
    if (!confirm(`Rimettere la descrizione di prima a tutti i ${giaRiordinati} materiali riordinati?`)) return;
    setInCorso(true);
    const { data, error } = await supabase.rpc("ripristina_descrizioni_materiali", {});
    setInCorso(false);
    if (error) return setStato("Errore: " + error.message);
    await registra("materiali_descrizioni_ripristinate", { quanti: data });
    onFinito();
    await carica();
    setStato(`Ripristinate ${data} descrizioni.`);
  };

  return (
    <div className="velo" onMouseDown={() => !inCorso && onChiudi()}>
      <div className="finestra finestra-storico-impianti" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Riordina le descrizioni dei materiali<button type="button" className="chiudi" disabled={inCorso} onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          <p className="piccolo">Regole: <b>MARCA - ARTICOLO … MISURA</b>, testo maiuscolo con le unità scritte bene (mm, kW, Vca…), pollici con <b>"</b>, maschio/femmina attaccati alla misura (<b>1/2"FF</b> se la misura è la stessa, <b>3/4"M X 1/2"F</b> se è diversa), Ø e mm uniformi, metri <b>1MT</b>, abbreviazioni per esteso, un solo trattino dopo la marca. Codici, prezzi e collegamenti <b>non cambiano</b>; la descrizione di prima resta salvata.</p>
          <p className={stato.startsWith("Errore") ? "errore" : "piccolo"}>{stato}</p>
          {proposte && (
            <>
              <div className="filtri-categoria pillole-sezione">
                <button type="button" className={regola ? "" : "attiva"} onClick={() => { setRegola(""); setQuanti(PAGINA); }}>Tutti <span className="conteggio-categoria">{proposte.length}</span></button>
                {(Object.keys(NOMI_REGOLE) as Regola[]).filter((r) => conteggi.get(r)).map((r) => (
                  <button type="button" key={r} className={regola === r ? "attiva" : ""} onClick={() => { setRegola(regola === r ? "" : r); setQuanti(PAGINA); }}>
                    {NOMI_REGOLE[r]} <span className="conteggio-categoria">{conteggi.get(r)}</span></button>
                ))}
              </div>
              <div className="barra-storico">
                <input className="rd-cerca" placeholder="Cerca (es. flessibile, gomito, 1/2)…" value={cerca} onChange={(e) => { setCerca(e.target.value); setQuanti(PAGINA); }} />
                <label className="piccolo"><input type="checkbox" checked={tuttiVisibiliScelti} onChange={(e) => setScelti((s) => { const n = new Set(s); for (const p of visibili) { if (e.target.checked) n.add(p.id); else n.delete(p.id); } return n; })} /> tutti quelli in elenco ({visibili.length})</label>
                <span className="piccolo">· scelti {scelti.size}</span>
              </div>
              <div className="rd-elenco">
                {visibili.slice(0, quanti).map((p) => (
                  <label key={p.id} className={`rd-voce${scelti.has(p.id) ? "" : " spenta"}`}>
                    <input type="checkbox" checked={scelti.has(p.id)} onChange={(e) => setScelti((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                    <span className="rd-testi"><span className="rd-prima">{p.prima}</span><span className="rd-dopo">→ {p.dopo}</span></span>
                  </label>
                ))}
                {visibili.length > quanti && <button type="button" className="gt-tutti" onClick={() => setQuanti(quanti + PAGINA * 2)}>Mostra altri ({visibili.length - quanti})</button>}
                {!visibili.length && <p className="vuoto-linguetta">Niente da riordinare qui.</p>}
              </div>
              {doppioni.length > 0 && (
                <details className="rd-doppioni"><summary>{doppioni.length} descrizioni uguali tra più articoli (doppioni da controllare a mano)</summary>
                  <ul>{doppioni.slice(0, 200).map((d) => <li key={d}>{d}</li>)}</ul></details>
              )}
            </>
          )}
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" disabled={inCorso} onClick={onChiudi}>Chiudi</button>
          {giaRiordinati > 0 && <button type="button" className="btn grigio" disabled={inCorso} onClick={ripristina} title="Rimette le descrizioni di prima">Ripristina ({giaRiordinati})</button>}
          <span style={{ flex: 1 }} />
          {proposte && <button type="button" className="btn blu" disabled={inCorso || !scelti.size} onClick={applica}>Riordina {scelti.size} materiali</button>}
        </div>
      </div>
    </div>
  );
}
