import { useEffect, useState } from "react";
import { ArrowLeft, Search, X } from "lucide-react";
import { dataIso, dataIt, supabase } from "../supabase";
import { useIndietroChiude } from "../telefono";
import { pulisciRicerca } from "../testo";

// "Aggiungi da DDT" nel rapportino: si sceglie un DDT di acquisto (del giorno o tra tutti),
// poi i suoi materiali da aggiungere con la quantità. I DDT presi dal tecnico del rapportino hanno il bordo rosso.

type Ddt = { id: number; data: string; numero_ddt: string | null; fornitore: string | null; tecnico_id: number | null; tecnico: string | null; righe: number };
type RigaDdt = { id: number; materiale_id: number | null; codice_barre: string | null; descrizione: string | null; unita_misura: string | null; quantita: number | null };
export type MaterialeDaDdt = { riga: RigaDdt; quantita: number };

const numero = (v: string) => Number(v.replace(",", "."));

export default function AggiungiDaDdt({ tecnicoId, data, onAggiungi, onChiudi }: {
  tecnicoId: number | null;
  data: string; // data del rapportino: i "DDT del giorno" sono quelli di questa data
  onAggiungi: (scelti: MaterialeDaDdt[]) => Promise<void> | void;
  onChiudi: () => void;
}) {
  const [vista, setVista] = useState<"giorno" | "tutti">("giorno");
  const [giorno, setGiorno] = useState(dataIso(data) ?? new Date().toISOString().slice(0, 10));
  const [cerca, setCerca] = useState("");
  const [ddt, setDdt] = useState<Ddt[] | null>(null);
  const [errore, setErrore] = useState("");
  const [aperto, setAperto] = useState<Ddt | null>(null);
  const [righe, setRighe] = useState<RigaDdt[] | null>(null);
  const [scelte, setScelte] = useState<Record<number, string>>({}); // id riga → quantità (presente = spuntata)
  const [inCorso, setInCorso] = useState(false);
  useIndietroChiude(true, onChiudi);
  // Indietro dal DDT aperto torna all'elenco dei DDT
  useIndietroChiude(!!aperto, () => setAperto(null));

  useEffect(() => {
    let attivo = true;
    setDdt(null); setErrore("");
    const t = setTimeout(async () => {
      const { data: d, error } = await supabase.rpc("ddt_per_rapportino", vista === "giorno"
        ? { p_dal: giorno, p_al: giorno, p_cerca: null, p_limite: 200 }
        : { p_dal: null, p_al: null, p_cerca: pulisciRicerca(cerca) || null, p_limite: 200 });
      if (!attivo) return;
      if (error) return setErrore(/ddt_per_rapportino/.test(error.message)
        ? "Esegui su Supabase lo script 0028_ddt_per_rapportino.sql" : error.message);
      const elenco = (d ?? []) as Ddt[];
      // Nel giorno: prima i DDT presi dal tecnico del rapportino
      setDdt(vista === "giorno" && tecnicoId ? [...elenco].sort((a, b) => Number(b.tecnico_id === tecnicoId) - Number(a.tecnico_id === tecnicoId)) : elenco);
    }, vista === "tutti" ? 300 : 0);
    return () => { attivo = false; clearTimeout(t); };
  }, [vista, giorno, cerca, tecnicoId]);

  const apri = async (d: Ddt) => {
    setAperto(d); setRighe(null); setScelte({});
    const { data: r, error } = await supabase.rpc("righe_ddt_per_rapportino", { p_ddt: d.id });
    if (error) { setErrore(error.message); return; }
    setRighe((r ?? []) as RigaDdt[]);
  };

  const spuntate = Object.entries(scelte).filter(([, q]) => numero(q) > 0);
  const aggiungi = async () => {
    if (!righe) return;
    setInCorso(true);
    try {
      await onAggiungi(spuntate.map(([id, q]) => ({ riga: righe.find((r) => r.id === Number(id))!, quantita: numero(q) })));
      onChiudi();
    } catch (e) {
      setErrore((e as Error).message);
      setInCorso(false);
    }
  };

  return (
    <div className="velo" onMouseDown={onChiudi}>
      <div className="finestra finestra-da-ddt" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">
          {aperto ? <button type="button" className="indietro-ddt" aria-label="Torna ai DDT" onClick={() => setAperto(null)}><ArrowLeft size={20} /></button> : null}
          {aperto ? `${aperto.fornitore ?? "DDT"} – n. ${aperto.numero_ddt ?? ""}` : "Aggiungi da DDT"}
          <button type="button" className="chiudi" onClick={onChiudi}><X size={20} /></button>
        </div>
        <div className="finestra-corpo">
          {!aperto ? (
            <>
              <div className="scelta-vista-ddt">
                <button type="button" className={vista === "giorno" ? "attiva" : ""} onClick={() => setVista("giorno")}>DDT del giorno</button>
                <button type="button" className={vista === "tutti" ? "attiva" : ""} onClick={() => setVista("tutti")}>Tutti i DDT</button>
              </div>
              {vista === "giorno" ? (
                <label className="giorno-ddt">Giorno <input type="date" value={giorno} onChange={(e) => e.target.value && setGiorno(e.target.value)} /></label>
              ) : (
                <div className="cerca-ddt"><Search size={16} /><input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Fornitore, numero, tecnico o materiale…" /></div>
              )}
              {tecnicoId ? <p className="piccolo legenda-ddt"><span className="campione-mio" /> DDT presi dal tecnico del rapportino</p> : null}
              {errore && <p className="errore">{errore}</p>}
              {!ddt && !errore && <p className="piccolo">Caricamento…</p>}
              {ddt && !ddt.length && <p className="vuoto-linguetta">{vista === "giorno" ? `Nessun DDT del ${dataIt(giorno)}.` : "Nessun DDT trovato."}</p>}
              <div className="elenco-ddt">
                {ddt?.map((d) => (
                  <button type="button" key={d.id} className={`carta-ddt${tecnicoId && d.tecnico_id === tecnicoId ? " mio" : ""}`} onClick={() => apri(d)}>
                    <b>{d.fornitore ?? "(fornitore?)"}</b>
                    <span>DDT n. {d.numero_ddt ?? "—"} del {dataIt(d.data)} · {d.righe} {d.righe === 1 ? "materiale" : "materiali"}</span>
                    {d.tecnico && <span className="cella-tecnico">{d.tecnico}</span>}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {errore && <p className="errore">{errore}</p>}
              {!righe && !errore && <p className="piccolo">Caricamento dei materiali…</p>}
              {righe && !righe.length && <p className="vuoto-linguetta">Questo DDT non ha materiali.</p>}
              {righe && righe.length > 0 && (
                <label className="tutti-ddt">
                  <input type="checkbox" checked={spuntate.length === righe.length}
                    onChange={(e) => setScelte(e.target.checked ? Object.fromEntries(righe.map((r) => [r.id, String(r.quantita ?? 1).replace(".", ",")])) : {})} />
                  Seleziona tutti
                </label>
              )}
              <div className="righe-ddt">
                {righe?.map((r) => {
                  const q = scelte[r.id];
                  return (
                    <div key={r.id} className={`riga-ddt${q !== undefined ? " scelta" : ""}`}>
                      <label>
                        <input type="checkbox" checked={q !== undefined} onChange={(e) => setScelte((s) => {
                          const n = { ...s };
                          if (e.target.checked) n[r.id] = String(r.quantita ?? 1).replace(".", ","); else delete n[r.id];
                          return n;
                        })} />
                        <span>{r.descrizione}{!r.materiale_id && <span className="piccolo"> (non in magazzino: riga libera)</span>}</span>
                      </label>
                      <span className="quantita-ddt">
                        <input type="text" inputMode="decimal" aria-label="Quantità" value={q ?? String(r.quantita ?? "").replace(".", ",")}
                          onChange={(e) => setScelte((s) => ({ ...s, [r.id]: e.target.value.replace(/[^0-9.,]/g, "") }))} />
                        <span>{r.unita_misura}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" onClick={aperto ? () => setAperto(null) : onChiudi}>{aperto ? "Altri DDT" : "Chiudi"}</button>
          <span style={{ flex: 1 }} />
          {aperto && (
            <button type="button" className="btn blu" disabled={!spuntate.length || inCorso} onClick={aggiungi}>
              {inCorso ? "Aggiunta…" : `Aggiungi ${spuntate.length || ""} ${spuntate.length === 1 ? "materiale" : "materiali"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
