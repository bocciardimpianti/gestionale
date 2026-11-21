import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";

// Home (amministratori): ricavi dei rapportini, divisi tra riscossi e da riscuotere, e spese per i materiali montati,
// mese per mese. Ricavo = importo del rapportino (imponibile, o totale del preventivo se scelto nel rapportino);
// spesa = quantità × prezzo d'acquisto (prima del ricarico) dei materiali del rapportino.

const COLORE = { riscossi: "#2a78d6", daRiscuotere: "#eb6834", spese: "#1baf7a" };
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
type Periodo = "12m" | "anno" | "annoScorso" | "24m";
const PERIODI: { k: Periodo; t: string }[] = [
  { k: "12m", t: "Ultimi 12 mesi" }, { k: "anno", t: "Quest'anno" }, { k: "annoScorso", t: "Anno scorso" }, { k: "24m", t: "Ultimi 24 mesi" },
];
type Mese = { k: string; t: string; lungo: string; riscossi: number; daRiscuotere: number; spese: number; rapportini: number };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const euro = (v: number) => v.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const asse = (v: number) => (v >= 10000 ? `${(v / 1000).toLocaleString("it-IT", { maximumFractionDigits: 0 })}K €` : `${v.toLocaleString("it-IT")} €`);

function intervallo(p: Periodo) {
  const oggi = new Date();
  if (p === "anno") return [new Date(oggi.getFullYear(), 0, 1), oggi];
  if (p === "annoScorso") return [new Date(oggi.getFullYear() - 1, 0, 1), new Date(oggi.getFullYear() - 1, 11, 31)];
  return [new Date(oggi.getFullYear(), oggi.getMonth() - (p === "24m" ? 23 : 11), 1), oggi];
}
function tacche(max: number) {
  if (max <= 0) return { top: 1000, passi: [0, 1000] };
  const grezzo = max / 4, pot = 10 ** Math.floor(Math.log10(grezzo));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((s) => s >= grezzo) ?? 10 * pot;
  const top = Math.ceil(max / passo) * passo;
  const passi: number[] = [];
  for (let v = 0; v <= top + passo / 2; v += passo) passi.push(v);
  return { top, passi };
}
/** Rettangolo con gli angoli in alto arrotondati (base dritta sull'asse) */
const colonna = (x: number, y: number, w: number, h: number, r = 4) => {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
};

export default function SpeseRicavi() {
  const [periodo, setPeriodo] = useState<Periodo>("12m");
  const [mesi, setMesi] = useState<Mese[] | null>(null);
  const [errore, setErrore] = useState("");
  const [carica, setCarica] = useState(false);

  useEffect(() => {
    let annullato = false;
    (async () => {
      setCarica(true);
      const [dal, al] = intervallo(periodo);
      const fine = iso(al) > iso(new Date()) ? iso(new Date()) : iso(al);
      const elenco: Mese[] = [];
      for (const d = new Date(dal.getFullYear(), dal.getMonth(), 1); iso(d) <= fine; d.setMonth(d.getMonth() + 1)) {
        elenco.push({ k: iso(d).slice(0, 7), t: `${MESI[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
          lungo: d.toLocaleDateString("it-IT", { month: "long", year: "numeric" }), riscossi: 0, daRiscuotere: 0, spese: 0, rapportini: 0 });
      }
      const indice = new Map(elenco.map((m, i) => [m.k, i]));
      const meseDi = new Map<number, number>();
      try {
        for (let da = 0; ; da += 1000) {
          const { data, error } = await supabase.from("rapporti")
            .select("id, data, pagata, imponibile, totale_preventivo, considera_totale_preventivo")
            .is("eliminato_il", null).gte("data", iso(dal)).lte("data", fine).order("id").range(da, da + 999);
          if (error) throw error;
          for (const r of (data ?? []) as Record<string, unknown>[]) {
            const i = indice.get(String(r.data ?? "").slice(0, 7));
            if (i === undefined) continue;
            const importo = Number(r.considera_totale_preventivo ? r.totale_preventivo : r.imponibile) || 0;
            if (r.pagata) elenco[i].riscossi += importo; else elenco[i].daRiscuotere += importo;
            elenco[i].rapportini++;
            meseDi.set(Number(r.id), i);
          }
          if (!data || data.length < 1000) break;
        }
        // Materiali dei rapportini del periodo (a gruppi di id)
        const ids = [...meseDi.keys()];
        for (let k = 0; k < ids.length; k += 150) {
          const { data, error } = await supabase.from("righe_rapporto").select("rapporto_id, quantita, prezzo").in("rapporto_id", ids.slice(k, k + 150));
          if (error) throw error;
          for (const r of (data ?? []) as Record<string, unknown>[]) {
            const i = meseDi.get(Number(r.rapporto_id));
            if (i !== undefined) elenco[i].spese += (Number(r.quantita) || 0) * (Number(r.prezzo) || 0);
          }
          if (annullato) return;
        }
        if (annullato) return;
        setErrore(""); setMesi(elenco);
      } catch (e) {
        if (!annullato) setErrore(/failed to fetch/i.test((e as Error).message) ? "Connessione assente: riprova tra poco." : (e as Error).message);
      }
      if (!annullato) setCarica(false);
    })();
    return () => { annullato = true; };
  }, [periodo]);

  const totali = useMemo(() => (mesi ?? []).reduce((t, m) => ({
    riscossi: t.riscossi + m.riscossi, daRiscuotere: t.daRiscuotere + m.daRiscuotere, spese: t.spese + m.spese, rapportini: t.rapportini + m.rapportini,
  }), { riscossi: 0, daRiscuotere: 0, spese: 0, rapportini: 0 }), [mesi]);
  const ricavi = totali.riscossi + totali.daRiscuotere;

  return (
    <div className="grafico-tecnici spese-ricavi">
      <div className="gt-testa">
        <h3>Ricavi e spese dei rapportini</h3>
        <div className="gt-filtri">
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)} aria-label="Periodo">
            {PERIODI.map((p) => <option key={p.k} value={p.k}>{p.t}</option>)}
          </select>
        </div>
      </div>
      {errore && <p className="errore">{errore}</p>}
      {!mesi && !errore && <p className="vuoto-linguetta">Caricamento…</p>}
      {mesi && (
        <div className={carica ? "in-carica sr-corpo" : "sr-corpo"}>
          <div className="sr-riquadri">
            <div className="sr-riquadro"><div className="sr-etichetta">Ricavi</div><div className="sr-valore">{euro(ricavi)}</div><div className="sr-nota">{totali.rapportini} rapportini</div></div>
            <div className="sr-riquadro"><div className="sr-etichetta"><span className="cs-quadro" style={{ background: COLORE.riscossi }} />Riscossi</div><div className="sr-valore">{euro(totali.riscossi)}</div><div className="sr-nota">{ricavi ? Math.round((totali.riscossi / ricavi) * 100) : 0}% dei ricavi</div></div>
            <div className="sr-riquadro"><div className="sr-etichetta"><span className="cs-quadro" style={{ background: COLORE.daRiscuotere }} />Da riscuotere</div><div className="sr-valore">{euro(totali.daRiscuotere)}</div><div className="sr-nota">{ricavi ? Math.round((totali.daRiscuotere / ricavi) * 100) : 0}% dei ricavi</div></div>
            <div className="sr-riquadro"><div className="sr-etichetta"><span className="cs-quadro" style={{ background: COLORE.spese }} />Spese materiali</div><div className="sr-valore">{euro(totali.spese)}</div><div className="sr-nota">prezzo d'acquisto</div></div>
            <div className="sr-riquadro"><div className="sr-etichetta">Margine</div><div className="sr-valore">{euro(ricavi - totali.spese)}</div><div className="sr-nota">ricavi − spese materiali</div></div>
          </div>
          <div className="cs-legenda">
            <span><span className="cs-quadro" style={{ background: COLORE.riscossi }} />Ricavi riscossi</span>
            <span><span className="cs-quadro" style={{ background: COLORE.daRiscuotere }} />Ricavi da riscuotere</span>
            <span><span className="cs-quadro" style={{ background: COLORE.spese }} />Spese materiali</span>
          </div>
          <Colonne mesi={mesi} />
          <div className="sr-scorri"><table className="gt-tabella sr-tabella">
            <thead><tr><th>Mese</th><th>Rapp.</th><th>Riscossi</th><th>Da riscuotere</th><th>Spese</th><th>Margine</th></tr></thead>
            <tbody>
              {[...mesi].reverse().map((m) => (
                <tr key={m.k}>
                  <td>{m.lungo}</td><td>{m.rapportini}</td><td>{euro(m.riscossi)}</td><td>{euro(m.daRiscuotere)}</td><td>{euro(m.spese)}</td>
                  <td>{euro(m.riscossi + m.daRiscuotere - m.spese)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="cs-regola">Spese: solo i materiali montati (quantità × prezzo d'acquisto). Le ore dei tecnici non hanno un costo registrato e non sono comprese.</p>
        </div>
      )}
    </div>
  );
}

function Colonne({ mesi }: { mesi: Mese[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [larghezza, setLarghezza] = useState(800);
  const [sopraGrezzo, setSopra] = useState<number | null>(null);
  const sopra = sopraGrezzo !== null && sopraGrezzo < mesi.length ? sopraGrezzo : null;
  useEffect(() => {
    if (!box.current) return;
    const o = new ResizeObserver(([e]) => setLarghezza(Math.max(280, Math.round(e.contentRect.width))));
    o.observe(box.current);
    return () => o.disconnect();
  }, []);

  const H = 260, M = { s: 58, d: 8, a: 12, b: 26 };
  const W = larghezza, pw = W - M.s - M.d, ph = H - M.a - M.b;
  const { top, passi } = tacche(Math.max(0, ...mesi.map((m) => Math.max(m.riscossi + m.daRiscuotere, m.spese))));
  const n = mesi.length, banda = pw / n;
  const w = Math.max(4, Math.min(24, (banda - 10) / 2));
  const y = (v: number) => M.a + ph - (v / top) * ph;
  const ogni = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 56))));

  return (
    <div className="gt-grafico" ref={box}>
      <svg width={W} height={H} role="img" aria-label="Ricavi riscossi, da riscuotere e spese per mese">
        {passi.map((v) => (
          <g key={v}>
            <line x1={M.s} x2={W - M.d} y1={y(v)} y2={y(v)} className={v === 0 ? "gt-base" : "gt-griglia"} />
            <text x={M.s - 8} y={y(v)} className="gt-asse" textAnchor="end" dominantBaseline="middle">{asse(v)}</text>
          </g>
        ))}
        {mesi.map((m, i) => {
          const cx = M.s + banda * i + banda / 2;
          const x1 = cx - w - 2, x2 = cx + 2;
          const hR = (m.riscossi / top) * ph, hD = (m.daRiscuotere / top) * ph, hS = (m.spese / top) * ph;
          const base = M.a + ph;
          const gap = hR > 0 && hD > 0 ? 2 : 0;
          return (
            <g key={m.k} className={sopra === i ? "sr-sopra" : ""}>
              {sopra === i && <rect x={M.s + banda * i + 1} y={M.a} width={banda - 2} height={ph} className="sr-fascia" />}
              {/* Ricavi: riscossi in basso, da riscuotere sopra (2px di stacco); spese accanto */}
              {hD > 0
                ? <><rect x={x1} y={base - hR} width={w} height={Math.max(0, hR)} fill={COLORE.riscossi} />
                    <path d={colonna(x1, base - hR - gap - hD, w, hD)} fill={COLORE.daRiscuotere} /></>
                : <path d={colonna(x1, base - hR, w, hR)} fill={COLORE.riscossi} />}
              <path d={colonna(x2, base - hS, w, hS)} fill={COLORE.spese} />
              {(i % ogni === 0) && <text x={cx} y={H - 6} className="gt-asse" textAnchor="middle">{m.t}</text>}
              <rect x={M.s + banda * i} y={M.a} width={banda} height={ph} fill="transparent"
                onPointerEnter={() => setSopra(i)} onPointerDown={() => setSopra(i)} onPointerLeave={() => setSopra(null)} />
            </g>
          );
        })}
      </svg>
      {sopra !== null && (() => {
        const m = mesi[sopra];
        const x = M.s + banda * sopra + banda / 2;
        return (
          <div className="gt-tooltip" style={{ left: Math.min(Math.max(x + 14, 0), W - 220), top: 8 }}>
            <div className="gt-tooltip-titolo">{m.lungo} · {m.rapportini} rapportini</div>
            <div className="gt-tooltip-riga"><span className="gt-linea" style={{ background: COLORE.riscossi }} /><b>{euro(m.riscossi)}</b><span>riscossi</span></div>
            <div className="gt-tooltip-riga"><span className="gt-linea" style={{ background: COLORE.daRiscuotere }} /><b>{euro(m.daRiscuotere)}</b><span>da riscuotere</span></div>
            <div className="gt-tooltip-riga"><span className="gt-linea" style={{ background: COLORE.spese }} /><b>{euro(m.spese)}</b><span>spese materiali</span></div>
            <div className="gt-tooltip-riga"><span className="gt-linea" /><b>{euro(m.riscossi + m.daRiscuotere - m.spese)}</b><span>margine</span></div>
          </div>
        );
      })()}
    </div>
  );
}
