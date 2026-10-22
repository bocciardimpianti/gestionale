import { useMemo, useState } from "react";

// Campo con elenco di suggerimenti: scrivendo le prime lettere compaiono prima i nomi che INIZIANO così
// (in ordine alfabetico), poi quelli in cui un'altra parola inizia così (es. "Ing. BELLAGAMBA" con "bel").
export function ordinaPerInizio<T>(elenco: T[], testo: string, nome: (x: T) => string, max = 60): T[] {
  const t = testo.trim().toLowerCase();
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
  const [aperto, setAperto] = useState(false);
  const [evidenziato, setEvidenziato] = useState(0);
  const proposte = useMemo(() => (aperto ? ordinaPerInizio(opzioni, valore, (x) => x) : []), [aperto, opzioni, valore]);

  const scegli = (v: string) => {
    onCambia(v);
    setAperto(false);
  };

  return (
    <span className="autocompleta">
      <input
        id={id}
        value={valore}
        readOnly={readOnly}
        placeholder={placeholder}
        autoComplete="off"
        className={nonTrovato ? "non-trovato" : ""}
        onChange={(e) => { onCambia(e.target.value); setAperto(true); setEvidenziato(0); }}
        onFocus={() => !readOnly && setAperto(true)}
        onBlur={() => setTimeout(() => setAperto(false), 150)}
        onKeyDown={(e) => {
          if (!aperto || !proposte.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setEvidenziato((i) => Math.min(i + 1, proposte.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setEvidenziato((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); scegli(proposte[evidenziato]); }
          else if (e.key === "Escape") setAperto(false);
        }}
      />
      {!readOnly && <button type="button" tabIndex={-1} className="apri-elenco" onMouseDown={(e) => { e.preventDefault(); setAperto(!aperto); }}>▾</button>}
      {aperto && proposte.length > 0 && (
        <ul className="proposte">
          {proposte.map((p, i) => (
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
