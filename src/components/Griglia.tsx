import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Filter } from "lucide-react";
import { dataIt } from "../supabase";
import { Miniatura } from "./CampoImmagine";

// Colori degli stati dei documenti (Aperto arancione, Eseguito verde…)
export const COLORI_STATO: Record<string, string> = {
  Aperto: "#ef8c1a", Eseguito: "#3fae4b", Accettato: "#3fae4b", Chiuso: "#22b33a", Rifiutato: "#d9342b", Annullato: "#d9342b",
};

export interface Colonna {
  chiave: string;
  titolo: string;
  larghezza: number;
  tipo?: "data" | "booleano" | "euro" | "immagine" | "miniatura" | "numero" | "percentuale" | "stato";
  // Per le miniature: archivio file in cui si trova l'immagine
  archivio?: string;
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
  ordineIniziale?: { chiave: string; su: boolean };
  // Ricerca libera su tutte le colonne, o solo su "colonnaRicerca"
  ricerca?: string;
  colonnaRicerca?: string;
}

const testo = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const euro = (v: unknown) =>
  v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const mostra = (c: Colonna, r: Riga) =>
  c.tipo === "data" ? dataIt(r[c.chiave]) : c.tipo === "euro" ? euro(r[c.chiave])
  : c.tipo === "percentuale" ? (r[c.chiave] === null || r[c.chiave] === undefined ? "" : `${Number(r[c.chiave]).toLocaleString("it-IT")}%`)
  : c.tipo === "numero" ? (r[c.chiave] === null || r[c.chiave] === undefined ? "" : Number(r[c.chiave]).toLocaleString("it-IT")) : c.tipo === "booleano" ? (r[c.chiave] ? "sì" : "no") : testo(r[c.chiave]);

// Griglia come nel programma originale: intestazioni ordinabili, riga filtri, riga selezionata arancione
export default function Griglia({ colonne, righe, selezionata, onSeleziona, onApri, onVisibili, ordineIniziale, ricerca = "", colonnaRicerca = "" }: Props) {
  const [ordine, setOrdine] = useState<{ chiave: string; su: boolean }>(ordineIniziale ?? { chiave: colonne[0]?.chiave ?? "id", su: true });
  const [filtri, setFiltri] = useState<Record<string, string>>({});
  // Disegna solo le righe visibili (più un margine), per restare veloce con migliaia di record
  const scorri = useRef<HTMLDivElement>(null);
  const [finestra, setFinestra] = useState({ alto: 0, altezza: 900 });
  useEffect(() => {
    const el = scorri.current;
    if (!el) return;
    const aggiorna = () => setFinestra({ alto: el.scrollTop, altezza: el.clientHeight });
    aggiorna();
    el.addEventListener("scroll", aggiorna, { passive: true });
    window.addEventListener("resize", aggiorna);
    return () => {
      el.removeEventListener("scroll", aggiorna);
      window.removeEventListener("resize", aggiorna);
    };
  }, []);

  const visibili = useMemo(() => {
    const attivi = Object.entries(filtri).filter(([, f]) => f.trim());
    const parole = ricerca.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const dove = colonne.filter((c) =>
      c.tipo !== "booleano" && c.tipo !== "immagine" && c.tipo !== "miniatura" && (!colonnaRicerca || c.chiave === colonnaRicerca));
    // Su una colonna precisa si cercano le parole che INIZIANO col testo (es. "F" → Ferdinando, Rossi Franco)
    const iniziaCon = (v: string, p: string) => v.startsWith(p) || v.split(/[\s.,'()/-]+/).some((w) => w.startsWith(p));
    const filtrate = righe.filter((r) =>
      parole.every((p) => dove.some((c) => colonnaRicerca ? iniziaCon(mostra(c, r).toLowerCase(), p) : mostra(c, r).toLowerCase().includes(p))) &&
      attivi.every(([k, f]) => {
        const c = colonne.find((c) => c.chiave === k);
        if (c?.tipo === "booleano") return f === "sì" ? !!r[k] : !r[k];
        return (c ? mostra(c, r) : testo(r[k])).toLowerCase().includes(f.trim().toLowerCase());
      }),
    );
    // Ricerca su una colonna: prima chi inizia esattamente col testo, poi gli altri, in ordine alfabetico
    if (colonnaRicerca && parole.length) {
      const c = colonne.find((x) => x.chiave === colonnaRicerca)!;
      const t = ricerca.trim().toLowerCase();
      return filtrate.sort((a, b) => {
        const va = mostra(c, a).toLowerCase(), vb = mostra(c, b).toLowerCase();
        return Number(!va.startsWith(t)) - Number(!vb.startsWith(t)) || va.localeCompare(vb, "it", { sensitivity: "base", numeric: true });
      });
    }
    const segno = ordine.su ? 1 : -1;
    const tipo = colonne.find((c) => c.chiave === ordine.chiave)?.tipo;
    return filtrate.sort((a, b) =>
      tipo === "euro" || tipo === "booleano" || tipo === "numero" || tipo === "percentuale"
        ? segno * (Number(a[ordine.chiave] ?? 0) - Number(b[ordine.chiave] ?? 0))
        : segno * testo(a[ordine.chiave]).localeCompare(testo(b[ordine.chiave]), "it", { sensitivity: "base", numeric: true }),
    );
  }, [righe, filtri, ordine, colonne, ricerca, colonnaRicerca]);

  useEffect(() => {
    onVisibili?.(visibili);
  }, [visibili, onVisibili]);

  const ALTEZZA_RIGA = 21;
  const primo = Math.max(0, Math.floor(finestra.alto / ALTEZZA_RIGA) - 20);
  const ultimo = Math.min(visibili.length, primo + Math.ceil(finestra.altezza / ALTEZZA_RIGA) + 40);

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
      <div className="griglia-scorri" ref={scorri}>
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
                  {c.tipo === "booleano" ? (
                    <select value={filtri[c.chiave] ?? ""} onChange={(e) => setFiltri({ ...filtri, [c.chiave]: e.target.value })}>
                      <option value="" /><option value="sì">sì</option><option value="no">no</option>
                    </select>
                  ) : (
                    <input value={filtri[c.chiave] ?? ""} onChange={(e) => setFiltri({ ...filtri, [c.chiave]: e.target.value })} />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {primo > 0 && <tr style={{ height: primo * ALTEZZA_RIGA }} />}
            {visibili.slice(primo, ultimo).map((r) => (
              <tr
                key={r.id}
                className={r.id === selezionata ? "attiva" : ""}
                onClick={() => onSeleziona(r.id)}
                onDoubleClick={() => onApri(r)}
              >
                <td className="indicatore-riga">{r.id === selezionata ? "▸" : ""}</td>
                {colonne.map((c) => (
                  c.tipo === "miniatura" ? (
                    <td key={c.chiave} className="centrata cella-miniatura">
                      {typeof r[c.chiave] === "string" && r[c.chiave] ? <Miniatura percorso={r[c.chiave] as string} archivio={c.archivio!} /> : null}
                    </td>
                  ) : c.tipo === "immagine" ? (
                    <td key={c.chiave} className="centrata">{r[c.chiave] ? <Camera size={13} color="#8a6d3b" /> : null}</td>
                  ) : c.tipo === "stato" ? (
                    <td key={c.chiave} title={testo(r[c.chiave])}>
                      {r[c.chiave] ? <><span className="quadratino" style={{ background: COLORI_STATO[testo(r[c.chiave])] ?? "#999" }} />{testo(r[c.chiave])}</> : null}
                    </td>
                  ) : c.tipo === "booleano" ? (
                    <td key={c.chiave} className="centrata"><input type="checkbox" checked={!!r[c.chiave]} readOnly tabIndex={-1} /></td>
                  ) : (
                    <td key={c.chiave} title={mostra(c, r)} className={c.tipo === "euro" || c.tipo === "numero" || c.tipo === "percentuale" ? "destra" : ""}>{mostra(c, r)}</td>
                  )
                ))}
              </tr>
            ))}
            {ultimo < visibili.length && <tr style={{ height: (visibili.length - ultimo) * ALTEZZA_RIGA }} />}
          </tbody>
        </table>
      </div>
      <div className="griglia-piede">{visibili.length} di {righe.length} righe</div>
    </div>
  );
}
