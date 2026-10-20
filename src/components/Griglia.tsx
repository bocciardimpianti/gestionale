import { useEffect, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { dataIt } from "../supabase";

export interface Colonna {
  chiave: string;
  titolo: string;
  larghezza: number;
  tipo?: "data";
}

type Riga = Record<string, unknown> & { id: number };

interface Props {
  colonne: Colonna[];
  righe: Riga[];
  selezionata: number | null;
  onSeleziona: (id: number) => void;
  onApri: (riga: Riga) => void;
  // Riceve le righe visibili (filtrate e ordinate), per esportazione e stampa
  onVisibili?: (righe: Riga[]) => void;
}

const testo = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const mostra = (c: Colonna, r: Riga) => (c.tipo === "data" ? dataIt(r[c.chiave]) : testo(r[c.chiave]));

// Griglia come nel programma originale: intestazioni ordinabili, riga filtri, riga selezionata arancione
export default function Griglia({ colonne, righe, selezionata, onSeleziona, onApri, onVisibili }: Props) {
  const [ordine, setOrdine] = useState<{ chiave: string; su: boolean }>({ chiave: colonne[0]?.chiave ?? "id", su: true });
  const [filtri, setFiltri] = useState<Record<string, string>>({});

  const visibili = useMemo(() => {
    const attivi = Object.entries(filtri).filter(([, f]) => f.trim());
    const filtrate = righe.filter((r) =>
      attivi.every(([k, f]) => {
        const c = colonne.find((c) => c.chiave === k);
        return (c ? mostra(c, r) : testo(r[k])).toLowerCase().includes(f.trim().toLowerCase());
      }),
    );
    const segno = ordine.su ? 1 : -1;
    return filtrate.sort((a, b) =>
      segno * testo(a[ordine.chiave]).localeCompare(testo(b[ordine.chiave]), "it", { sensitivity: "base", numeric: true }),
    );
  }, [righe, filtri, ordine, colonne]);

  useEffect(() => {
    onVisibili?.(visibili);
  }, [visibili, onVisibili]);

  const ordina = (chiave: string) =>
    setOrdine((o) => ({ chiave, su: o.chiave === chiave ? !o.su : true }));

  const larghezze = (
    <colgroup>
      <col style={{ width: 18 }} />
      {colonne.map((c) => <col key={c.chiave} style={{ width: c.larghezza }} />)}
    </colgroup>
  );

  return (
    <div className="griglia-dati">
      <div className="griglia-scorri">
        <table style={{ width: 18 + colonne.reduce((t, c) => t + c.larghezza, 0) }}>
          {larghezze}
          <thead>
            <tr className="intestazioni">
              <th />
              {colonne.map((c) => (
                <th key={c.chiave} onClick={() => ordina(c.chiave)}>
                  <span>{c.titolo}</span>
                  {ordine.chiave === c.chiave && <span className="ordine">{ordine.su ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
            <tr className="filtri">
              <th><Filter size={9} /></th>
              {colonne.map((c) => (
                <th key={c.chiave}>
                  <input value={filtri[c.chiave] ?? ""} onChange={(e) => setFiltri({ ...filtri, [c.chiave]: e.target.value })} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibili.map((r) => (
              <tr
                key={r.id}
                className={r.id === selezionata ? "attiva" : ""}
                onClick={() => onSeleziona(r.id)}
                onDoubleClick={() => onApri(r)}
              >
                <td className="indicatore-riga">{r.id === selezionata ? "▸" : ""}</td>
                {colonne.map((c) => (
                  <td key={c.chiave} title={mostra(c, r)}>{mostra(c, r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="griglia-piede">{visibili.length} di {righe.length} righe</div>
    </div>
  );
}
