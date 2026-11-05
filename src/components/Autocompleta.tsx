import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTelefono } from "../telefono";
import { pulisciRicerca } from "../testo";
import MicDettatura from "./MicDettatura";

// Campo con elenco di suggerimenti: scrivendo le prime lettere compaiono prima i nomi che INIZIANO così
// (in ordine alfabetico), poi quelli in cui un'altra parola inizia così (es. "Ing. BELLAGAMBA" con "bel").
export function ordinaPerInizio<T>(elenco: T[], testo: string, nome: (x: T) => string, max = Infinity): T[] {
  const t = pulisciRicerca(testo);
  const alfabetico = (a: T, b: T) => nome(a).localeCompare(nome(b), "it", { sensitivity: "base" });
  if (!t) return [...elenco].sort(alfabetico).slice(0, max);
  const inizio: T[] = [];
  const parola: T[] = [];
  for (const x of elenco) {
    const n = nome(x).trim().toLowerCase();
    if (n.startsWith(t)) inizio.push(x);
    else if (n.split(/[\s.,'()/-]+/).some((p) => p.startsWith(t))) parola.push(x);
  }
  return [...inizio.sort(alfabetico), ...parola.sort(alfabetico)].slice(0, max);
}

export default function Autocompleta({ id, valore, opzioni, onCambia, readOnly, placeholder, nonTrovato }: {
  id: string;
  valore: string;
  opzioni: string[];
  onCambia: (testo: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  nonTrovato?: boolean;
}) {
  const telefono = useTelefono();
  const [aperto, setAperto] = useState(false);
  const [evidenziato, setEvidenziato] = useState(0);
  const [quanti, setQuanti] = useState(100);
  const [tutti, setTutti] = useState(false); // aperto con la freccia: elenco completo anche se il campo è già compilato
  // Senza testo l'elenco contiene tutti i nomi; se ne disegnano 100 alla volta mentre si scorre
  const proposte = useMemo(() => (aperto ? ordinaPerInizio(opzioni, tutti ? "" : valore, (x) => x) : []), [aperto, opzioni, valore, tutti]);

  const scegli = (v: string) => {
    onCambia(v);
    setAperto(false);
  };

  if (telefono) {
    return (
      <AutocompletaTelefono id={id} valore={valore} opzioni={opzioni} onCambia={onCambia} readOnly={readOnly}
        placeholder={placeholder} nonTrovato={nonTrovato} />
    );
  }

  return (
    <span className="autocompleta">
      <input
        id={id}
        value={valore}
        readOnly={readOnly}
        placeholder={placeholder}
        autoComplete="off"
        className={nonTrovato ? "non-trovato" : ""}
        onChange={(e) => { onCambia(e.target.value); setAperto(true); setEvidenziato(0); setQuanti(100); setTutti(false); }}
        onFocus={() => { if (!readOnly) { setTutti(false); setAperto(true); } }}
        onBlur={() => setTimeout(() => setAperto(false), 150)}
        onKeyDown={(e) => {
          if (!aperto || !proposte.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setEvidenziato((i) => Math.min(i + 1, proposte.length - 1)); if (evidenziato + 5 >= quanti) setQuanti((q) => q + 100); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setEvidenziato((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); scegli(proposte[evidenziato]); }
          else if (e.key === "Escape") setAperto(false);
        }}
      />
      {!readOnly && <button type="button" tabIndex={-1} className="apri-elenco" onMouseDown={(e) => { e.preventDefault(); setTutti(true); setQuanti(100); setEvidenziato(0); setAperto(!aperto); }}>▾</button>}
      {aperto && proposte.length > 0 && (
        <ul className="proposte" onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 100 && quanti < proposte.length) setQuanti((q) => q + 100);
        }}>
          {proposte.slice(0, quanti).map((p, i) => (
            <li key={p + i} className={i === evidenziato ? "evidenziato" : ""} onMouseDown={(e) => { e.preventDefault(); scegli(p); }}
              onMouseEnter={() => setEvidenziato(i)}>
              {p}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

// Sul telefono la ricerca si apre a tutto schermo: campo in alto e risultati sotto, nello spazio lasciato dalla tastiera
function AutocompletaTelefono({ id, valore, opzioni, onCambia, readOnly, placeholder, nonTrovato }: {
  id: string;
  valore: string;
  opzioni: string[];
  onCambia: (testo: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  nonTrovato?: boolean;
}) {
  const [aperto, setAperto] = useState(false);
  const [quanti, setQuanti] = useState(100);
  const campo = useRef<HTMLInputElement>(null);
  const proposte = useMemo(() => (aperto ? ordinaPerInizio(opzioni, valore, (x) => x) : []), [aperto, opzioni, valore]);

  useEffect(() => {
    if (aperto) campo.current?.focus();
  }, [aperto]);

  const chiudi = () => { setAperto(false); setQuanti(100); };
  // La finestra è fuori dalla scheda nella pagina, ma React le inoltra comunque gli eventi: qui si fermano
  const ferma = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <>
      <button type="button" id={id} className={`campo-ricerca${nonTrovato ? " non-trovato" : ""}${valore ? "" : " vuoto"}`} disabled={readOnly} onClick={() => setAperto(true)}>
        {valore || placeholder || "Tocca per cercare"}
      </button>
      {aperto && createPortal(
        <div className="ricerca-telefono" role="dialog" aria-modal="true" onMouseDown={ferma} onClick={ferma} onKeyDown={ferma}>
          <div className="ricerca-telefono-testa">
            <input ref={campo} type="search" enterKeyHint="done" autoComplete="off" value={valore} placeholder={placeholder ?? "Scrivi le prime lettere…"}
              onChange={(e) => { onCambia(e.target.value); setQuanti(100); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); chiudi(); } }} />
            <MicDettatura onTesto={(t) => { onCambia(t); setQuanti(100); }} />
            <button type="button" className="btn blu" onClick={chiudi}>Fine</button>
          </div>
          <ul className="ricerca-telefono-elenco"
            onTouchMove={() => {
              const attivo = document.activeElement as HTMLElement | null;
              if (attivo?.tagName === "INPUT") attivo.blur();
            }}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollTop + el.clientHeight > el.scrollHeight - 200 && quanti < proposte.length) setQuanti((q) => q + 100);
            }}>
            {proposte.slice(0, quanti).map((p, i) => (
              <li key={p + i}><button type="button" onClick={() => { onCambia(p); chiudi(); }}>{p}</button></li>
            ))}
            {!proposte.length && <li className="vuoto-linguetta">Nessun risultato: puoi lasciare il testo scritto e toccare Fine.</li>}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
