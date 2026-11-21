import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QUERY as QUERY_TELEFONO } from "../telefono";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Printer, RefreshCw, X } from "lucide-react";
import { dataIso, supabase } from "../supabase";
import { useAuth } from "../auth";
import { ARCHIVI } from "../archivi";
import Scheda from "../components/Scheda";
import { AZIENDA, DICITURA_RISERVATA, logo } from "../stampe";

// L'Agenda non ha dati propri: mostra a calendario i rapporti di intervento creati dai tecnici
// (colonna del tecnico, data, ora inizio - ora fine). Cliccando un impegno si apre il rapporto.

type Vista = "giorno" | "tecnici" | "lavorativa" | "settimana" | "mese";
const NOMI_VISTA: Record<Vista, string> = {
  giorno: "Giorno",
  tecnici: "Settimana per tecnico",
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
// Orario mostrato: righe dalle 8 alle 18 comprese (fino alle 19), si allarga solo se ci sono interventi prima o dopo
const ORA_DA = 8;
const ORA_A = 19;
// "Gronchi Michael" → "Michael G." (colonne strette della settimana per tecnico)
const nomeBreve = (nome: string) => {
  const p = nome.trim().split(/\s+/);
  return p.length > 1 ? `${p[p.length - 1]} ${p[0][0]}.` : nome;
};
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
  const { puo, profilo } = useAuth();
  const [giorno, setGiorno] = useState(() => new Date());
  // Sul PC la prima volta si apre la settimana per tecnico; poi vale l'ultima vista scelta su questo dispositivo
  // Telefono e PC ricordano ciascuno la propria vista; la prima volta si apre la settimana per tecnico
  // (sul telefono 2 giorni alla volta)
  const telefono = window.matchMedia(QUERY_TELEFONO).matches;
  const chiaveVista = telefono ? "agenda-vista-telefono" : "agenda-vista";
  const [vista, setVista] = useState<Vista>(() => leggi(chiaveVista, "tecnici"));
  const [tecnici, setTecnici] = useState<Tecnico[]>([]);
  // Tecnici nascosti (scelta ricordata su questo dispositivo); di default si vedono tutti
  const [nascosti, setNascosti] = useState<number[]>(() => leggi("agenda-nascosti", []));
  const [impegni, setImpegni] = useState<Impegno[]>([]);
  const [giorniConImpegni, setGiorniConImpegni] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<"" | "vista" | "azioni" | "tecnici">("");
  const [scheda, setScheda] = useState<Record<string, unknown> | null>(null);
  const [messaggio, setMessaggio] = useState("");
  const [pannello, setPannello] = useState(false);

  // Telefono: 2 giorni lavorativi alla volta, a partire dal giorno scelto (sabato e domenica si saltano)
  const lavorativo = (d: Date, verso = 1) => { let x = d; while (x.getDay() === 0 || x.getDay() === 6) x = piuGiorni(x, verso); return x; };
  const [quantiGiorni, setQuantiGiorni] = useState<number>(() => leggi("agenda-giorni-telefono", 2));
  const giorniTelefono = useMemo(() => {
    const primo = lavorativo(giorno);
    return quantiGiorni === 1 ? [primo] : [primo, lavorativo(piuGiorni(primo, 1))];
  }, [giorno, quantiGiorni]); // eslint-disable-line react-hooks/exhaustive-deps
  // Telefono: anteprima del rapportino toccato (si legge tutto senza aprire la scheda)
  const [anteprima, setAnteprima] = useState<Impegno | null>(null);
  const { da, a } = useMemo(() => {
    if (vista === "giorno") return { da: giorno, a: giorno };
    if (vista === "tecnici" && telefono) return { da: giorniTelefono[0], a: giorniTelefono[giorniTelefono.length - 1] };
    if (vista === "lavorativa" || vista === "tecnici") return { da: lunedi(giorno), a: piuGiorni(lunedi(giorno), 4) };
    if (vista === "settimana") return { da: lunedi(giorno), a: piuGiorni(lunedi(giorno), 6) };
    const primo = new Date(giorno.getFullYear(), giorno.getMonth(), 1);
    return { da: lunedi(primo), a: piuGiorni(lunedi(primo), 41) };
  }, [vista, giorno, giorniTelefono]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibili = tecnici.filter((t) => !nascosti.includes(t.id));
  const idVisibili = new Set(visibili.map((t) => t.id));
  const impegniVisibili = impegni.filter((i) => (i.tecnico_id === null ? !nascosti.includes(0) : idVisibili.has(i.tecnico_id)));
  const colore = (id: number | null) => (id === null ? "#7f8c8d" : COLORI[Math.max(0, tecnici.findIndex((t) => t.id === id)) % COLORI.length]);
  const nomeTecnico = (id: number | null) => tecnici.find((t) => t.id === id)?.nome ?? "Senza tecnico";

  useEffect(() => {
    supabase.from("tecnici").select("id, nome").is("eliminato_il", null).order("nome")
      // "Amministrazione" non è un tecnico che esce: in agenda non compare
      .then(({ data }) => setTecnici((data ?? []).filter((t) => !/amministrazione/i.test(String(t.nome)))));
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
    scrivi(chiaveVista, v);
    setMenu("");
  };

  const sposta = (verso: number) => {
    if (vista === "giorno") setGiorno((g) => piuGiorni(g, verso));
    // Telefono, settimana per tecnico: avanti/indietro di 2 giorni lavorativi
    else if (vista === "tecnici" && telefono) setGiorno((g) => {
      let x = lavorativo(g);
      for (let k = 0; k < quantiGiorni; k++) x = lavorativo(piuGiorni(x, verso), verso);
      return x;
    });
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

  // Clic su uno spazio libero: nuovo intervento già compilato con giorno, ora (1 ora) e tecnico della colonna
  const nuovoIntervento = async (giornoIso: string, tecnico: number | null | undefined, inizio: number) => {
    if (!puo("rapporti", "creare")) return;
    const cfg = ARCHIVI.rapporti;
    const proposti = (await cfg.valoriNuovo?.({ utenteId: profilo?.id ?? "", admin: profilo?.ruolo === "admin" })) ?? {};
    const ora = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    setScheda({
      ...proposti,
      data: giornoIso,
      ora_inizio: ora(inizio),
      ora_fine: ora(Math.min(inizio + 60, 23 * 60 + 59)),
      ...(tecnico ? { tecnico_id: tecnico, tecnico: nomeTecnico(tecnico) } : {}),
    });
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
      <div className="solo-stampa intestazione-riservata">
        <img src={logo()} alt="" />
        <div className="titoli"><h1>Agenda</h1><div className="data">{AZIENDA.nome} · stampato il {new Date().toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</div></div>
        <div className="riservato">{DICITURA_RISERVATA}</div>
      </div>
      <div className="solo-stampa piede-riservato">{DICITURA_RISERVATA} – {AZIENDA.nome}</div>
      <div className="testata">
        <h1><span className="icona-titolo"><CalendarDays size={20} strokeWidth={2} /></span>Agenda</h1>
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
                    <span className={t.id ? "nome-tecnico" : ""}>{t.nome}</span>
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
            {telefono && vista === "tecnici" && (
              <button className="giorni-telefono" title="Quanti giorni vedere" onClick={() => {
                const n = quantiGiorni === 2 ? 1 : 2;
                setQuantiGiorni(n);
                scrivi("agenda-giorni-telefono", n);
              }}>{quantiGiorni === 2 ? "1 giorno" : "2 giorni"}</button>
            )}
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
                  : vista === "tecnici"
                  // Settimana per tecnico: per ogni giorno lavorativo una colonna per ciascun tecnico visibile
                  ? (telefono ? giorniTelefono : Array.from({ length: 5 }, (_, i) => piuGiorni(da, i))).flatMap((d) => visibili.map((t, k) => ({
                      chiave: `${iso(d)}-${t.id}`, titolo: nomeBreve(t.nome), sotto: "", giorno: iso(d), tecnico: t.id as number | null,
                      gruppo: d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "short" }), ultimaDelGruppo: k === visibili.length - 1,
                    })))
                  : Array.from({ length: vista === "lavorativa" ? 5 : 7 }, (_, i) => {
                      const d = piuGiorni(da, i);
                      return { chiave: iso(d), titolo: etichettaGiorno(d), sotto: "", giorno: iso(d), tecnico: undefined };
                    })
              }
              impegni={impegniVisibili}
              mostraTecnico={vista !== "giorno" && vista !== "tecnici"}
              colore={colore}
              nomeTecnico={nomeTecnico}
              onApri={telefono && vista === "tecnici" ? (id) => setAnteprima(impegni.find((i) => i.id === id) ?? null) : apri}
              onNuovo={puo("rapporti", "creare") ? nuovoIntervento : undefined}
              strette={vista === "tecnici"}
            />
          )}
        </section>
      </div>

      {anteprima && (
        <div className="velo velo-anteprima" onMouseDown={() => setAnteprima(null)}>
          <div className="anteprima-impegno" onMouseDown={(e) => e.stopPropagation()} style={{ borderTopColor: colore(anteprima.tecnico_id) }}>
            <div className="anteprima-testa">
              <b>{anteprima.cliente?.nome ?? "(senza cliente)"}</b>
              <button type="button" aria-label="Chiudi" onClick={() => setAnteprima(null)}><X size={20} /></button>
            </div>
            <div className="anteprima-dati">
              <span>🕒 {new Date(`${anteprima.data}T12:00:00`).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}
                {anteprima.ora_inizio ? `, ${hhmm(anteprima.ora_inizio)}${anteprima.ora_fine && hhmm(anteprima.ora_fine) !== hhmm(anteprima.ora_inizio) ? ` – ${hhmm(anteprima.ora_fine)}` : ""}` : ""}</span>
              <span style={{ fontWeight: 700 }}>👷 <span className="nome-tecnico">{nomeTecnico(anteprima.tecnico_id)}</span></span>
              {anteprima.numero ? <span>Rapportino n. {anteprima.numero}{anteprima.stato ? ` · ${anteprima.stato}` : ""}</span> : null}
            </div>
            {anteprima.attivita && <p className="anteprima-attivita">{anteprima.attivita}</p>}
            <div className="anteprima-piede">
              <button type="button" className="btn grigio" onClick={() => setAnteprima(null)}>Chiudi</button>
              <button type="button" className="btn blu" onClick={() => { const id = anteprima.id; setAnteprima(null); apri(id); }}>Apri rapportino</button>
            </div>
          </div>
        </div>
      )}
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

// Vista a ore: colonne per tecnico (Giorno), per giorno (Settimana) o per giorno e tecnico (Settimana per tecnico).
// Orario 8–18 (allargato solo se ci sono interventi prima o dopo), altezza delle ore adattata allo schermo.
// Clic su uno spazio libero: nuovo intervento a quell'ora (e per quel tecnico, se la colonna è di un tecnico).
type ColonnaOre = { chiave: string; titolo: string; sotto: string; giorno: string; tecnico: number | null | undefined; gruppo?: string; ultimaDelGruppo?: boolean };
function VistaOre({ colonne, impegni, mostraTecnico, colore, nomeTecnico, onApri, onNuovo, strette = false }: {
  colonne: ColonnaOre[];
  impegni: Impegno[];
  mostraTecnico: boolean;
  colore: (id: number | null) => string;
  nomeTecnico: (id: number | null) => string;
  onApri: (id: number) => void;
  onNuovo?: (giorno: string, tecnico: number | null | undefined, inizioMinuti: number) => void;
  strette?: boolean;
}) {
  const scorri = useRef<HTMLDivElement>(null);
  const giorni = new Set(colonne.map((c) => c.giorno));
  const delPeriodo = impegni.filter((i) => giorni.has(i.data));
  // Orario: 8–18, allargato per gli interventi che iniziano prima o finiscono dopo
  const inizi = delPeriodo.map((i) => minuti(i.ora_inizio)).filter((m): m is number => m !== null);
  const fini = delPeriodo.map((i) => Math.max(minuti(i.ora_fine) ?? 0, (minuti(i.ora_inizio) ?? 0) + 50));
  const oraDa = Math.min(ORA_DA, ...inizi.map((m) => Math.floor(m / 60)));
  const oraA = Math.max(ORA_A, ...fini.map((m) => Math.min(24, Math.ceil(m / 60))));
  const ore = oraA - oraDa;
  // Altezza di un'ora: tutto l'orario sta nello schermo (minimo 40 px per ora)
  const [altezzaOra, setAltezzaOra] = useState(ALTEZZA_ORA);
  useEffect(() => {
    const el = scorri.current;
    if (!el) return;
    const misura = () => setAltezzaOra(Math.max(40, Math.floor(el.clientHeight / ore)));
    misura();
    const ro = new ResizeObserver(misura);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ore]);

  const perColonna = (c: ColonnaOre) =>
    impegni.filter((i) => i.data === c.giorno && (c.tecnico === undefined || i.tecnico_id === c.tecnico));

  // "09:00 – 11:30", oppure solo "12:01" se l'ora di fine non è indicata (uguale all'inizio)
  const orario = (i: Impegno) =>
    !i.ora_inizio ? "" : !i.ora_fine || hhmm(i.ora_fine) === hhmm(i.ora_inizio) ? hhmm(i.ora_inizio) : `${hhmm(i.ora_inizio)} – ${hhmm(i.ora_fine)}`;
  const etichetta = (i: Impegno) => `${orario(i)} ${i.cliente?.nome ?? "(senza cliente)"}`.trim();

  // Gruppi di colonne (es. i tecnici di uno stesso giorno) per l'intestazione su due righe
  const gruppi: { titolo: string; colonne: ColonnaOre[] }[] = [];
  for (const c of colonne) {
    const g = gruppi[gruppi.length - 1];
    if (c.gruppo && g?.titolo === c.gruppo) g.colonne.push(c);
    else gruppi.push({ titolo: c.gruppo ?? "", colonne: [c] });
  }
  const classeColonna = (c: ColonnaOre) => `${strette ? " stretta" : ""}${c.ultimaDelGruppo ? " fine-gruppo" : ""}`;

  const iniziali = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).reverse().join("");
  const intestazione = (c: ColonnaOre) => (
    <div key={c.chiave} className={`intestazione-colonna${classeColonna(c)}`} title={c.tecnico ? nomeTecnico(c.tecnico) : undefined}
      style={strette && c.tecnico ? { borderTop: `3px solid ${colore(c.tecnico)}` } : undefined}>
      {strette && c.tecnico
        ? <div><span className="nome-lungo nome-tecnico">{c.titolo}</span><span className="iniziali nome-tecnico">{iniziali(nomeTecnico(c.tecnico))}</span></div>
        : <div className={c.tecnico ? "nome-tecnico" : undefined}>{c.titolo}</div>}
      {c.sotto && <div className="sotto">{c.sotto}</div>}
      {/* Rapporti senza orario: in cima alla colonna */}
      <div className="senza-orario">
        {perColonna(c).filter((i) => minuti(i.ora_inizio) === null).map((i) => (
          <button key={i.id} className="impegno" style={{ borderLeftColor: colore(i.tecnico_id) }} onClick={() => onApri(i.id)}
            title={`${etichetta(i)}\n${i.attivita ?? ""}`}>
            {mostraTecnico && <><b className="nome-tecnico">{nomeTecnico(i.tecnico_id)}</b>: </>}{etichetta(i)}
          </button>
        ))}
      </div>
    </div>
  );

    const colonnaCorpo = (c: ColonnaOre) => {
          const lista = perColonna(c)
            .filter((i) => minuti(i.ora_inizio) !== null)
            .map((i) => {
              const inizio = minuti(i.ora_inizio)!;
              const fine = Math.max(inizio, minuti(i.ora_fine) ?? inizio);
              // Altezza minima di 50 minuti: orario e cliente restano leggibili anche senza ora di fine
              return { i, inizio, fine: Math.max(fine, inizio + 50) };
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
            <div key={c.chiave} className={`colonna-giorno${classeColonna(c)}${onNuovo ? " si-crea" : ""}`} style={{ height: ore * altezzaOra }}
              title={onNuovo ? `Clicca su uno spazio libero per un nuovo intervento${c.tecnico ? ` di ${nomeTecnico(c.tecnico)}` : ""}` : undefined}
              onClick={(ev) => {
                if (!onNuovo || ev.target !== ev.currentTarget && !(ev.target as HTMLElement).classList.contains("mezzora")) return;
                const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                const m = oraDa * 60 + Math.floor((y / altezzaOra) * 2) * 30; // alla mezz'ora
                onNuovo(c.giorno, c.tecnico, Math.max(0, Math.min(m, 23 * 60 + 30)));
              }}>
              {Array.from({ length: ore * 2 }, (_, k) => <div key={k} className={`mezzora${k % 2 ? " dispari" : ""}`} style={{ height: altezzaOra / 2 }} />)}
              {lista.map((e, k) => (
                <button
                  key={e.i.id}
                  className="impegno posizionato"
                  style={{
                    top: ((e.inizio - oraDa * 60) / 60) * altezzaOra,
                    height: Math.max(strette ? 30 : 38, ((e.fine - e.inizio) / 60) * altezzaOra - 2),
                    left: `${(posizioni[k].corsia / posizioni[k].totale) * 100}%`,
                    width: `calc(${100 / posizioni[k].totale}% - 4px)`,
                    borderLeftColor: colore(e.i.tecnico_id),
                    ...(strette ? { background: `${colore(e.i.tecnico_id)}1f` } : {}),
                  }}
                  title={`${strette ? `${nomeTecnico(e.i.tecnico_id)}\n` : ""}${etichetta(e.i)}\n${e.i.attivita ?? ""}${e.i.stato ? `\nStato: ${e.i.stato}` : ""}`}
                  onClick={() => onApri(e.i.id)}
                >
                  {mostraTecnico && <b className="nome-tecnico">{nomeTecnico(e.i.tecnico_id)}</b>}
                  <span className="orario">{orario(e.i)}</span>
                  <span className="cliente">{e.i.cliente?.nome ?? "(senza cliente)"}</span>
                  {strette && <span className="inizio-breve">{hhmm(e.i.ora_inizio)}</span>}
                  {strette && <span className="cliente-verticale">{e.i.cliente?.nome ?? "(senza cliente)"}</span>}
                  {e.fine - e.inizio >= 90 && e.i.attivita && <span className="attivita">{e.i.attivita}</span>}
                </button>
              ))}
            </div>
          );
        };

  return (
    <div className={`vista-ore${strette ? " vista-strette" : ""}`}>
      <div className="ore-intestazione">
        <div className="colonna-ore" />
        {gruppi.map((g, k) => g.titolo ? (
          <div key={k} className="gruppo-colonne" style={{ flex: `${g.colonne.length} 0 0` }}>
            <div className="titolo-gruppo-colonne">{g.titolo}</div>
            <div className="colonne-gruppo">{g.colonne.map(intestazione)}</div>
          </div>
        ) : g.colonne.map(intestazione))}
      </div>
      <div className="ore-corpo" ref={scorri}>
        <div className="colonna-ore">
          {Array.from({ length: ore }, (_, k) => (
            <div key={k} className="ora" style={{ height: altezzaOra }}>
              <span>{String(oraDa + k).padStart(2, "0")}</span><sup>00</sup>
            </div>
          ))}
        </div>
        {gruppi.map((g, k) => g.titolo ? (
          <div key={k} className="gruppo-colonne corpo" style={{ flex: `${g.colonne.length} 0 0` }}>
            <div className="colonne-gruppo">{g.colonne.map(colonnaCorpo)}</div>
          </div>
        ) : g.colonne.map(colonnaCorpo))}
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
