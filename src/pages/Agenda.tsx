import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Printer, RefreshCw } from "lucide-react";
import { dataIso, supabase } from "../supabase";
import { useAuth } from "../auth";
import { ARCHIVI } from "../archivi";
import Scheda from "../components/Scheda";

// L'Agenda non ha dati propri: mostra a calendario i rapporti di intervento creati dai tecnici
// (colonna del tecnico, data, ora inizio - ora fine). Cliccando un impegno si apre il rapporto.

type Vista = "giorno" | "lavorativa" | "settimana" | "mese";
const NOMI_VISTA: Record<Vista, string> = {
  giorno: "Giorno",
  lavorativa: "Settimana lavorativa",
  settimana: "Settimana",
  mese: "Mese",
};

interface Impegno {
  id: number;
  numero: number | null;
  data: string;
  ora_inizio: string | null;
  ora_fine: string | null;
  tecnico_id: number | null;
  attivita: string | null;
  stato: string | null;
  cliente: { nome: string } | null;
}
interface Tecnico { id: number; nome: string }

const ALTEZZA_ORA = 46;
const COLORI = ["#3a7dc0", "#d9822b", "#3fae4b", "#8e44ad", "#c0392b", "#16a085", "#7f8c8d", "#b7950b"];
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const GIORNI = ["LU", "MA", "ME", "GI", "VE", "SA", "DO"];

const iso = (d: Date) => dataIso(d)!;
const piuGiorni = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const lunedi = (d: Date) => piuGiorni(d, -((d.getDay() + 6) % 7));
const minuti = (t: string | null) => {
  const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (t: string | null) => String(t ?? "").slice(0, 5);
const etichettaGiorno = (d: Date) => d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
const numeroSettimana = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
};

function leggi<T>(chiave: string, predefinito: T): T {
  try {
    const v = localStorage.getItem(chiave);
    return v ? (JSON.parse(v) as T) : predefinito;
  } catch {
    return predefinito;
  }
}
function scrivi(chiave: string, v: unknown) {
  try {
    localStorage.setItem(chiave, JSON.stringify(v));
  } catch {
    /* archiviazione locale non disponibile */
  }
}

export default function Agenda() {
  const naviga = useNavigate();
  const { puo } = useAuth();
  const [giorno, setGiorno] = useState(() => new Date());
  const [vista, setVista] = useState<Vista>(() => leggi("agenda-vista", "giorno"));
  const [tecnici, setTecnici] = useState<Tecnico[]>([]);
  // Tecnici nascosti (scelta ricordata su questo dispositivo); di default si vedono tutti
  const [nascosti, setNascosti] = useState<number[]>(() => leggi("agenda-nascosti", []));
  const [impegni, setImpegni] = useState<Impegno[]>([]);
  const [giorniConImpegni, setGiorniConImpegni] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<"" | "vista" | "azioni" | "tecnici">("");
  const [scheda, setScheda] = useState<Record<string, unknown> | null>(null);
  const [messaggio, setMessaggio] = useState("");
  const [pannello, setPannello] = useState(false);

  const { da, a } = useMemo(() => {
    if (vista === "giorno") return { da: giorno, a: giorno };
    if (vista === "lavorativa") return { da: lunedi(giorno), a: piuGiorni(lunedi(giorno), 4) };
    if (vista === "settimana") return { da: lunedi(giorno), a: piuGiorni(lunedi(giorno), 6) };
    const primo = new Date(giorno.getFullYear(), giorno.getMonth(), 1);
    return { da: lunedi(primo), a: piuGiorni(lunedi(primo), 41) };
  }, [vista, giorno]);

  const visibili = tecnici.filter((t) => !nascosti.includes(t.id));
  const idVisibili = new Set(visibili.map((t) => t.id));
  const impegniVisibili = impegni.filter((i) => (i.tecnico_id === null ? !nascosti.includes(0) : idVisibili.has(i.tecnico_id)));
  const colore = (id: number | null) => (id === null ? "#7f8c8d" : COLORI[Math.max(0, tecnici.findIndex((t) => t.id === id)) % COLORI.length]);
  const nomeTecnico = (id: number | null) => tecnici.find((t) => t.id === id)?.nome ?? "Senza tecnico";

  useEffect(() => {
    supabase.from("tecnici").select("id, nome").is("eliminato_il", null).order("nome")
      .then(({ data }) => setTecnici(data ?? []));
  }, []);

  const carica = useCallback(async () => {
    const { data, error } = await supabase
      .from("rapporti")
      .select("id, numero, data, ora_inizio, ora_fine, tecnico_id, attivita, stato, cliente:clienti(nome)")
      .gte("data", iso(da))
      .lte("data", iso(a))
      .is("eliminato_il", null)
      .order("ora_inizio", { nullsFirst: true })
      .limit(5000);
    if (error) return setMessaggio("Errore: " + error.message);
    setMessaggio("");
    setImpegni((data as unknown as Impegno[]) ?? []);
  }, [da, a]);

  useEffect(() => {
    carica();
  }, [carica]);

  // Giorni con impegni nei tre mesi del calendario a sinistra (in grassetto)
  const meseCalendario = new Date(giorno.getFullYear(), giorno.getMonth(), 1);
  useEffect(() => {
    const inizio = iso(meseCalendario);
    const fine = iso(new Date(meseCalendario.getFullYear(), meseCalendario.getMonth() + 3, 0));
    supabase.from("rapporti").select("data").gte("data", inizio).lte("data", fine).is("eliminato_il", null).limit(5000)
      .then(({ data }) => setGiorniConImpegni(new Set((data ?? []).map((r) => r.data as string))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meseCalendario.getTime()]);

  const cambiaVista = (v: Vista) => {
    setVista(v);
    scrivi("agenda-vista", v);
    setMenu("");
  };

  const sposta = (verso: number) => {
    if (vista === "giorno") setGiorno((g) => piuGiorni(g, verso));
    else if (vista === "mese") setGiorno((g) => new Date(g.getFullYear(), g.getMonth() + verso, 1));
    else setGiorno((g) => piuGiorni(g, 7 * verso));
  };

  // Salta al giorno dell'impegno precedente/successivo (dei tecnici visibili)
  const vaiImpegno = async (verso: 1 | -1) => {
    let q = supabase.from("rapporti").select("data").is("eliminato_il", null);
    q = verso > 0 ? q.gt("data", iso(a)).order("data", { ascending: true }) : q.lt("data", iso(da)).order("data", { ascending: false });
    const ids = visibili.map((t) => t.id);
    if (ids.length && ids.length < tecnici.length) q = q.in("tecnico_id", ids);
    const { data } = await q.limit(1);
    if (data?.length) {
      setGiorno(new Date(`${data[0].data}T12:00:00`));
      if (vista === "mese") cambiaVista("giorno");
    } else setMessaggio(verso > 0 ? "Nessun impegno successivo" : "Nessun impegno precedente");
  };

  const apri = async (id: number) => {
    const cfg = ARCHIVI.rapporti;
    const { data, error } = await supabase.from(cfg.tabella).select(cfg.select ?? "*").eq("id", id).single();
    if (error || !data) return setMessaggio("Errore: " + (error?.message ?? "rapporto non trovato"));
    const r = data as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(r)) if (v && typeof v === "object" && "nome" in v) r[k] = (v as { nome: unknown }).nome;
    setScheda(r);
  };

  const titolo =
    vista === "mese" ? `${MESI[giorno.getMonth()]} ${giorno.getFullYear()}`
    : vista === "giorno" ? etichettaGiorno(giorno)
    : `${da.getDate()} ${MESI[da.getMonth()].slice(0, 3)} – ${a.getDate()} ${MESI[a.getMonth()].slice(0, 3)} ${a.getFullYear()}`;

  const senzaTecnico = impegni.some((i) => i.tecnico_id === null);

  return (
    <div className="pagina-agenda" onClick={() => menu && setMenu("")}>
      <div className="testata">
        <h1>Agenda</h1>
        <div className="pulsanti" onClick={(e) => e.stopPropagation()}>
          <div className="tendina">
            <button className="btn giallo con-punta" onClick={() => setMenu(menu === "vista" ? "" : "vista")}>
              Agenda <span className="punta">⌵</span>
            </button>
            {menu === "vista" && (
              <div className="voci">
                {(Object.keys(NOMI_VISTA) as Vista[]).map((v) => (
                  <button key={v} className={v === vista ? "scelta-attiva" : ""} onClick={() => cambiaVista(v)}>{NOMI_VISTA[v]}</button>
                ))}
              </div>
            )}
          </div>
          {puo("rapporti", "vedere") && <button className="btn giallo" onClick={() => naviga("/s/rapporti")}>Tabella</button>}
          <div className="tendina">
            <button className="btn verde" onClick={() => setMenu(menu === "azioni" ? "" : "azioni")}>Azioni <span className="punta">⌵</span></button>
            {menu === "azioni" && (
              <div className="voci con-icone">
                <button onClick={() => { setMenu(""); carica(); }}><RefreshCw size={20} color="#b59b1b" /><span>Aggiorna</span></button>
                <button onClick={() => { setMenu(""); window.print(); }}><Printer size={20} color="#444" /><span>Stampa</span></button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="agenda">
        <aside className={`agenda-sinistra${pannello ? " aperta" : ""}`}>
          <div className="tendina scegli-tecnici" onClick={(e) => e.stopPropagation()}>
            <button className="campo-tecnici" onClick={() => setMenu(menu === "tecnici" ? "" : "tecnici")}>
              <span>{visibili.length === tecnici.length ? "Tutti i tecnici" : visibili.map((t) => t.nome).join(", ") || "Nessun tecnico"}</span>
              <span>▾</span>
            </button>
            {menu === "tecnici" && (
              <div className="voci elenco-tecnici">
                {[...tecnici, ...(senzaTecnico ? [{ id: 0, nome: "Senza tecnico" }] : [])].map((t) => (
                  <label key={t.id}>
                    <input
                      type="checkbox"
                      checked={!nascosti.includes(t.id)}
                      onChange={(e) => {
                        const n = e.target.checked ? nascosti.filter((x) => x !== t.id) : [...nascosti, t.id];
                        setNascosti(n);
                        scrivi("agenda-nascosti", n);
                      }}
                    />
                    <span className="pallino" style={{ background: t.id ? colore(t.id) : colore(null) }} />
                    {t.nome}
                  </label>
                ))}
              </div>
            )}
          </div>
          {[0, 1, 2].map((k) => (
            <MiniMese
              key={k}
              mese={new Date(meseCalendario.getFullYear(), meseCalendario.getMonth() + k, 1)}
              selezionato={giorno}
              conImpegni={giorniConImpegni}
              frecce={k === 0}
              onMese={(n) => setGiorno((g) => new Date(g.getFullYear(), g.getMonth() + n, 1))}
              onGiorno={(d) => { setGiorno(d); if (vista === "mese") cambiaVista("giorno"); setPannello(false); }}
            />
          ))}
          <button className="oggi" onClick={() => { setGiorno(new Date()); setPannello(false); }}>Oggi</button>
        </aside>

        <section className="agenda-destra">
          <div className="agenda-navigazione">
            <button className="mostra-calendario" onClick={() => setPannello(!pannello)}>Calendario</button>
            <button onClick={() => sposta(-1)} title="Indietro"><ChevronLeft size={18} /></button>
            <button onClick={() => setGiorno(new Date())}>Oggi</button>
            <button onClick={() => sposta(1)} title="Avanti"><ChevronRight size={18} /></button>
            <strong className="titolo-periodo">{titolo}</strong>
            <span style={{ flex: 1 }} />
            <button onClick={() => vaiImpegno(-1)}>◀ Impegno precedente</button>
            <button onClick={() => vaiImpegno(1)}>Impegno successivo ▶</button>
          </div>
          {messaggio && <p className={messaggio.startsWith("Errore") ? "errore" : "piccolo"}>{messaggio}</p>}

          {vista === "mese" ? (
            <VistaMese da={da} mese={giorno.getMonth()} impegni={impegniVisibili} colore={colore} onApri={apri}
              onGiorno={(d) => { setGiorno(d); cambiaVista("giorno"); }} />
          ) : (
            <VistaOre
              colonne={
                vista === "giorno"
                  ? [
                      ...visibili.map((t) => ({ chiave: `t${t.id}`, titolo: t.nome, sotto: etichettaGiorno(giorno), giorno: iso(giorno), tecnico: t.id as number | null })),
                      ...(senzaTecnico && !nascosti.includes(0) ? [{ chiave: "t0", titolo: "Senza tecnico", sotto: etichettaGiorno(giorno), giorno: iso(giorno), tecnico: null }] : []),
                    ]
                  : Array.from({ length: vista === "lavorativa" ? 5 : 7 }, (_, i) => {
                      const d = piuGiorni(da, i);
                      return { chiave: iso(d), titolo: etichettaGiorno(d), sotto: "", giorno: iso(d), tecnico: undefined };
                    })
              }
              impegni={impegniVisibili}
              mostraTecnico={vista !== "giorno"}
              colore={colore}
              nomeTecnico={nomeTecnico}
              onApri={apri}
            />
          )}
        </section>
      </div>

      {scheda && (
        <Scheda
          cfg={ARCHIVI.rapporti}
          valori={scheda}
          cartelle={[]}
          nelCestino={false}
          onChiudi={() => setScheda(null)}
          onSalvato={() => { setScheda(null); carica(); }}
          onElimina={async () => {
            if (!confirm("Spostare il rapporto nel Cestino?")) return;
            const { error } = await supabase.from("rapporti").update({ eliminato_il: new Date().toISOString() }).eq("id", scheda.id);
            if (error) return setMessaggio("Errore: " + error.message);
            setScheda(null);
            carica();
          }}
          onSposta={() => {}}
        />
      )}
    </div>
  );
}

// Calendario mensile piccolo (colonna a sinistra)
function MiniMese({ mese, selezionato, conImpegni, frecce, onMese, onGiorno }: {
  mese: Date;
  selezionato: Date;
  conImpegni: Set<string>;
  frecce: boolean;
  onMese: (n: number) => void;
  onGiorno: (d: Date) => void;
}) {
  const inizio = lunedi(mese);
  const settimane = Math.ceil((((mese.getDay() + 6) % 7) + new Date(mese.getFullYear(), mese.getMonth() + 1, 0).getDate()) / 7);
  const oggi = iso(new Date());
  return (
    <div className="mini-mese">
      <div className="mini-titolo">
        {frecce && <button onClick={() => onMese(-1)}>◂</button>}
        <span>{MESI[mese.getMonth()]}</span>
        {frecce && <button onClick={() => onMese(1)}>▸</button>}
        <span style={{ flex: 1 }} />
        {frecce && <button onClick={() => onMese(-12)}>◂</button>}
        <span>{mese.getFullYear()}</span>
        {frecce && <button onClick={() => onMese(12)}>▸</button>}
      </div>
      <table>
        <thead><tr><th />{GIORNI.map((g) => <th key={g}>{g}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: settimane }, (_, s) => (
            <tr key={s}>
              <td className="num-settimana">{numeroSettimana(piuGiorni(inizio, s * 7))}</td>
              {Array.from({ length: 7 }, (_, g) => {
                const d = piuGiorni(inizio, s * 7 + g);
                const k = iso(d);
                const fuori = d.getMonth() !== mese.getMonth();
                return (
                  <td key={g}>
                    {!fuori && (
                      <button
                        className={[
                          conImpegni.has(k) ? "con-impegni" : "",
                          k === iso(selezionato) ? "selezionato" : "",
                          k === oggi ? "odierno" : "",
                        ].join(" ")}
                        onClick={() => onGiorno(d)}
                      >
                        {d.getDate()}
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Vista a ore: colonne per tecnico (Giorno) o per giorno (Settimana)
function VistaOre({ colonne, impegni, mostraTecnico, colore, nomeTecnico, onApri }: {
  colonne: { chiave: string; titolo: string; sotto: string; giorno: string; tecnico: number | null | undefined }[];
  impegni: Impegno[];
  mostraTecnico: boolean;
  colore: (id: number | null) => string;
  nomeTecnico: (id: number | null) => string;
  onApri: (id: number) => void;
}) {
  const scorri = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // All'apertura si parte dalle 7:00, come nell'originale
    if (scorri.current) scorri.current.scrollTop = 7 * ALTEZZA_ORA;
  }, []);

  const perColonna = (c: (typeof colonne)[number]) =>
    impegni.filter((i) => i.data === c.giorno && (c.tecnico === undefined || i.tecnico_id === c.tecnico));

  const etichetta = (i: Impegno) =>
    `${i.ora_inizio ? `${hhmm(i.ora_inizio)}-${hhmm(i.ora_fine ?? i.ora_inizio)} ` : ""}${i.cliente?.nome ?? "(senza cliente)"}`;

  return (
    <div className="vista-ore">
      <div className="ore-intestazione">
        <div className="colonna-ore" />
        {colonne.map((c) => (
          <div key={c.chiave} className="intestazione-colonna">
            <div>{c.titolo}</div>
            {c.sotto && <div className="sotto">{c.sotto}</div>}
            {/* Rapporti senza orario: in cima alla colonna */}
            <div className="senza-orario">
              {perColonna(c).filter((i) => minuti(i.ora_inizio) === null).map((i) => (
                <button key={i.id} className="impegno" style={{ borderLeftColor: colore(i.tecnico_id) }} onClick={() => onApri(i.id)}
                  title={`${etichetta(i)}\n${i.attivita ?? ""}`}>
                  {mostraTecnico && <b>{nomeTecnico(i.tecnico_id)}: </b>}{etichetta(i)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="ore-corpo" ref={scorri}>
        <div className="colonna-ore">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="ora" style={{ height: ALTEZZA_ORA }}>
              <span>{String(h).padStart(2, "0")}</span><sup>00</sup>
            </div>
          ))}
        </div>
        {colonne.map((c) => {
          const lista = perColonna(c)
            .filter((i) => minuti(i.ora_inizio) !== null)
            .map((i) => {
              const inizio = minuti(i.ora_inizio)!;
              const fine = Math.max(inizio, minuti(i.ora_fine) ?? inizio);
              return { i, inizio, fine: Math.max(fine, inizio + 30) };
            })
            .sort((x, y) => x.inizio - y.inizio);
          // Impegni sovrapposti affiancati: le corsie si calcolano per ogni gruppo di impegni che si sovrappongono
          const posizioni: { corsia: number; totale: number }[] = [];
          let gruppo: number[] = [];
          let corsie: number[] = [];
          let fineGruppo = -1;
          const chiudiGruppo = () => gruppo.forEach((k) => (posizioni[k].totale = corsie.length));
          lista.forEach((e, k) => {
            if (e.inizio >= fineGruppo) {
              chiudiGruppo();
              gruppo = [];
              corsie = [];
            }
            let c = corsie.findIndex((f) => f <= e.inizio);
            if (c < 0) c = corsie.length;
            corsie[c] = e.fine;
            posizioni[k] = { corsia: c, totale: 1 };
            gruppo.push(k);
            fineGruppo = Math.max(fineGruppo, e.fine);
          });
          chiudiGruppo();
          return (
            <div key={c.chiave} className="colonna-giorno" style={{ height: 24 * ALTEZZA_ORA }}>
              {Array.from({ length: 48 }, (_, k) => <div key={k} className={`mezzora${k % 2 ? " dispari" : ""}`} style={{ height: ALTEZZA_ORA / 2 }} />)}
              {lista.map((e, k) => (
                <button
                  key={e.i.id}
                  className="impegno posizionato"
                  style={{
                    top: (e.inizio / 60) * ALTEZZA_ORA,
                    height: Math.max(22, ((e.fine - e.inizio) / 60) * ALTEZZA_ORA - 2),
                    left: `${(posizioni[k].corsia / posizioni[k].totale) * 100}%`,
                    width: `calc(${100 / posizioni[k].totale}% - 4px)`,
                    borderLeftColor: colore(e.i.tecnico_id),
                  }}
                  title={`${etichetta(e.i)}\n${e.i.attivita ?? ""}${e.i.stato ? `\nStato: ${e.i.stato}` : ""}`}
                  onClick={() => onApri(e.i.id)}
                >
                  {mostraTecnico && <b>{nomeTecnico(e.i.tecnico_id)}</b>}
                  <span>{etichetta(e.i)}</span>
                  {e.fine - e.inizio >= 60 && e.i.attivita && <span className="attivita">{e.i.attivita}</span>}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Vista mese: griglia di 6 settimane con l'elenco degli impegni di ogni giorno
function VistaMese({ da, mese, impegni, colore, onApri, onGiorno }: {
  da: Date;
  mese: number;
  impegni: Impegno[];
  colore: (id: number | null) => string;
  onApri: (id: number) => void;
  onGiorno: (d: Date) => void;
}) {
  const oggi = iso(new Date());
  return (
    <div className="vista-mese">
      {GIORNI.map((g) => <div key={g} className="intestazione-mese">{g}</div>)}
      {Array.from({ length: 42 }, (_, k) => {
        const d = piuGiorni(da, k);
        const lista = impegni.filter((i) => i.data === iso(d));
        return (
          <div key={k} className={`giorno-mese${d.getMonth() !== mese ? " fuori" : ""}${iso(d) === oggi ? " oggi" : ""}`}>
            <button className="numero-giorno" onClick={() => onGiorno(d)}>{d.getDate()}</button>
            {lista.slice(0, 4).map((i) => (
              <button key={i.id} className="impegno riga" style={{ borderLeftColor: colore(i.tecnico_id) }} onClick={() => onApri(i.id)}
                title={i.attivita ?? ""}>
                {i.ora_inizio ? `${hhmm(i.ora_inizio)} ` : ""}{i.cliente?.nome ?? "(senza cliente)"}
              </button>
            ))}
            {lista.length > 4 && <button className="altri" onClick={() => onGiorno(d)}>+{lista.length - 4} altri</button>}
          </div>
        );
      })}
    </div>
  );
}
