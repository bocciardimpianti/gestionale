import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { materialiAggiornati, materialiSalvati } from "../cacheElenchi";
import { Miniatura } from "./CampoImmagine";
import { espressione, stessaMarca, type AmbienteFoglio, type CategoriaLavoro, type LavoroPreventivo } from "../impianti";

// Configuratore di un lavoro del preventivo guidato (es. Caldaia): tutte le categorie affiancate
// (caldaie, sdoppiatori, canne fumarie, defangatori…), ognuna con i materiali del catalogo che le corrispondono.
// Scelta la caldaia, le categorie "della stessa marca" mostrano prima gli accessori di quella marca.

type Materiale = Record<string, unknown> & { id: number };
let inMemoria: Materiale[] | null = null;

const euro = (v: number) => v.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const pulisci = (d: unknown) => String(d ?? "");

export function useCatalogo() {
  const [materiali, setMateriali] = useState<Materiale[] | null>(inMemoria);
  const [errore, setErrore] = useState("");
  useEffect(() => {
    let attivo = true;
    (async () => {
      const salvati = await materialiSalvati();
      if (attivo && salvati && !inMemoria) { inMemoria = salvati as Materiale[]; setMateriali(inMemoria); }
      try {
        inMemoria = (await materialiAggiornati()) as Materiale[];
        if (attivo) setMateriali(inMemoria);
      } catch (e) { if (attivo && !inMemoria) setErrore("Errore nel caricamento dei materiali: " + (e as Error).message); }
    })();
    return () => { attivo = false; };
  }, []);
  return { materiali, errore };
}

/** Materiali del catalogo che corrispondono a una categoria */
export function materialiCategoria(materiali: Materiale[], c: Pick<CategoriaLavoro, "cerca" | "escludi">) {
  const si = espressione(c.cerca), no = espressione(c.escludi);
  if (!si) return [];
  return materiali.filter((m) => { const d = pulisci(m.descrizione); return si.test(d) && !(no && no.test(d)); });
}

export default function ConfiguratoreLavoro({ lavoro, ambiente, marca, onAggiungi, onQuantita, onChiudi }: {
  lavoro: LavoroPreventivo;
  ambiente: AmbienteFoglio;
  marca: string | null;
  onAggiungi: (m: Materiale, categoria: CategoriaLavoro) => void;
  onQuantita: (materialeId: number, quantita: number) => void;
  onChiudi: () => void;
}) {
  const { materiali, errore } = useCatalogo();
  const scelti = new Map(ambiente.voci.filter((v) => v.materiale_id).map((v) => [v.materiale_id!, v.quantita]));
  return (
    <div className="configuratore">
      <div className="testa-configuratore">
        <b>{lavoro.icona} {lavoro.nome}</b>
        {marca && <span className="marca-scelta">marca: {marca}</span>}
        <span className="piccolo">Clicca un materiale per aggiungerlo a "{ambiente.nome}"</span>
        <button className="chiudi-configuratore" onClick={onChiudi} title="Chiudi"><X size={18} /></button>
      </div>
      {errore && <p className="errore">{errore}</p>}
      {!materiali && !errore && <p className="piccolo">Caricamento del catalogo…</p>}
      {materiali && (
        <div className="categorie-lavoro">
          {lavoro.categorie.map((c) => <Categoria key={c.id} c={c} materiali={materiali} marca={marca} scelti={scelti} onAggiungi={(m) => onAggiungi(m, c)} onQuantita={onQuantita} />)}
        </div>
      )}
    </div>
  );
}

function Categoria({ c, materiali, marca, scelti, onAggiungi, onQuantita }: {
  c: CategoriaLavoro; materiali: Materiale[]; marca: string | null; scelti: Map<number, number>;
  onAggiungi: (m: Materiale) => void; onQuantita: (id: number, q: number) => void;
}) {
  const [filtro, setFiltro] = useState("");
  const trovati = useMemo(() => materialiCategoria(materiali, c), [materiali, c]);
  // Prima i materiali della stessa marca del principale (es. sdoppiatore della caldaia scelta), poi le altre marche
  const compatibili = useMemo(() => new Set(marca && c.segue_marca ? trovati.filter((m) => stessaMarca(m.descrizione, marca)).map((m) => m.id) : []), [trovati, marca, c.segue_marca]);
  const parole = filtro.toLowerCase().split(/\s+/).filter(Boolean);
  const elenco = trovati
    .filter((m) => parole.every((p) => pulisci(m.descrizione).toLowerCase().includes(p)))
    .sort((a, b) => (scelti.has(b.id) ? 1 : 0) - (scelti.has(a.id) ? 1 : 0) || (compatibili.has(b.id) ? 1 : 0) - (compatibili.has(a.id) ? 1 : 0)
      || Number(a.prezzo_ricaricato ?? 0) - Number(b.prezzo_ricaricato ?? 0));
  const primoAltro = compatibili.size ? elenco.findIndex((m) => !compatibili.has(m.id) && !scelti.has(m.id)) : -1;
  const quanti = [...scelti.keys()].filter((id) => trovati.some((m) => m.id === id)).length;
  return (
    <section className={`categoria-lavoro${c.principale ? " principale" : ""}${quanti ? " con-scelte" : ""}`}>
      <div className="testa-categoria">
        <b>{c.nome}</b>
        {quanti > 0 && <span className="conta-scelte">{quanti}</span>}
        <span className="piccolo">{trovati.length}</span>
      </div>
      {marca && c.segue_marca && (
        <span className={`filtro-marca${compatibili.size ? "" : " nessuno"}`}>{compatibili.size ? `${compatibili.size} ${marca} in cima` : `Nessun articolo ${marca}`}</span>
      )}
      {trovati.length > 8 && <input className="filtro-categoria" placeholder="Filtra…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />}
      <div className="elenco-categoria">
        {!elenco.length && <p className="piccolo">Nessun materiale trovato nel catalogo.</p>}
        {elenco.map((m, i) => {
          const q = scelti.get(m.id);
          return (
            <div key={m.id} className={`articolo-lavoro${q ? " scelto" : ""}${compatibili.has(m.id) ? " stessa-marca" : ""}${i === primoAltro && i > 0 ? " altre-marche" : ""}`} onClick={() => !q && onAggiungi(m)} title={pulisci(m.descrizione)}>
              <span className="foto-articolo">{typeof m.foto === "string" && m.foto ? <Miniatura percorso={m.foto} archivio="materiali" /> : null}</span>
              <span className="descr-articolo">{pulisci(m.descrizione)}</span>
              <span className="prezzo-articolo">{euro(Number(m.prezzo_ricaricato ?? 0))}</span>
              {q ? (
                <span className="contatore-voce" onClick={(e) => e.stopPropagation()}>
                  <button aria-label="Meno" onClick={() => onQuantita(m.id, q - 1)}><Minus size={13} /></button>
                  <input inputMode="decimal" value={String(q).replace(".", ",")} aria-label="Quantità" onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); if (!Number.isNaN(n) && n >= 0) onQuantita(m.id, n); }} />
                  <button aria-label="Più" onClick={() => onQuantita(m.id, q + 1)}><Plus size={13} /></button>
                </span>
              ) : <span className="aggiungi-articolo"><Plus size={16} /></span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
