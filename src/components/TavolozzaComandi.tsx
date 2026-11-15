import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search, type LucideIcon } from "lucide-react";
import { useIndietroChiude } from "../telefono";

// "Vai a…" (Ctrl+K): si scrive qualche lettera e si salta a una sezione o si avvia un'azione (es. Nuovo rapportino).
export type Comando = { id: string; titolo: string; gruppo: string; Icona: LucideIcon; parole?: string; esegui: () => void };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Punteggio: tutte le parole scritte devono esserci; meglio se il titolo inizia così
function punteggio(c: Comando, q: string) {
  if (!q) return 1;
  const t = norm(`${c.titolo} ${c.parole ?? ""} ${c.gruppo}`);
  const parole = norm(q).split(/\s+/).filter(Boolean);
  if (!parole.every((p) => t.includes(p))) return 0;
  const titolo = norm(c.titolo);
  return (titolo.startsWith(parole[0]) ? 3 : titolo.split(/\s+/).some((w) => w.startsWith(parole[0])) ? 2 : 1);
}

export default function TavolozzaComandi({ comandi, cercaOvunque, onChiudi }: {
  comandi: Comando[];
  cercaOvunque: (testo: string) => void;
  onChiudi: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const elenco = useRef<HTMLDivElement>(null);
  useIndietroChiude(true, onChiudi);

  const trovati = useMemo(() => {
    const r = comandi.map((c) => ({ c, p: punteggio(c, q) })).filter((x) => x.p > 0);
    if (q) r.sort((a, b) => b.p - a.p);
    const lista = r.map((x) => x.c);
    // Con del testo scritto, in fondo: cerca quel testo in tutto il gestionale
    if (q.trim().length >= 2) lista.push({ id: "cerca", titolo: `Cerca "${q.trim()}" ovunque`, gruppo: "Ricerca", Icona: Search, esegui: () => cercaOvunque(q.trim()) });
    return lista;
  }, [comandi, q, cercaOvunque]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    elenco.current?.querySelector(`[data-indice="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const esegui = (c: Comando | undefined) => {
    if (!c) return;
    onChiudi();
    // Dopo la chiusura (il tasto Indietro della finestra viene tolto prima di cambiare pagina)
    setTimeout(c.esegui, 30);
  };

  let gruppoPrima = "";
  return (
    <div className="velo velo-tavolozza" onMouseDown={onChiudi}>
      <div className="tavolozza" role="dialog" aria-label="Vai a" onMouseDown={(e) => e.stopPropagation()}>
        <div className="tavolozza-cerca">
          <Search size={18} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Vai a una sezione o un'azione… (es. clienti, nuovo preventivo)"
            enterKeyHint="go"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(i + 1, trovati.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); esegui(trovati[sel]); }
              else if (e.key === "Escape") { e.preventDefault(); onChiudi(); }
            }} />
          <kbd>Esc</kbd>
        </div>
        <div className="tavolozza-elenco" ref={elenco}>
          {!trovati.length && <p className="vuoto-linguetta">Nessuna voce trovata.</p>}
          {trovati.map((c, i) => {
            const titoloGruppo = c.gruppo !== gruppoPrima ? c.gruppo : "";
            gruppoPrima = c.gruppo;
            return (
              <div key={c.id}>
                {titoloGruppo && !q && <div className="tavolozza-gruppo">{titoloGruppo}</div>}
                <button type="button" data-indice={i} className={i === sel ? "attiva" : ""} onMouseMove={() => setSel(i)} onClick={() => esegui(c)}>
                  <c.Icona size={17} strokeWidth={1.7} />
                  <span>{c.titolo}</span>
                  {i === sel && <CornerDownLeft size={14} className="invio" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="tavolozza-piede piccolo">↑ ↓ per scegliere · Invio per aprire · <kbd>Ctrl</kbd>+<kbd>K</kbd> da qualsiasi pagina</div>
      </div>
    </div>
  );
}
