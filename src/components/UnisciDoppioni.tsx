import { useEffect, useMemo, useState } from "react";
import { leggiTutto, registra, supabase } from "../supabase";
import { codiciUniti, trovaDoppioni, type Gruppo, type MaterialeA } from "../accorpaMateriali";

// Materiali → Azioni → "Unisci articoli doppi": gruppi di articoli che sono lo stesso pezzo (raccordi: la marca non
// conta, prezzi troppo diversi restano fuori; altre categorie: solo descrizioni identiche). Per ogni gruppo si sceglie
// se unirlo e quale articolo tenere; gli altri vanno nel Cestino e tutto quello che li usava passa all'articolo tenuto.

const euro = (n: unknown) => (Number(n) || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
type Unione = { id: number; tieni: number; togli: number[]; creato_il: string; annullata_il: string | null };

export default function UnisciDoppioni({ onChiudi, onFinito }: { onChiudi: () => void; onFinito: () => void }) {
  const [gruppi, setGruppi] = useState<Gruppo[] | null>(null);
  const [scelti, setScelti] = useState<Set<string>>(new Set());
  const [tieni, setTieni] = useState<Record<string, number>>({});
  // articoli tolti a mano da un gruppo (restano come sono)
  const [fuori, setFuori] = useState<Set<number>>(new Set());
  const [livello, setLivello] = useState<"" | "sicuro" | "da controllare">("");
  const [cerca, setCerca] = useState("");
  const [stato, setStato] = useState("Lettura dei materiali…");
  const [inCorso, setInCorso] = useState(false);
  const [unioni, setUnioni] = useState<Unione[]>([]);
  const [nomi, setNomi] = useState<Map<number, string>>(new Map());

  const carica = async () => {
    setGruppi(null); setStato("Lettura dei materiali…");
    try {
      const righe = await leggiTutto("materiali", "id, descrizione, categoria, prezzo_base, foto, giacenza, codice_interno, fornitore1, codice_fornitore1, fornitore2, codice_fornitore2, eliminato_il", true) as MaterialeA[];
      setNomi(new Map(righe.map((m) => [m.id, String(m.descrizione ?? "")])));
      // quante volte è stato usato nei rapportini: si tiene il più usato
      const primi = trovaDoppioni(righe);
      const ids = [...new Set(primi.flatMap((g) => [...g.articoli, ...g.esclusi].map((m) => m.id)))];
      const usi = new Map<number, number>();
      setStato("Conteggio degli utilizzi…");
      for (let i = 0; i < ids.length; i += 100) {
        for (let da = 0; ; da += 1000) {
          const { data, error } = await supabase.from("righe_rapporto").select("materiale_id").in("materiale_id", ids.slice(i, i + 100)).order("id").range(da, da + 999);
          if (error) throw error;
          for (const r of data ?? []) usi.set(Number(r.materiale_id), (usi.get(Number(r.materiale_id)) ?? 0) + 1);
          if (!data || data.length < 1000) break;
        }
      }
      const g = trovaDoppioni(righe, usi).map((x) => ({ ...x, articoli: x.articoli.map((m) => ({ ...m, usi: usi.get(m.id) ?? 0 })) }));
      setGruppi(g);
      setScelti(new Set(g.filter((x) => x.livello === "sicuro").map((x) => x.chiave)));
      setTieni(Object.fromEntries(g.map((x) => [x.chiave, x.tieni])));
      setFuori(new Set());
      const n = g.reduce((t, x) => t + x.articoli.length - 1, 0);
      setStato(g.length ? `${g.length} gruppi di doppioni: ${n} articoli in meno se li unisci tutti.` : "Nessun doppione trovato.");
      const { data: u } = await supabase.from("unioni_materiali").select("id, tieni, togli, creato_il, annullata_il").is("annullata_il", null).order("id", { ascending: false }).limit(50);
      setUnioni((u ?? []) as Unione[]);
    } catch (e) { setStato("Errore: " + (e as Error).message); }
  };
  useEffect(() => { carica(); }, []);

  const parole = cerca.toUpperCase().split(/\s+/).filter(Boolean);
  const visibili = useMemo(() => (gruppi ?? []).filter((g) => (!livello || g.livello === livello)
    && parole.every((w) => g.articoli.some((m) => String(m.descrizione).toUpperCase().includes(w)))), [gruppi, livello, cerca]);
  const conteggio = (l: string) => (gruppi ?? []).filter((g) => !l || g.livello === l).length;
  // gruppi pronti: almeno due articoli rimasti dentro
  const daUnire = (gruppi ?? []).filter((g) => scelti.has(g.chiave)).map((g) => {
    const art = g.articoli.filter((m) => !fuori.has(m.id) || m.id === tieni[g.chiave]);
    return { g, art, t: tieni[g.chiave] };
  }).filter((x) => x.art.length >= 2);
  const quantiTolti = daUnire.reduce((t, x) => t + x.art.length - 1, 0);

  const unisci = async () => {
    if (!daUnire.length || !confirm(`Unire ${daUnire.length} gruppi? ${quantiTolti} articoli vanno nel Cestino e rapportini, DDT, preventivi e kit che li usavano passano all'articolo tenuto.\n\nGiacenze sommate, codici fornitore uniti. Si può annullare.`)) return;
    setInCorso(true);
    let fatti = 0;
    try {
      for (const { art, t } of daUnire) {
        setStato(`Unione… ${fatti} di ${daUnire.length}`);
        const tenuto = art.find((m) => m.id === t)!;
        const altri = art.filter((m) => m.id !== t);
        const { error } = await supabase.rpc("unisci_materiali", { p_tieni: t, p_togli: altri.map((m) => m.id), p_campi: codiciUniti(tenuto, altri) });
        if (error) throw new Error(/unisci_materiali|function/i.test(error.message) ? "Esegui su Supabase lo script 0056_unisci_materiali.sql" : error.message);
        fatti++;
      }
      await registra("materiali_uniti", { gruppi: fatti, articoli: quantiTolti });
      onFinito();
      await carica();
      setStato(`Fatto: ${fatti} gruppi uniti.`);
    } catch (e) {
      setStato("Errore: " + (e as Error).message + (fatti ? ` (${fatti} gruppi già uniti)` : ""));
      if (fatti) onFinito();
    }
    setInCorso(false);
  };

  const annulla = async (u: Unione) => {
    if (!confirm(`Annullare l'unione in "${nomi.get(u.tieni) ?? u.tieni}"? Gli articoli tolti tornano com'erano.`)) return;
    setInCorso(true);
    const { error } = await supabase.rpc("annulla_unione_materiali", { p_id: u.id });
    setInCorso(false);
    if (error) return setStato("Errore: " + error.message);
    await registra("materiali_unione_annullata", { unione: u.id });
    onFinito();
    await carica();
    setStato("Unione annullata.");
  };

  return (
    <div className="velo" onMouseDown={() => !inCorso && onChiudi()}>
      <div className="finestra finestra-storico-impianti" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Unisci articoli doppi<button type="button" className="chiudi" disabled={inCorso} onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          <p className="piccolo"><b>Raccordi</b>: stesso pezzo anche se di marche diverse (stesso tipo, materiale, misure e maschio/femmina); se il prezzo è più del doppio restano fuori. <b>Altri articoli</b>: solo descrizioni identiche. Con la ★ scegli l'articolo da tenere: gli altri vanno nel Cestino e tutto quello che li usava (rapportini, DDT, preventivi, kit) passa a lui. Giacenze sommate, codici fornitore uniti, si può annullare.</p>
          <p className={stato.startsWith("Errore") ? "errore" : "piccolo"}>{stato}</p>
          {gruppi && gruppi.length > 0 && (
            <>
              <div className="filtri-categoria pillole-sezione">
                {(["", "sicuro", "da controllare"] as const).map((l) => (
                  <button type="button" key={l} className={livello === l ? "attiva" : ""} onClick={() => setLivello(l)}>
                    {l === "" ? "Tutti" : l === "sicuro" ? "Sicuri" : "Da controllare"} <span className="conteggio-categoria">{conteggio(l)}</span></button>
                ))}
              </div>
              <div className="barra-storico">
                <input className="rd-cerca" placeholder="Cerca (es. tee, gomito, 1/2)…" value={cerca} onChange={(e) => setCerca(e.target.value)} />
                <span className="piccolo">Gruppi scelti {daUnire.length} · articoli in meno {quantiTolti}</span>
              </div>
              <div className="ud-elenco">
                {visibili.map((g) => {
                  const on = scelti.has(g.chiave);
                  return (
                    <div key={g.chiave} className={`ud-gruppo${on ? "" : " spenta"}${g.livello === "da controllare" ? " ud-controllare" : ""}`}>
                      <label className="ud-testa">
                        <input type="checkbox" checked={on} onChange={(e) => setScelti((s) => { const n = new Set(s); if (e.target.checked) n.add(g.chiave); else n.delete(g.chiave); return n; })} />
                        <span className={`ud-livello ${g.livello === "sicuro" ? "ok" : "attenzione"}`}>{g.livello === "sicuro" ? "Sicuro" : "Da controllare"}</span>
                        <span className="piccolo">{g.categoria} · {g.motivo}</span>
                      </label>
                      {g.articoli.map((m) => {
                        const t = tieni[g.chiave] === m.id, via = fuori.has(m.id) && !t;
                        return (
                          <div key={m.id} className={`ud-articolo${t ? " tenuto" : ""}${via ? " via" : ""}`}>
                            <button type="button" className="ud-stella" title="Tieni questo" onClick={() => { setTieni((x) => ({ ...x, [g.chiave]: m.id })); setFuori((f) => { const n = new Set(f); n.delete(m.id); return n; }); }}>{t ? "★" : "☆"}</button>
                            <span className="ud-descr">{String(m.descrizione)}<span className="piccolo"> · {String(m.codice_interno ?? "")} · {euro(m.prezzo_base)} · giac. {Number(m.giacenza) || 0} · usato {Number(m.usi) || 0}{m.foto ? " · foto" : ""}</span></span>
                            {!t && g.articoli.length > 2 && (
                              <button type="button" className="ud-togli" title={via ? "Rimetti nel gruppo" : "Lascialo com'è (non unirlo)"} onClick={() => setFuori((f) => { const n = new Set(f); if (via) n.delete(m.id); else n.add(m.id); return n; })}>{via ? "rimetti" : "non unire"}</button>
                            )}
                          </div>
                        );
                      })}
                      {g.esclusi.map((m) => (
                        <div key={m.id} className="ud-articolo via" title="Prezzo troppo diverso: probabilmente è un altro pezzo">
                          <span className="ud-stella">✗</span>
                          <span className="ud-descr">{String(m.descrizione)}<span className="piccolo"> · {euro(m.prezzo_base)} · escluso: prezzo troppo diverso</span></span>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {!visibili.length && <p className="vuoto-linguetta">Nessun gruppo qui.</p>}
              </div>
            </>
          )}
          {unioni.length > 0 && (
            <details className="rd-doppioni"><summary>Ultime unioni ({unioni.length}) — si possono annullare</summary>
              <ul>{unioni.map((u) => (
                <li key={u.id}>{new Date(u.creato_il).toLocaleDateString("it-IT")} · {nomi.get(u.tieni) ?? `articolo ${u.tieni}`} (+{u.togli.length}){" "}
                  <button type="button" className="ud-togli" disabled={inCorso} onClick={() => annulla(u)}>annulla</button></li>
              ))}</ul></details>
          )}
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" disabled={inCorso} onClick={onChiudi}>Chiudi</button>
          <span style={{ flex: 1 }} />
          {gruppi && gruppi.length > 0 && <button type="button" className="btn blu" disabled={inCorso || !daUnire.length} onClick={unisci}>Unisci {daUnire.length} gruppi</button>}
        </div>
      </div>
    </div>
  );
}
