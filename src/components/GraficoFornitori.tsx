import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../auth";
import { usePreferenza } from "../preferenze";
import { COLORI, euro, fasceDi, iso, inizioPeriodo, Linee, PERIODI, type Passo, type Periodo } from "./GraficoTecnici";

// Home (amministratori): andamento degli acquisti per fornitore, dai DDT di acquisto (imponibile o numero di DDT),
// per giorno o per mese, con i fornitori da scegliere per confrontarli (fino a 8). Le scelte restano salvate.
// Il colore resta legato al fornitore finché è selezionato (non cambia scegliendo o togliendo gli altri).

type Misura = "spesa" | "ddt";
type Ddt = { data: string; fornitore: string; importo: number };
type Scelto = { nome: string; slot: number };
const VISIBILI = 12;

const asseSpesa = (v: number) => (v >= 10000 ? `${(v / 1000).toLocaleString("it-IT", { maximumFractionDigits: 0 })}K €` : `${v.toLocaleString("it-IT", { maximumFractionDigits: 0 })} €`);
const numeroDdt = (v: number) => `${v.toLocaleString("it-IT", { maximumFractionDigits: 0 })} DDT`;

export default function GraficoFornitori() {
  const { profilo } = useAuth();
  const [pref, setPref] = usePreferenza<{ misura: Misura; passo: Passo; periodo: Periodo; scelti: Scelto[] | null }>(
    `${profilo?.id ?? ""}:grafico-fornitori`, { misura: "spesa", passo: "mese", periodo: "12m", scelti: null });
  const { misura, passo, periodo } = pref;
  const [ddt, setDdt] = useState<Ddt[] | null>(null);
  const [errore, setErrore] = useState("");
  const [carica, setCarica] = useState(false);
  const [tutti, setTutti] = useState(false);
  const [tabellaTutta, setTabellaTutta] = useState(false);

  useEffect(() => {
    let annullato = false;
    (async () => {
      setCarica(true);
      const righe: Ddt[] = [];
      for (let da = 0; ; da += 1000) {
        const { data, error } = await supabase.from("ddt_acquisto")
          .select("data, imponibile, fornitore:fornitori(nome)")
          .is("eliminato_il", null).gte("data", iso(inizioPeriodo(periodo))).lte("data", iso(new Date())).order("id").range(da, da + 999);
        if (annullato) return;
        if (error) { setErrore(/failed to fetch/i.test(error.message) ? "Connessione assente: riprova tra poco." : error.message); setCarica(false); return; }
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          righe.push({ data: String(r.data ?? "").slice(0, 10), fornitore: (r.fornitore as { nome?: string } | null)?.nome?.trim() || "Senza fornitore", importo: Number(r.imponibile) || 0 });
        }
        if (!data || data.length < 1000) break;
      }
      setErrore(""); setDdt(righe); setCarica(false);
    })();
    return () => { annullato = true; };
  }, [periodo]);

  // Fornitori del periodo, dal più importante (spesa)
  const fornitori = useMemo(() => {
    const per = new Map<string, { nome: string; spesa: number; ddt: number }>();
    for (const d of ddt ?? []) {
      const f = per.get(d.fornitore) ?? { nome: d.fornitore, spesa: 0, ddt: 0 };
      f.spesa += d.importo; f.ddt++;
      per.set(d.fornitore, f);
    }
    return [...per.values()].sort((a, b) => b.spesa - a.spesa || b.ddt - a.ddt);
  }, [ddt]);
  const totale = fornitori.reduce((t, f) => t + f.spesa, 0);

  // Scelti: quelli salvati, altrimenti i primi 5 del periodo; ognuno tiene il suo colore (slot)
  const scelti: Scelto[] = useMemo(() => pref.scelti ?? fornitori.slice(0, 5).map((f, i) => ({ nome: f.nome, slot: i })), [pref.scelti, fornitori]);
  const coloreDi = (nome: string) => { const s = scelti.find((x) => x.nome === nome); return s ? COLORI[s.slot] : null; };
  const cambia = (nome: string) => {
    if (scelti.some((x) => x.nome === nome)) return setPref((p) => ({ ...p, scelti: scelti.filter((x) => x.nome !== nome) }));
    const liberi = COLORI.map((_, i) => i).filter((i) => !scelti.some((x) => x.slot === i));
    if (!liberi.length) return alert("Si possono confrontare al massimo 8 fornitori alla volta: togline uno prima.");
    setPref((p) => ({ ...p, scelti: [...scelti, { nome, slot: liberi[0] }] }));
  };

  const fasce = useMemo(() => fasceDi(periodo, passo), [periodo, passo]);
  const serie = useMemo(() => {
    const indice = new Map(fasce.map((f, i) => [f.k, i]));
    const per = new Map<string, number[]>();
    for (const d of ddt ?? []) {
      const i = indice.get(passo === "giorno" ? d.data : d.data.slice(0, 7));
      if (i === undefined) continue;
      if (!per.has(d.fornitore)) per.set(d.fornitore, fasce.map(() => 0));
      per.get(d.fornitore)![i] += misura === "ddt" ? 1 : d.importo;
    }
    return [...scelti].sort((a, b) => a.slot - b.slot).map((s) => ({ nome: s.nome, colore: COLORI[s.slot], valori: per.get(s.nome) ?? fasce.map(() => 0) }));
  }, [ddt, fasce, scelti, misura, passo]);

  // Pulsanti: prima i selezionati, poi gli altri per spesa (i primi 12, poi "mostra tutti")
  const altri = fornitori.filter((f) => !scelti.some((s) => s.nome === f.nome));
  const assentiScelti = scelti.filter((s) => !fornitori.some((f) => f.nome === s.nome));

  return (
    <div className="grafico-tecnici">
      <div className="gt-testa">
        <h3>Andamento fornitori</h3>
        <div className="gt-filtri">
          <select value={periodo} onChange={(e) => { const x = e.target.value as Periodo; setPref((p) => ({ ...p, periodo: x, passo: x === "30" || x === "90" ? "giorno" : p.passo })); }} aria-label="Periodo">
            {PERIODI.map((p) => <option key={p.k} value={p.k}>{p.t}</option>)}
          </select>
          <div className="gt-scelta" role="group" aria-label="Misura">
            <button type="button" className={misura === "spesa" ? "attiva" : ""} onClick={() => setPref((p) => ({ ...p, misura: "spesa" }))}>Spesa €</button>
            <button type="button" className={misura === "ddt" ? "attiva" : ""} onClick={() => setPref((p) => ({ ...p, misura: "ddt" }))}>N. DDT</button>
          </div>
          <div className="gt-scelta" role="group" aria-label="Raggruppa per">
            <button type="button" className={passo === "giorno" ? "attiva" : ""} onClick={() => setPref((p) => ({ ...p, passo: "giorno" }))}>Per giorno</button>
            <button type="button" className={passo === "mese" ? "attiva" : ""} onClick={() => setPref((p) => ({ ...p, passo: "mese" }))}>Per mese</button>
          </div>
        </div>
      </div>

      {/* Legenda = scelta dei fornitori da confrontare */}
      <div className="gt-tecnici">
        {[...scelti].sort((a, b) => a.slot - b.slot).map((s) => {
          const presente = fornitori.some((f) => f.nome === s.nome);
          return (
            <button type="button" key={s.nome} className={`gt-tecnico attivo${presente ? "" : " assente"}`} aria-pressed onClick={() => cambia(s.nome)}
              title={presente ? "Tocca per toglierlo dal grafico" : "Nessun DDT in questo periodo · tocca per toglierlo"}>
              <span className="gt-chiave" style={{ background: COLORI[s.slot] }} />{s.nome}{presente ? "" : " · 0"}
            </button>
          );
        })}
        {(tutti ? altri : altri.slice(0, VISIBILI)).map((f) => (
          <button type="button" key={f.nome} className="gt-tecnico" aria-pressed={false} onClick={() => cambia(f.nome)} title="Tocca per aggiungerlo al grafico">
            <span className="gt-chiave" style={{ background: "#c3c2b7" }} />{f.nome}
          </button>
        ))}
        {altri.length > VISIBILI && (
          <button type="button" className="gt-tutti" onClick={() => setTutti(!tutti)}>{tutti ? "Mostra meno" : `Altri ${altri.length - VISIBILI}…`}</button>
        )}
        {scelti.length > 0 && (
          <button type="button" className="gt-tutti" onClick={() => setPref((p) => ({ ...p, scelti: [] }))}>Nessuno</button>
        )}
      </div>

      {errore && <p className="errore">{errore}</p>}
      <div className={`gt-area${carica ? " in-carica" : ""}`}>
        {ddt && !fornitori.length ? <p className="vuoto-linguetta">Nessun DDT di acquisto nel periodo.</p>
          : ddt && <Linee fasce={fasce} serie={serie} formato={misura === "ddt" ? numeroDdt : euro} asse={misura === "ddt" ? (v) => v.toLocaleString("it-IT", { maximumFractionDigits: 1 }) : asseSpesa}
            etichetta={`${misura === "ddt" ? "Numero di DDT" : "Spesa"} ${passo === "giorno" ? "per giorno" : "per mese"} per fornitore`} vuoto="Scegli uno o più fornitori qui sopra." />}
        {!ddt && !errore && <p className="vuoto-linguetta">Caricamento…</p>}
      </div>

      {ddt && fornitori.length > 0 && (
        <>
          <table className="gt-tabella">
            <thead><tr><th>Fornitore</th><th>DDT</th><th>Spesa</th><th>% del totale</th></tr></thead>
            <tbody>
              {(tabellaTutta ? fornitori : fornitori.slice(0, 10)).map((f) => {
                const c = coloreDi(f.nome);
                return (
                  <tr key={f.nome} className={c ? "" : "spento"}>
                    <td><span className="gt-nome"><span className="gt-chiave" style={{ background: c ?? "#e1e0d9" }} />{f.nome}</span></td>
                    <td>{f.ddt}</td>
                    <td>{euro(f.spesa)}</td>
                    <td>{totale ? `${((f.spesa / totale) * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {fornitori.length > 10 && (
            <button type="button" className="gt-tutti cs-altri" onClick={() => setTabellaTutta(!tabellaTutta)}>{tabellaTutta ? "Mostra meno" : `Mostra tutti i ${fornitori.length} fornitori`}</button>
          )}
          {assentiScelti.length > 0 && <p className="cs-regola">Senza DDT in questo periodo: {assentiScelti.map((s) => s.nome).join(", ")}.</p>}
        </>
      )}
    </div>
  );
}
