import { useEffect, useMemo, useRef, useState } from "react";
import { leggiTutto } from "../supabase";
import { euro } from "./Griglia";
import { Miniatura } from "./CampoImmagine";

type Materiale = Record<string, unknown> & { id: number };

// Elenco dei materiali tenuto in memoria tra un'apertura e l'altra (si aggiorna a ogni apertura)
let inMemoria: Materiale[] | null = null;

const testoDi = (m: Materiale) => `${m.descrizione ?? ""} ${m.nome_articolo ?? ""} ${m.codice_interno ?? ""} ${m.codice_barre ?? ""}`.toLowerCase();

// Finestra per scegliere i materiali da aggiungere alle righe: elenco completo da sfogliare,
// che si filtra mentre si scrive (prima i materiali la cui descrizione o codice INIZIA con il testo)
export default function CercaMateriale({ onChiudi, onScegli, onRigaVuota }: {
  onChiudi: () => void;
  onScegli: (m: Materiale) => void;
  onRigaVuota?: () => void;
}) {
  const [materiali, setMateriali] = useState<Materiale[] | null>(inMemoria);
  const [testo, setTesto] = useState("");
  const [quanti, setQuanti] = useState(150);
  const [evidenziato, setEvidenziato] = useState(0);
  const [aggiunti, setAggiunti] = useState<string[]>([]);
  const [errore, setErrore] = useState("");
  const elenco = useRef<HTMLDivElement>(null);

  useEffect(() => {
    leggiTutto("materiali", "id, codice_interno, descrizione, nome_articolo, codice_barre, unita_misura, prezzo_base, ricarico, prezzo_ricaricato, giacenza, foto", true)
      .then((m) => {
        inMemoria = m as Materiale[];
        setMateriali(inMemoria);
      })
      .catch((e) => setErrore("Errore nel caricamento dei materiali: " + (e as Error).message));
  }, []);

  const filtrati = useMemo(() => {
    if (!materiali) return [];
    const parole = testo.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const alfabetico = (a: Materiale, b: Materiale) => String(a.descrizione ?? "").localeCompare(String(b.descrizione ?? ""), "it", { sensitivity: "base" });
    if (!parole.length) return [...materiali].sort(alfabetico);
    const primo = parole[0];
    const trovati = materiali.filter((m) => {
      const t = testoDi(m);
      return parole.every((p) => t.includes(p));
    });
    // Prima chi inizia con il testo (descrizione o codice), poi chi ha una parola che inizia così, poi gli altri
    const punteggio = (m: Materiale) => {
      const d = String(m.descrizione ?? "").toLowerCase();
      if (d.startsWith(primo) || String(m.codice_interno ?? "").toLowerCase().startsWith(primo) || String(m.codice_barre ?? "").toLowerCase() === primo) return 0;
      if (d.split(/[\s.,'()/-]+/).some((w) => w.startsWith(primo))) return 1;
      return 2;
    };
    return trovati.sort((a, b) => punteggio(a) - punteggio(b) || alfabetico(a, b));
  }, [materiali, testo]);

  useEffect(() => {
    setQuanti(150);
    setEvidenziato(0);
    elenco.current?.scrollTo(0, 0);
  }, [testo]);

  const scegli = (m: Materiale) => {
    onScegli(m);
    setAggiunti((a) => [...a, String(m.descrizione ?? "")]);
  };

  return (
    <div className="velo" onMouseDown={onChiudi}>
      <div className="finestra finestra-materiali" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Aggiungi materiali<button type="button" className="chiudi" onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo cerca-materiale">
          <input
            autoFocus
            placeholder="Scrivi per filtrare: descrizione, codice o codice a barre…"
            value={testo}
            onChange={(e) => setTesto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setEvidenziato((i) => Math.min(i + 1, filtrati.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setEvidenziato((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter" && filtrati[evidenziato]) { e.preventDefault(); scegli(filtrati[evidenziato]); }
            }}
          />
          <div className="piccolo">
            {materiali ? `${filtrati.length} materiali${testo ? " trovati" : ""} — clicca (o Invio) per aggiungere; puoi aggiungerne più di uno` : "Caricamento dei materiali…"}
          </div>
          {errore && <p className="errore">{errore}</p>}
          <div className="risultati" ref={elenco} onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight > el.scrollHeight - 200 && quanti < filtrati.length) setQuanti((q) => q + 150);
          }}>
            <table className="griglia">
              <thead>
                <tr><th style={{ width: 44 }} /><th>Codice</th><th>Descrizione</th><th>UM</th><th className="destra">Prezzo</th><th className="destra">Giacenza</th></tr>
              </thead>
              <tbody>
                {filtrati.slice(0, quanti).map((m, i) => (
                  <tr key={m.id} className={i === evidenziato ? "evidenziata" : ""} onClick={() => scegli(m)} onMouseEnter={() => setEvidenziato(i)}
                    title="Clicca per aggiungere">
                    <td className="cella-miniatura">{typeof m.foto === "string" && m.foto ? <Miniatura percorso={m.foto} archivio="materiali" /> : null}</td>
                    <td>{String(m.codice_interno ?? "")}</td>
                    <td>{String(m.descrizione ?? "")}</td>
                    <td>{String(m.unita_misura ?? "")}</td>
                    <td className="destra">{euro(m.prezzo_ricaricato)}</td>
                    <td className="destra">{Number(m.giacenza ?? 0).toLocaleString("it-IT")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {materiali && !filtrati.length && <p className="vuoto-linguetta">Nessun materiale trovato.</p>}
          </div>
        </div>
        <div className="finestra-piede">
          {onRigaVuota && (
            <button type="button" className="btn grigio" onClick={() => { onRigaVuota(); onChiudi(); }} title="Aggiunge una riga da compilare a mano">
              Riga libera
            </button>
          )}
          <span className="ok" style={{ flex: 1, padding: "0 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {aggiunti.length ? `Aggiunti ${aggiunti.length}: ${aggiunti.slice(-3).join(", ")}` : ""}
          </span>
          <button type="button" className="btn blu" onClick={onChiudi}>Fine</button>
        </div>
      </div>
    </div>
  );
}
