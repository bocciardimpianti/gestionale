import { ChevronLeft, ChevronRight } from "lucide-react";

// Scelta del periodo dei grafici: periodi pronti (ultimi 30 giorni, ultimi 12 mesi…) oppure un anno intero,
// da scorrere con le frecce ‹ 2025 ›. Un anno si scrive "y2025", così si salva come gli altri periodi.

export type PeriodoAnno = `y${number}`;
export const ANNO_MINIMO = 2010;
export const annoDi = (p: string) => (/^y\d{4}$/.test(p) ? Number(p.slice(1)) : null);
const annoOggi = () => new Date().getFullYear();

/** Primo e ultimo giorno di un anno scelto (per l'anno in corso l'ultimo è oggi) */
export function intervalloAnno(anno: number): [Date, Date] {
  const oggi = new Date();
  return [new Date(anno, 0, 1), anno >= oggi.getFullYear() ? oggi : new Date(anno, 11, 31)];
}

export default function SceltaPeriodo<P extends string>({ valore, periodi, onCambia }: {
  valore: P | PeriodoAnno; periodi: { k: P; t: string }[]; onCambia: (p: P | PeriodoAnno) => void;
}) {
  const anno = annoDi(valore);
  return (
    <span className="scelta-periodo">
      <select value={anno ? "anni" : valore} aria-label="Periodo"
        onChange={(e) => onCambia(e.target.value === "anni" ? `y${annoOggi()}` : (e.target.value as P))}>
        {periodi.map((p) => <option key={p.k} value={p.k}>{p.t}</option>)}
        <option value="anni">Anno…</option>
      </select>
      {anno && (
        <span className="frecce-anno" role="group" aria-label="Anno">
          <button type="button" aria-label="Anno prima" disabled={anno <= ANNO_MINIMO} onClick={() => onCambia(`y${anno - 1}`)}><ChevronLeft size={16} /></button>
          <b>{anno}</b>
          <button type="button" aria-label="Anno dopo" disabled={anno >= annoOggi()} onClick={() => onCambia(`y${anno + 1}`)}><ChevronRight size={16} /></button>
        </span>
      )}
    </span>
  );
}
