import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../auth";

// Home: andamento dei tecnici nel tempo (valore dei rapportini o ore lavorate, per giorno o per mese),
// con i tecnici da scegliere per confrontarli. Sotto, la tabella con i totali del periodo.

// Colori dei tecnici: ordine fisso (validato per i daltonici), il colore segue il tecnico e non cambia con i filtri
const COLORI = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const GRIGIO = "#898781";
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

type Misura = "valore" | "ore";
type Passo = "giorno" | "mese";
type Periodo = "30" | "90" | "anno" | "12m";
const PERIODI: { k: Periodo; t: string }[] = [
  { k: "30", t: "Ultimi 30 giorni" }, { k: "90", t: "Ultimi 90 giorni" }, { k: "anno", t: "Quest'anno" }, { k: "12m", t: "Ultimi 12 mesi" },
];
type Rap = { data: string; tecnico: string; ore: number; valore: number };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function inizioPeriodo(p: Periodo) {
  const oggi = new Date();
  if (p === "anno") return new Date(oggi.getFullYear(), 0, 1);
  if (p === "12m") return new Date(oggi.getFullYear(), oggi.getMonth() - 11, 1);
  const d = new Date(oggi); d.setDate(d.getDate() - (Number(p) - 1)); return d;
}
const euro = (v: number) => v.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: v >= 1000 ? 0 : 2 });
const ore = (v: number) => `${v.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h`;
const compatto = (v: number, m: Misura) => m === "ore" ? `${v.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h`
  : v >= 10000 ? `${(v / 1000).toLocaleString("it-IT", { maximumFractionDigits: 0 })}K €` : `${v.toLocaleString("it-IT", { maximumFractionDigits: 0 })} €`;

/** Massimo "tondo" e tacche dell'asse */
function tacche(max: number) {
  if (max <= 0) return { top: 1, passi: [0, 1] };
  const grezzo = max / 4;
  const pot = 10 ** Math.floor(Math.log10(grezzo));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((s) => s >= grezzo) ?? 10 * pot;
  const top = Math.ceil(max / passo) * passo;
  const passi: number[] = [];
  for (let v = 0; v <= top + passo / 2; v += passo) passi.push(Math.round(v * 100) / 100);
  return { top, passi };
}

export default function GraficoTecnici() {
  const { vedePrezzi } = useAuth();
  const [misura, setMisura] = useState<Misura>(vedePrezzi ? "valore" : "ore");
  // Si parte dall'ultimo anno per mese: negli ultimi giorni possono esserci rapportini di pochi tecnici
  const [passo, setPasso] = useState<Passo>("mese");
  const [periodo, setPeriodo] = useState<Periodo>("12m");
  const [rapporti, setRapporti] = useState<Rap[] | null>(null);
  const [ordineTecnici, setOrdineTecnici] = useState<string[]>([]);
  const [scelti, setScelti] = useState<Set<string> | null>(null);
  const [errore, setErrore] = useState("");
  const [carica, setCarica] = useState(false);

  // Ordine fisso dei tecnici (anagrafica): da qui il colore di ognuno
  useEffect(() => {
    supabase.from("tecnici").select("id, nome").is("eliminato_il", null).order("id")
      .then(({ data }) => setOrdineTecnici((data ?? []).map((t) => String(t.nome))));
  }, []);

  useEffect(() => {
    let annullato = false;
    (async () => {
      setCarica(true);
      const dal = iso(inizioPeriodo(periodo));
      const righe: Rap[] = [];
      for (let da = 0; ; da += 1000) {
        const { data, error } = await supabase.from("rapporti")
          .select("data, totale_ore, imponibile, totale_preventivo, considera_totale_preventivo, tecnico_vecchio, tecnico:tecnici(nome)")
          .is("eliminato_il", null).gte("data", dal).lte("data", iso(new Date())).order("id").range(da, da + 999);
        if (annullato) return;
        if (error) { setErrore(/failed to fetch/i.test(error.message) ? "Connessione assente: riprova tra poco." : error.message); setCarica(false); return; }
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          const tecnico = (r.tecnico as { nome?: string } | null)?.nome || String(r.tecnico_vecchio ?? "").trim() || "Senza tecnico";
          righe.push({
            data: String(r.data ?? "").slice(0, 10), tecnico, ore: Number(r.totale_ore) || 0,
            valore: Number(r.considera_totale_preventivo ? r.totale_preventivo : r.imponibile) || 0,
          });
        }
        if (!data || data.length < 1000) break;
      }
      setErrore(""); setRapporti(righe); setCarica(false);
    })();
    return () => { annullato = true; };
  }, [periodo]);

  // Tecnici presenti nel periodo, in ordine fisso; colore per posizione (oltre l'ottavo: grigio)
  const tecnici = useMemo(() => {
    const presenti = new Set((rapporti ?? []).map((r) => r.tecnico));
    const tutti = [...ordineTecnici, ...[...presenti].filter((t) => !ordineTecnici.includes(t)).sort()];
    const colore = new Map(tutti.map((t, i) => [t, COLORI[i] ?? GRIGIO]));
    return tutti.filter((t) => presenti.has(t)).map((t) => ({ nome: t, colore: colore.get(t)! }));
  }, [rapporti, ordineTecnici]);

  // Tecnici dell'anagrafica senza rapportini nel periodo: si vedono lo stesso (in grigio), per sapere che ci sono
  const senzaRapportini = useMemo(() => (rapporti ? ordineTecnici.filter((t) => !tecnici.some((x) => x.nome === t)) : []), [rapporti, ordineTecnici, tecnici]);

  // Al primo caricamento: scelti tutti (fino a 8)
  const attivi = useMemo(() => scelti ?? new Set(tecnici.slice(0, 8).map((t) => t.nome)), [scelti, tecnici]);
  const cambia = (nome: string) => {
    const n = new Set(attivi);
    if (n.has(nome)) n.delete(nome); else { if (n.size >= 8) return alert("Si possono confrontare al massimo 8 tecnici alla volta."); n.add(nome); }
    setScelti(n);
  };

  // Giorni o mesi del periodo
  const fasce = useMemo(() => {
    const out: { k: string; t: string; lungo: string }[] = [];
    const inizio = inizioPeriodo(periodo); const oggi = new Date();
    if (passo === "giorno") {
      for (const d = new Date(inizio); d <= oggi; d.setDate(d.getDate() + 1)) {
        out.push({ k: iso(d), t: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
          lungo: d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "long", year: "numeric" }) });
      }
    } else {
      for (const d = new Date(inizio.getFullYear(), inizio.getMonth(), 1); d <= oggi; d.setMonth(d.getMonth() + 1)) {
        out.push({ k: iso(d).slice(0, 7), t: `${MESI[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
          lungo: d.toLocaleDateString("it-IT", { month: "long", year: "numeric" }) });
      }
    }
    return out;
  }, [periodo, passo]);

  const serie = useMemo(() => {
    const indice = new Map(fasce.map((f, i) => [f.k, i]));
    const perTecnico = new Map<string, number[]>();
    for (const r of rapporti ?? []) {
      const i = indice.get(passo === "giorno" ? r.data : r.data.slice(0, 7));
      if (i === undefined) continue;
      if (!perTecnico.has(r.tecnico)) perTecnico.set(r.tecnico, fasce.map(() => 0));
      perTecnico.get(r.tecnico)![i] += misura === "ore" ? r.ore : r.valore;
    }
    return tecnici.filter((t) => attivi.has(t.nome)).map((t) => ({ ...t, valori: perTecnico.get(t.nome) ?? fasce.map(() => 0) }));
  }, [rapporti, fasce, tecnici, attivi, misura, passo]);

  // Totali del periodo per la tabella (tutti i tecnici presenti)
  const totali = useMemo(() => tecnici.map((t) => {
    const mie = (rapporti ?? []).filter((r) => r.tecnico === t.nome);
    const o = mie.reduce((s, r) => s + r.ore, 0), v = mie.reduce((s, r) => s + r.valore, 0);
    return { ...t, rapportini: mie.length, ore: o, valore: v, orario: o ? v / o : null };
  }).sort((a, b) => (misura === "ore" ? b.ore - a.ore : b.valore - a.valore)), [tecnici, rapporti, misura]);

  return (
    <div className="grafico-tecnici">
      <div className="gt-testa">
        <h3>Andamento tecnici</h3>
        <div className="gt-filtri">
          <select value={periodo} onChange={(e) => { const p = e.target.value as Periodo; setPeriodo(p); if (p === "30" || p === "90") setPasso("giorno"); }} aria-label="Periodo">
            {PERIODI.map((p) => <option key={p.k} value={p.k}>{p.t}</option>)}
          </select>
          <div className="gt-scelta" role="group" aria-label="Misura">
            {vedePrezzi && <button type="button" className={misura === "valore" ? "attiva" : ""} onClick={() => setMisura("valore")}>Valore €</button>}
            <button type="button" className={misura === "ore" ? "attiva" : ""} onClick={() => setMisura("ore")}>Ore</button>
          </div>
          <div className="gt-scelta" role="group" aria-label="Raggruppa per">
            <button type="button" className={passo === "giorno" ? "attiva" : ""} onClick={() => setPasso("giorno")}>Per giorno</button>
            <button type="button" className={passo === "mese" ? "attiva" : ""} onClick={() => setPasso("mese")}>Per mese</button>
          </div>
        </div>
      </div>

      {/* Legenda = scelta dei tecnici da confrontare */}
      <div className="gt-tecnici">
        {tecnici.map((t) => (
          <button type="button" key={t.nome} className={`gt-tecnico${attivi.has(t.nome) ? " attivo" : ""}`} aria-pressed={attivi.has(t.nome)} onClick={() => cambia(t.nome)}>
            <span className="gt-chiave" style={{ background: t.colore }} />{t.nome}
          </button>
        ))}
        {senzaRapportini.map((nome) => (
          <span key={nome} className="gt-tecnico vuoto" title="Nessun rapportino in questo periodo: prova un periodo più lungo">{nome} · 0</span>
        ))}
        {tecnici.length > 1 && (
          <button type="button" className="gt-tutti" onClick={() => setScelti(attivi.size ? new Set() : new Set(tecnici.slice(0, 8).map((t) => t.nome)))}>
            {attivi.size ? "Nessuno" : "Tutti"}
          </button>
        )}
      </div>

      {errore && <p className="errore">{errore}</p>}
      <div className={`gt-area${carica ? " in-carica" : ""}`}>
        {rapporti && !tecnici.length ? <p className="vuoto-linguetta">Nessun rapportino nel periodo.</p>
          : rapporti && <Linee fasce={fasce} serie={serie} misura={misura} passo={passo} />}
        {!rapporti && !errore && <p className="vuoto-linguetta">Caricamento…</p>}
      </div>

      {rapporti && totali.length > 0 && (
        <table className="gt-tabella">
          <thead><tr><th>Tecnico</th><th>Rapportini</th><th>Ore</th>{vedePrezzi && <><th>Valore</th><th>€ / ora</th></>}</tr></thead>
          <tbody>
            {totali.map((t) => (
              <tr key={t.nome} className={attivi.has(t.nome) ? "" : "spento"}>
                <td><span className="gt-nome"><span className="gt-chiave" style={{ background: t.colore }} /><span className="nome-tecnico">{t.nome}</span></span></td>
                <td>{t.rapportini}</td>
                <td>{ore(t.ore)}</td>
                {vedePrezzi && <><td>{euro(t.valore)}</td><td>{t.orario === null ? "—" : euro(t.orario)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Linee({ fasce, serie, misura, passo }: {
  fasce: { k: string; t: string; lungo: string }[]; serie: { nome: string; colore: string; valori: number[] }[]; misura: Misura; passo: Passo;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [larghezza, setLarghezza] = useState(800);
  const [sopraGrezzo, setSopra] = useState<number | null>(null);
  // Cambiando periodo o raggruppamento la posizione puntata può non esistere più
  const sopra = sopraGrezzo !== null && sopraGrezzo < fasce.length ? sopraGrezzo : null;
  useEffect(() => {
    if (!box.current) return;
    const o = new ResizeObserver(([e]) => setLarghezza(Math.max(280, Math.round(e.contentRect.width))));
    o.observe(box.current);
    return () => o.disconnect();
  }, []);

  const H = 260, M = { s: 58, d: 14, a: 12, b: 26 };
  const W = larghezza, pw = W - M.s - M.d, ph = H - M.a - M.b;
  const max = Math.max(0, ...serie.flatMap((s) => s.valori));
  const { top, passi } = tacche(max);
  const n = fasce.length;
  const x = (i: number) => M.s + (n <= 1 ? pw / 2 : (i * pw) / (n - 1));
  const y = (v: number) => M.a + ph - (v / top) * ph;
  // Etichette dell'asse orizzontale: al massimo una ogni ~70px
  const ogni = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 70))));
  const pallini = n <= 24;

  const muovi = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    setSopra(Math.max(0, Math.min(n - 1, i)));
  };
  const valoreTesto = (v: number) => (misura === "ore" ? ore(v) : euro(v));
  const righeTooltip = sopra === null ? [] : [...serie].map((s) => ({ ...s, v: s.valori[sopra] })).sort((a, b) => b.v - a.v);

  return (
    <div className="gt-grafico" ref={box}>
      <svg width={W} height={H} role="img"
        aria-label={`${misura === "ore" ? "Ore" : "Valore dei rapportini"} ${passo === "giorno" ? "per giorno" : "per mese"} per tecnico`}>
        {passi.map((v) => (
          <g key={v}>
            <line x1={M.s} x2={W - M.d} y1={y(v)} y2={y(v)} className={v === 0 ? "gt-base" : "gt-griglia"} />
            <text x={M.s - 8} y={y(v)} className="gt-asse" textAnchor="end" dominantBaseline="middle">{compatto(v, misura)}</text>
          </g>
        ))}
        {fasce.map((f, i) => (i % ogni === 0 || i === n - 1) && (n - 1 - i >= ogni || i === n - 1) ? (
          <text key={f.k} x={x(i)} y={H - 6} className="gt-asse" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{f.t}</text>
        ) : null)}
        {sopra !== null && <line x1={x(sopra)} x2={x(sopra)} y1={M.a} y2={M.a + ph} className="gt-mirino" />}
        {serie.map((s) => (
          <g key={s.nome}>
            <polyline fill="none" stroke={s.colore} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
              points={s.valori.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {s.valori.map((v, i) => (pallini || i === sopra) && (v > 0 || i === sopra) ? (
              <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.colore} stroke="#fff" strokeWidth={2} />
            ) : null)}
          </g>
        ))}
        <rect x={M.s} y={M.a} width={pw} height={ph} fill="transparent" onPointerMove={muovi} onPointerDown={muovi} onPointerLeave={() => setSopra(null)} />
      </svg>
      {sopra !== null && serie.length > 0 && (
        <div className="gt-tooltip" style={{ left: Math.min(Math.max(x(sopra) + 12, 0), W - 210), top: 8 }}>
          <div className="gt-tooltip-titolo">{fasce[sopra].lungo}</div>
          {righeTooltip.map((r) => (
            <div key={r.nome} className="gt-tooltip-riga">
              <span className="gt-linea" style={{ background: r.colore }} />
              <b>{valoreTesto(r.v)}</b><span>{r.nome}</span>
            </div>
          ))}
        </div>
      )}
      {!serie.length && <p className="gt-nessuno">Scegli uno o più tecnici qui sopra.</p>}
    </div>
  );
}
