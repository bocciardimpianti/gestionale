import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../auth";
import { usePreferenza } from "../preferenze";

// Home: clienti divisi tra le squadre di Michael e di Luciano, dai tecnici che ci hanno lavorato.
// - Michael (anche con Stefano o Claudio) → cliente di Michael
// - Luciano o Paolo (anche con Stefano o Claudio) → cliente di Luciano
// - lavorato da entrambi: va a chi ci ha fatto più lavoro (valore, o numero di rapportini) ed è segnato "misto"
// - solo Stefano / Claudio / altri → da assegnare

type Persona = "michael" | "luciano" | "paolo" | "stefano" | "claudio";
const NOMI: Record<Persona, string[]> = {
  michael: ["michael", "micheal", "maicol", "maichol", "mikael"],
  luciano: ["luciano"], paolo: ["paolo"], stefano: ["stefano"], claudio: ["claudio"],
};
type Squadra = "Michael" | "Luciano" | "Da assegnare";
const SQUADRA_DI: Partial<Record<Persona, Squadra>> = { michael: "Michael", luciano: "Luciano", paolo: "Luciano" };
type Periodo = "tutto" | "anno" | "12m";
const PERIODI: { k: Periodo; t: string }[] = [{ k: "tutto", t: "Da sempre" }, { k: "12m", t: "Ultimi 12 mesi" }, { k: "anno", t: "Quest'anno" }];

// Stessi colori del grafico dei tecnici (ordine dei tecnici in anagrafica)
const COLORI = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const GRIGIO = "#898781";

type Cliente = { id: number; nome: string; squadra: Squadra; valore: number; rapportini: number; quota: { Michael: number; Luciano: number }; misto: boolean; ultimo: string; tecnici: string[] };

const euro = (v: number) => v.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const dataIt = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");

export default function ClientiSquadre() {
  const { vedePrezzi, profilo } = useAuth();
  const [pref, setPref] = usePreferenza<{ periodo: Periodo }>(`${profilo?.id ?? ""}:grafico-clienti-squadre`, { periodo: "tutto" });
  const periodo = pref.periodo;
  const setPeriodo = (x: Periodo) => setPref({ periodo: x });
  const [clienti, setClienti] = useState<Cliente[] | null>(null);
  const [colori, setColori] = useState<Record<Squadra, string>>({ Michael: COLORI[0], Luciano: COLORI[1], "Da assegnare": GRIGIO });
  const [errore, setErrore] = useState("");
  const [tutti, setTutti] = useState<Record<Squadra, boolean>>({ Michael: false, Luciano: false, "Da assegnare": false });

  useEffect(() => {
    let annullato = false;
    (async () => {
      setClienti(null);
      // Nomi dei tecnici (anche gli "altri nomi" dei DDT, es. Maicol) → persona
      const { data: tec } = await supabase.from("tecnici").select("id, nome, altri_nomi").order("id");
      const alias: [RegExp, Persona][] = [];
      const posizione: Partial<Record<Persona, number>> = {};
      (tec ?? []).forEach((t, i) => {
        const testo = String(t.nome ?? "").toLowerCase();
        for (const p of Object.keys(NOMI) as Persona[]) {
          if (NOMI[p].some((n) => new RegExp(`\\b${n}\\b`).test(testo))) {
            posizione[p] ??= i;
            for (const a of String(t.altri_nomi ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 3)) {
              alias.push([new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), p]);
            }
          }
        }
      });
      if (!annullato) setColori({
        Michael: COLORI[posizione.michael ?? 0] ?? COLORI[0],
        Luciano: COLORI[posizione.luciano ?? 1] ?? COLORI[1],
        "Da assegnare": GRIGIO,
      });
      const persone = (testo: string) => {
        const t = testo.toLowerCase();
        const out = new Set<Persona>();
        for (const p of Object.keys(NOMI) as Persona[]) if (NOMI[p].some((n) => new RegExp(`\\b${n}\\b`).test(t))) out.add(p);
        for (const [re, p] of alias) if (re.test(testo)) out.add(p);
        return out;
      };

      const oggi = new Date();
      const dal = periodo === "anno" ? `${oggi.getFullYear()}-01-01`
        : periodo === "12m" ? new Date(oggi.getFullYear() - 1, oggi.getMonth(), oggi.getDate() + 1).toISOString().slice(0, 10) : null;
      const perCliente = new Map<number, Cliente & { peso: { Michael: number; Luciano: number }; nomiTecnici: Set<string> }>();
      for (let da = 0; ; da += 1000) {
        let q = supabase.from("rapporti")
          .select("id, data, cliente_id, imponibile, totale_preventivo, considera_totale_preventivo, tecnico_vecchio, tecnico:tecnici(nome), cliente:clienti(nome)")
          .is("eliminato_il", null).not("cliente_id", "is", null);
        if (dal) q = q.gte("data", dal);
        const { data, error } = await q.order("id").range(da, da + 999);
        if (annullato) return;
        if (error) { setErrore(/failed to fetch/i.test(error.message) ? "Connessione assente: riprova tra poco." : error.message); return; }
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          const id = Number(r.cliente_id);
          const nomeTecnico = [(r.tecnico as { nome?: string } | null)?.nome, r.tecnico_vecchio].filter(Boolean).join(" ");
          const chi = persone(nomeTecnico);
          const valore = Number(r.considera_totale_preventivo ? r.totale_preventivo : r.imponibile) || 0;
          let c = perCliente.get(id);
          if (!c) {
            c = { id, nome: String((r.cliente as { nome?: string } | null)?.nome ?? "Cliente"), squadra: "Da assegnare", valore: 0, rapportini: 0,
              quota: { Michael: 0, Luciano: 0 }, misto: false, ultimo: "", tecnici: [], peso: { Michael: 0, Luciano: 0 }, nomiTecnici: new Set() };
            perCliente.set(id, c);
          }
          c.valore += valore; c.rapportini++;
          const d = String(r.data ?? "").slice(0, 10);
          if (d > c.ultimo) c.ultimo = d;
          if (nomeTecnico) c.nomiTecnici.add(nomeTecnico.trim());
          // Peso del rapportino per la squadra: il valore (o 1 se non ha importo)
          const peso = valore || 1;
          const squadre = new Set([...chi].map((p) => SQUADRA_DI[p]).filter(Boolean) as ("Michael" | "Luciano")[]);
          for (const s of squadre) c.peso[s] += peso / squadre.size;
        }
        if (!data || data.length < 1000) break;
      }
      const out: Cliente[] = [...perCliente.values()].map((c) => {
        const tot = c.peso.Michael + c.peso.Luciano;
        const squadra: Squadra = !tot ? "Da assegnare" : c.peso.Michael >= c.peso.Luciano ? "Michael" : "Luciano";
        return { id: c.id, nome: c.nome, squadra, valore: c.valore, rapportini: c.rapportini, ultimo: c.ultimo,
          quota: { Michael: tot ? c.peso.Michael / tot : 0, Luciano: tot ? c.peso.Luciano / tot : 0 },
          misto: c.peso.Michael > 0 && c.peso.Luciano > 0, tecnici: [...c.nomiTecnici].sort() };
      });
      setErrore(""); setClienti(out);
    })();
    return () => { annullato = true; };
  }, [periodo]);

  const gruppi = useMemo(() => {
    const g: Record<Squadra, Cliente[]> = { Michael: [], Luciano: [], "Da assegnare": [] };
    for (const c of clienti ?? []) g[c.squadra].push(c);
    for (const k of Object.keys(g) as Squadra[]) g[k].sort((a, b) => (vedePrezzi ? b.valore - a.valore : b.rapportini - a.rapportini));
    return g;
  }, [clienti, vedePrezzi]);
  const squadre: Squadra[] = ["Michael", "Luciano", "Da assegnare"];
  const somma = (s: Squadra, k: "valore" | "conta") => (k === "conta" ? gruppi[s].length : gruppi[s].reduce((t, c) => t + c.valore, 0));

  const Barra = ({ k, titolo }: { k: "valore" | "conta"; titolo: string }) => {
    const tot = squadre.reduce((t, s) => t + somma(s, k), 0);
    return (
      <div className="cs-barra-riga">
        <div className="cs-barra-titolo">{titolo}</div>
        <div className="cs-barra" role="img" aria-label={`${titolo}: ${squadre.map((s) => `${s} ${somma(s, k)}`).join(", ")}`}>
          {squadre.map((s) => {
            const v = somma(s, k); if (!v || !tot) return null;
            const quota = v / tot;
            const testo = `${Math.round(quota * 100)}%`;
            return (
              <div key={s} className="cs-pezzo" style={{ flexGrow: v, background: colori[s] }}
                title={`${s}: ${k === "valore" ? euro(v) : `${v} clienti`} (${testo})`}>
                {quota >= 0.08 && <span>{testo}</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="grafico-tecnici clienti-squadre">
      <div className="gt-testa">
        <h3>Clienti di Michael e di Luciano</h3>
        <div className="gt-filtri">
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)} aria-label="Periodo">
            {PERIODI.map((p) => <option key={p.k} value={p.k}>{p.t}</option>)}
          </select>
        </div>
      </div>
      <p className="cs-regola">Michael (anche con Stefano o Claudio) → Michael · Luciano o Paolo (anche con Stefano o Claudio) → Luciano · lavorati da entrambi: a chi ci ha fatto più lavoro (segnati «misto»)</p>
      {errore && <p className="errore">{errore}</p>}
      {!clienti && !errore && <p className="vuoto-linguetta">Caricamento…</p>}
      {clienti && (
        <>
          <div className="cs-legenda">
            {squadre.map((s) => (
              <span key={s}><span className="cs-quadro" style={{ background: colori[s] }} />{s}
                <b>{gruppi[s].length} clienti</b>{vedePrezzi && <b>{euro(somma(s, "valore"))}</b>}</span>
            ))}
          </div>
          <Barra k="conta" titolo="Clienti" />
          {vedePrezzi && <Barra k="valore" titolo="Valore dei rapportini" />}
          <div className="cs-colonne">
            {squadre.map((s) => (
              <div key={s} className="cs-colonna">
                <div className="cs-colonna-titolo"><span className="cs-quadro" style={{ background: colori[s] }} />{s === "Da assegnare" ? "Da assegnare (solo Stefano, Claudio o altri)" : `Clienti di ${s}`}<span className="cs-conta">{gruppi[s].length}</span></div>
                <table className="gt-tabella cs-tabella">
                  <thead><tr><th>Cliente</th><th>Rapp.</th>{vedePrezzi && <th>Valore</th>}</tr></thead>
                  <tbody>
                    {(tutti[s] ? gruppi[s] : gruppi[s].slice(0, 12)).map((c) => (
                      <tr key={c.id} title={`Tecnici: ${c.tecnici.join(", ") || "—"} · ultimo intervento ${dataIt(c.ultimo)}`}>
                        <td>{c.nome}{c.misto && <span className="cs-misto">misto {Math.round(Math.min(c.quota.Michael, c.quota.Luciano) * 100)}% {s === "Michael" ? "Luciano" : "Michael"}</span>}</td>
                        <td>{c.rapportini}</td>
                        {vedePrezzi && <td>{euro(c.valore)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {gruppi[s].length > 12 && (
                  <button type="button" className="gt-tutti cs-altri" onClick={() => setTutti((t) => ({ ...t, [s]: !t[s] }))}>
                    {tutti[s] ? "Mostra meno" : `Mostra tutti (${gruppi[s].length})`}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
