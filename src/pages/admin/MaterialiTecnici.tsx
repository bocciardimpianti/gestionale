import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, ChevronDown, ChevronRight, Warehouse } from "lucide-react";
import { dataIso, dataIt, supabase } from "../../supabase";

// Registro materiali per tecnico: nel periodo scelto, per ogni tecnico (e per il Magazzino)
// materiali ordinati nei DDT di acquisto, installati nei rapportini, spostati, e quanto è rimasto.
// I materiali rimasti si possono spostare al Magazzino (o a un altro tecnico).

type Tecnico = { id: number; nome: string };
type Voce = { chiave: string; materiale_id: number | null; descrizione: string; um: string };
type Riga = Voce & {
  ordinato: number; installato: number; ricevuto: number; spostato: number;
  ddt: string[]; rapportini: string[];
};
const MAGAZZINO = 0; // "tecnico" del Magazzino

const n = (v: unknown) => Number(v ?? 0) || 0;
const fmt = (v: number) => (Math.round(v * 1000) / 1000).toLocaleString("it-IT");
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const chiaveDi = (materiale_id: unknown, descrizione: unknown) => (materiale_id ? `m${materiale_id}` : `d${norm(String(descrizione ?? ""))}`);

// Lettura a pagine di 1000 righe con un filtro (la query va ricreata a ogni pagina)
type Pagina<T> = { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> } & T;
async function tutte<T>(query: () => unknown): Promise<T[]> {
  const out: T[] = [];
  for (let da = 0; ; da += 1000) {
    const { data, error } = await (query() as Pagina<object>).range(da, da + 999);
    if (error) throw new Error(error.message);
    const righe = (data ?? []) as T[];
    out.push(...righe);
    if (righe.length < 1000) return out;
  }
}
async function perId<T>(tabella: string, select: string, campo: string, ids: number[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const parte = ids.slice(i, i + 150);
    out.push(...(await tutte<T>(() => supabase.from(tabella).select(select).in(campo, parte).order("id") as never)));
  }
  return out;
}

// Periodi già pronti
const lunedi = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
function periodo(tipo: string): [string, string] {
  const oggi = new Date();
  const f = (d: Date) => dataIso(d)!;
  if (tipo === "settimana") { const l = lunedi(oggi); const v = new Date(l); v.setDate(l.getDate() + 6); return [f(l), f(v)]; }
  if (tipo === "settimana-scorsa") { const l = lunedi(oggi); l.setDate(l.getDate() - 7); const v = new Date(l); v.setDate(l.getDate() + 6); return [f(l), f(v)]; }
  if (tipo === "mese") return [f(new Date(oggi.getFullYear(), oggi.getMonth(), 1)), f(new Date(oggi.getFullYear(), oggi.getMonth() + 1, 0))];
  return [f(new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1)), f(new Date(oggi.getFullYear(), oggi.getMonth(), 0))];
}

export default function MaterialiTecnici() {
  const [tipo, setTipo] = useState("settimana-scorsa");
  const [[dal, al], setPeriodo] = useState<[string, string]>(() => periodo("settimana-scorsa"));
  const [tecnici, setTecnici] = useState<Tecnico[]>([]);
  // Per ogni tecnico (0 = Magazzino) le righe del registro
  const [registro, setRegistro] = useState<Map<number, Map<string, Riga>> | null>(null);
  const [scelto, setScelto] = useState<number>(MAGAZZINO);
  const [soloRimasti, setSoloRimasti] = useState(true);
  const [aperta, setAperta] = useState<string | null>(null);
  const [sposta, setSposta] = useState<{ riga: Riga; quantita: string; a: number; note: string } | null>(null);
  const [errore, setErrore] = useState("");
  const [messaggio, setMessaggio] = useState("");
  const [versione, setVersione] = useState(0);

  useEffect(() => {
    supabase.from("tecnici").select("id, nome").is("eliminato_il", null).order("nome").then(({ data }) => {
      const t = ((data ?? []) as Tecnico[]).filter((x) => !/amministrazione/i.test(x.nome));
      setTecnici(t);
      setScelto((s) => (s === MAGAZZINO && t.length ? t[0].id : s));
    });
  }, []);

  useEffect(() => {
    let attivo = true;
    setRegistro(null); setErrore("");
    (async () => {
      type Ddt = { id: number; data: string; numero_ddt: string | null; tecnico_id: number | null; fornitore: { nome: string } | null };
      type Rap = { id: number; data: string; numero: number | null; tecnico_id: number | null };
      type RigaD = { ddt_id: number; materiale_id: number | null; descrizione: string | null; unita_misura: string | null; quantita: number | null; servizio: boolean };
      type RigaR = { rapporto_id: number; materiale_id: number | null; descrizione: string | null; unita_misura: string | null; quantita: number | null };
      type Mov = { id: number; materiale_id: number | null; descrizione: string | null; unita_misura: string | null; quantita: number; da_tecnico_id: number | null; a_tecnico_id: number | null };
      const [ddt, rap, mov] = await Promise.all([
        tutte<Ddt>(() => supabase.from("ddt_acquisto").select("id, data, numero_ddt, tecnico_id, fornitore:fornitori(nome)").gte("data", dal).lte("data", al).is("eliminato_il", null).order("id") as never),
        tutte<Rap>(() => supabase.from("rapporti").select("id, data, numero, tecnico_id").gte("data", dal).lte("data", al).is("eliminato_il", null).order("id") as never),
        tutte<Mov>(() => supabase.from("movimenti_materiali").select("id, materiale_id, descrizione, unita_misura, quantita, da_tecnico_id, a_tecnico_id").gte("data", dal).lte("data", al).order("id") as never)
          .catch((e) => { throw new Error(/movimenti_materiali/.test(String(e.message)) ? "Esegui su Supabase lo script 0030_movimenti_materiali.sql" : e.message); }),
      ]);
      const [righeD, righeR] = await Promise.all([
        perId<RigaD>("righe_ddt_acquisto", "ddt_id, materiale_id, descrizione, unita_misura, quantita, servizio", "ddt_id", ddt.map((d) => d.id)),
        perId<RigaR>("righe_rapporto", "rapporto_id, materiale_id, descrizione, unita_misura, quantita", "rapporto_id", rap.map((r) => r.id)),
      ]);
      const ddtPerId = new Map(ddt.map((d) => [d.id, d]));
      const rapPerId = new Map(rap.map((r) => [r.id, r]));
      const reg = new Map<number, Map<string, Riga>>();
      const riga = (tec: number, materiale_id: number | null, descrizione: string | null, um: string | null) => {
        const t = reg.get(tec) ?? new Map<string, Riga>();
        reg.set(tec, t);
        const k = chiaveDi(materiale_id, descrizione);
        let r = t.get(k);
        if (!r) {
          r = { chiave: k, materiale_id, descrizione: String(descrizione ?? "").trim() || "(senza descrizione)", um: String(um ?? ""), ordinato: 0, installato: 0, ricevuto: 0, spostato: 0, ddt: [], rapportini: [] };
          t.set(k, r);
        }
        return r;
      };
      for (const x of righeD) {
        if (x.servizio || !(n(x.quantita) > 0)) continue;
        const d = ddtPerId.get(x.ddt_id);
        if (!d) continue;
        const r = riga(d.tecnico_id ?? MAGAZZINO, x.materiale_id, x.descrizione, x.unita_misura);
        r.ordinato += n(x.quantita);
        const nome = `DDT ${d.numero_ddt ?? ""} del ${dataIt(d.data)}${d.fornitore?.nome ? ` (${d.fornitore.nome})` : ""}`;
        if (!r.ddt.includes(nome)) r.ddt.push(nome);
      }
      for (const x of righeR) {
        if (!(n(x.quantita) > 0)) continue;
        const p = rapPerId.get(x.rapporto_id);
        if (!p || p.tecnico_id === null) continue;
        const r = riga(p.tecnico_id, x.materiale_id, x.descrizione, x.unita_misura);
        r.installato += n(x.quantita);
        const nome = `Rapportino ${p.numero ?? ""} del ${dataIt(p.data)}`;
        if (!r.rapportini.includes(nome)) r.rapportini.push(nome);
      }
      for (const m of mov) {
        riga(m.da_tecnico_id ?? MAGAZZINO, m.materiale_id, m.descrizione, m.unita_misura).spostato += n(m.quantita);
        riga(m.a_tecnico_id ?? MAGAZZINO, m.materiale_id, m.descrizione, m.unita_misura).ricevuto += n(m.quantita);
      }
      if (attivo) setRegistro(reg);
    })().catch((e) => attivo && setErrore((e as Error).message));
    return () => { attivo = false; };
  }, [dal, al, versione]);

  const rimasto = (r: Riga) => Math.round((r.ordinato + r.ricevuto - r.installato - r.spostato) * 1000) / 1000;
  const righeDi = (tec: number) => [...(registro?.get(tec)?.values() ?? [])].sort((a, b) => a.descrizione.localeCompare(b.descrizione));
  const nomeDi = (tec: number) => (tec === MAGAZZINO ? "Magazzino" : tecnici.find((t) => t.id === tec)?.nome ?? "?");
  const elenco = useMemo(() => righeDi(scelto).filter((r) => !soloRimasti || rimasto(r) > 0), [registro, scelto, soloRimasti]); // eslint-disable-line react-hooks/exhaustive-deps

  const conferma = async () => {
    if (!sposta) return;
    const q = Number(sposta.quantita.replace(",", "."));
    if (!(q > 0)) return setErrore("Quantità non valida");
    const { error } = await supabase.from("movimenti_materiali").insert({
      data: al < dataIso(new Date())! ? al : dataIso(new Date()),
      materiale_id: sposta.riga.materiale_id, descrizione: sposta.riga.descrizione, unita_misura: sposta.riga.um || null, quantita: q,
      da_tecnico_id: scelto === MAGAZZINO ? null : scelto, a_tecnico_id: sposta.a === MAGAZZINO ? null : sposta.a, note: sposta.note.trim() || null,
    });
    if (error) return setErrore(/movimenti_materiali/.test(error.message) ? "Esegui su Supabase lo script 0030_movimenti_materiali.sql" : error.message);
    setMessaggio(`${fmt(q)} ${sposta.riga.um} di "${sposta.riga.descrizione}" spostati da ${nomeDi(scelto)} a ${nomeDi(sposta.a)}`);
    setSposta(null);
    setVersione((v) => v + 1);
  };

  const spostaTuttiInMagazzino = async () => {
    const daSpostare = righeDi(scelto).filter((r) => rimasto(r) > 0);
    if (!daSpostare.length || !confirm(`Spostare in Magazzino tutti i ${daSpostare.length} materiali rimasti di ${nomeDi(scelto)}?`)) return;
    const { error } = await supabase.from("movimenti_materiali").insert(daSpostare.map((r) => ({
      data: al < dataIso(new Date())! ? al : dataIso(new Date()),
      materiale_id: r.materiale_id, descrizione: r.descrizione, unita_misura: r.um || null, quantita: rimasto(r),
      da_tecnico_id: scelto, a_tecnico_id: null, note: "Rimasti non installati",
    })));
    if (error) return setErrore(error.message);
    setMessaggio(`${daSpostare.length} materiali di ${nomeDi(scelto)} spostati in Magazzino`);
    setVersione((v) => v + 1);
  };

  const schede = [...tecnici.map((t) => t.id), MAGAZZINO];
  return (
    <div className="pagina-registro">
      <div className="testata"><h1>Materiali per tecnico</h1></div>
      <p className="piccolo">Per il periodo scelto: materiali <b>ordinati</b> nei DDT di acquisto di ogni tecnico, <b>installati</b> nei suoi rapportini e <b>rimasti</b>. I DDT senza tecnico vanno al Magazzino. I rimasti si possono spostare in Magazzino.</p>

      <div className="periodo-registro">
        {[["settimana", "Questa settimana"], ["settimana-scorsa", "Settimana scorsa"], ["mese", "Questo mese"], ["mese-scorso", "Mese scorso"]].map(([k, t]) => (
          <button key={k} className={`btn ${tipo === k ? "blu" : "grigio"}`} onClick={() => { setTipo(k); setPeriodo(periodo(k)); }}>{t}</button>
        ))}
        <label>dal <input type="date" value={dal} onChange={(e) => { setTipo(""); setPeriodo([e.target.value, al]); }} /></label>
        <label>al <input type="date" value={al} onChange={(e) => { setTipo(""); setPeriodo([dal, e.target.value]); }} /></label>
      </div>
      {errore && <p className="errore">{errore}</p>}
      {messaggio && <p className="ok">{messaggio}</p>}

      <div className="schede-tecnici">
        {schede.map((t) => {
          const righe = righeDi(t);
          const rimasti = righe.filter((r) => rimasto(r) > 0).length;
          return (
            <button key={t} className={`scheda-tecnico${t === scelto ? " attiva" : ""}${t === MAGAZZINO ? " magazzino" : ""}`} onClick={() => { setScelto(t); setAperta(null); }}>
              <b>{t === MAGAZZINO ? <><Warehouse size={15} /> Magazzino</> : <span className="nome-tecnico">{nomeDi(t)}</span>}</b>
              <span>{registro ? `${rimasti} ${rimasti === 1 ? "materiale rimasto" : "materiali rimasti"}` : "…"}</span>
              <span className="piccolo">{registro ? `${fmt(righe.reduce((s, r) => s + r.ordinato, 0))} ordinati · ${fmt(righe.reduce((s, r) => s + r.installato, 0))} installati` : ""}</span>
            </button>
          );
        })}
      </div>

      <div className="barra-registro">
        <label><input type="checkbox" checked={soloRimasti} onChange={(e) => setSoloRimasti(e.target.checked)} /> Solo i materiali rimasti</label>
        <span style={{ flex: 1 }} />
        {scelto !== MAGAZZINO && <button className="btn grigio" onClick={spostaTuttiInMagazzino}><Warehouse size={15} /> Sposta tutti i rimasti in Magazzino</button>}
      </div>

      {!registro && !errore ? <p className="piccolo">Calcolo…</p> : (
        <table className="griglia tabella-registro">
          <thead>
            <tr><th /><th>Materiale</th><th>UM</th><th className="destra">Ordinato</th><th className="destra">Ricevuto</th><th className="destra">Installato</th><th className="destra">Spostato</th><th className="destra">Rimasto</th><th /></tr>
          </thead>
          <tbody>
            {elenco.map((r) => {
              const rim = rimasto(r);
              return [
                <tr key={r.chiave} className={rim > 0 ? "rimasto" : rim < 0 ? "in-piu" : ""}>
                  <td><button className="link" onClick={() => setAperta(aperta === r.chiave ? null : r.chiave)} aria-label="Dettagli">{aperta === r.chiave ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button></td>
                  <td>{r.descrizione}</td>
                  <td>{r.um}</td>
                  <td className="destra">{r.ordinato ? fmt(r.ordinato) : ""}</td>
                  <td className="destra">{r.ricevuto ? fmt(r.ricevuto) : ""}</td>
                  <td className="destra">{r.installato ? fmt(r.installato) : ""}</td>
                  <td className="destra">{r.spostato ? fmt(r.spostato) : ""}</td>
                  <td className="destra"><b>{fmt(rim)}</b></td>
                  <td>{rim > 0 && <button className="btn grigio piccolo-btn" onClick={() => setSposta({ riga: r, quantita: fmt(rim), a: scelto === MAGAZZINO ? (tecnici[0]?.id ?? MAGAZZINO) : MAGAZZINO, note: "" })}><ArrowRightLeft size={14} /> Sposta</button>}</td>
                </tr>,
                aperta === r.chiave && (
                  <tr key={`${r.chiave}-d`} className="dettaglio-registro"><td /><td colSpan={8}>
                    {r.ddt.length > 0 && <div><b>Ordinato in:</b> {r.ddt.join(" · ")}</div>}
                    {r.rapportini.length > 0 && <div><b>Installato in:</b> {r.rapportini.join(" · ")}</div>}
                    {rim < 0 && <div className="piccolo">Installato più di quanto ordinato nel periodo: preso dal Magazzino o ordinato in un periodo precedente.</div>}
                  </td></tr>
                ),
              ];
            })}
            {!elenco.length && <tr><td colSpan={9} className="piccolo">{soloRimasti ? "Nessun materiale rimasto in questo periodo." : "Nessun materiale in questo periodo."}</td></tr>}
          </tbody>
        </table>
      )}

      {sposta && (
        <div className="velo" onMouseDown={() => setSposta(null)}>
          <div className="finestra stretta" onMouseDown={(e) => e.stopPropagation()}>
            <div className="finestra-titolo">Sposta materiale</div>
            <div className="finestra-corpo campi-sposta">
              <p><b>{sposta.riga.descrizione}</b><br /><span className="piccolo">da {nomeDi(scelto)} · rimasti {fmt(rimasto(sposta.riga))} {sposta.riga.um}</span></p>
              <label>Quantità <input inputMode="decimal" value={sposta.quantita} onChange={(e) => setSposta({ ...sposta, quantita: e.target.value })} /></label>
              <label>A
                <select value={sposta.a} onChange={(e) => setSposta({ ...sposta, a: Number(e.target.value) })}>
                  {[MAGAZZINO, ...tecnici.map((t) => t.id)].filter((t) => t !== scelto).map((t) => <option key={t} value={t}>{nomeDi(t)}</option>)}
                </select>
              </label>
              <label>Note <input value={sposta.note} onChange={(e) => setSposta({ ...sposta, note: e.target.value })} placeholder="es. reso in sede, scorta furgone…" /></label>
            </div>
            <div className="finestra-piede">
              <button className="btn grigio" onClick={() => setSposta(null)}>Annulla</button>
              <span style={{ flex: 1 }} />
              <button className="btn blu" onClick={conferma}>Sposta</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
