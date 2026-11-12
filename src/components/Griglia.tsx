import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Filter } from "lucide-react";
import { dataIt } from "../supabase";
import { Miniatura } from "./CampoImmagine";
import { useTelefono } from "../telefono";
import { coloreCategoria } from "../categorie";
import { pulisciRicerca } from "../testo";
import { useAuth } from "../auth";
import { senzaPrezzi } from "../prezzi";

// Colori degli stati dei documenti (Aperto arancione, Eseguito verde…)
export const COLORI_STATO: Record<string, string> = {
  "Da assegnare": "#ef8c1a", Assegnata: "#3a7dc0", "In carico": "#8e44ad", Completata: "#22b33a",
  Aperto: "#ef8c1a", Eseguito: "#3fae4b", Accettato: "#3fae4b", Chiuso: "#22b33a", Rifiutato: "#d9342b", Annullato: "#d9342b", Annullata: "#d9342b",
};

export interface Colonna {
  chiave: string;
  titolo: string;
  larghezza: number;
  tipo?: "data" | "booleano" | "euro" | "immagine" | "miniatura" | "numero" | "percentuale" | "stato" | "categoria";
  // Per le miniature: archivio file in cui si trova l'immagine
  archivio?: string;
  // Caselle che si possono spuntare direttamente nella griglia (es. Pagato)
  spuntabile?: boolean;
  // Somma della colonna (righe visibili) nel piede della griglia
  somma?: boolean;
  // Valore mostrato calcolato dalla riga (es. cliente in anagrafica oppure nominativo scritto a mano)
  valore?: (r: Record<string, unknown>) => unknown;
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
  // Caselle "spuntabili" (es. Pagato): clic sulla casella senza aprire la scheda
  onSpunta?: (riga: Riga, chiave: string, valore: boolean) => void;
  // Telefono: azioni mostrate tenendo premuto il dito su una riga
  azioniRiga?: (riga: Riga) => { testo: string; pericolo?: boolean; esegui: () => void }[];
  // Caselle per selezionare più righe anche senza colonne da sommare (es. materiali per le etichette)
  selezionabile?: boolean;
  // Riceve le righe spuntate (visibili), es. per stampare le etichette dei materiali scelti
  onSelezionate?: (righe: Riga[]) => void;
}

const testo = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const euro = (v: unknown) =>
  v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
export const mostra = (c: Colonna, r: Riga): string =>
  c.valore ? testo(c.valore(r))
  : c.tipo === "data" ? dataIt(r[c.chiave]) : c.tipo === "euro" ? euro(r[c.chiave])
  : c.tipo === "percentuale" ? (r[c.chiave] === null || r[c.chiave] === undefined ? "" : `${Number(r[c.chiave]).toLocaleString("it-IT")}%`)
  : c.tipo === "numero" ? (r[c.chiave] === null || r[c.chiave] === undefined ? "" : Number(r[c.chiave]).toLocaleString("it-IT")) : c.tipo === "booleano" ? (r[c.chiave] ? "sì" : "no") : testo(r[c.chiave]);

// Griglia come nel programma originale: intestazioni ordinabili, riga filtri, riga selezionata arancione
export default function Griglia({ colonne: tutteColonne, righe, selezionata, onSeleziona, onApri, onVisibili, ordineIniziale, ricerca = "", colonnaRicerca = "", onSpunta, azioniRiga, selezionabile = false, onSelezionate }: Props) {
  // Senza il permesso "Prezzi" le colonne con importi non compaiono
  const { vedePrezzi } = useAuth();
  const colonne = useMemo(() => senzaPrezzi(tutteColonne, vedePrezzi), [tutteColonne, vedePrezzi]);
  const [ordine, setOrdine] = useState<{ chiave: string; su: boolean }>(ordineIniziale ?? { chiave: colonne[0]?.chiave ?? "id", su: true });
  const [filtri, setFiltri] = useState<Record<string, string>>({});
  // Disegna solo le righe visibili (più un margine), per restare veloce con migliaia di record
  const scorri = useRef<HTMLDivElement>(null);
  const [finestra, setFinestra] = useState({ alto: 0, altezza: 900 });
  const telefono = useTelefono();
  const [quanti, setQuanti] = useState(60);
  // Righe spuntate per sommare solo quelle (solo negli elenchi con un totale). Maiusc+clic seleziona un intervallo.
  const [spuntate, setSpuntate] = useState<Set<number>>(new Set());
  const ultimaSpunta = useRef<number | null>(null);
  // Tocco prolungato sul telefono
  const [menuRiga, setMenuRiga] = useState<Riga | null>(null);
  const pressione = useRef<{ timer: number; x: number; y: number } | null>(null);
  const premutoALungo = useRef(false);
  const fermaPressione = () => {
    if (pressione.current) clearTimeout(pressione.current.timer);
    pressione.current = null;
  };
  const apriMenuRiga = (r: Riga) => {
    fermaPressione();
    premutoALungo.current = true;
    // Quando il dito si alza il browser può generare un tocco sul menu appena comparso: viene ignorato
    const fine = () => {
      window.removeEventListener("pointerup", fine);
      window.removeEventListener("pointercancel", fine);
      setTimeout(() => { premutoALungo.current = false; }, 400);
    };
    window.addEventListener("pointerup", fine);
    window.addEventListener("pointercancel", fine);
    onSeleziona(r.id);
    setMenuRiga(r);
    navigator.vibrate?.(30);
  };
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
  }, [telefono]);

  const visibili = useMemo(() => {
    const attivi = Object.entries(filtri).filter(([, f]) => f.trim());
    const parole = pulisciRicerca(ricerca).split(/\s+/).filter(Boolean);
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
      const t = pulisciRicerca(ricerca);
      return filtrate.sort((a, b) => {
        const va = mostra(c, a).toLowerCase(), vb = mostra(c, b).toLowerCase();
        return Number(!va.startsWith(t)) - Number(!vb.startsWith(t)) || va.localeCompare(vb, "it", { sensitivity: "base", numeric: true });
      });
    }
    const segno = ordine.su ? 1 : -1;
    const colonnaOrdine = colonne.find((c) => c.chiave === ordine.chiave);
    const tipo = colonnaOrdine?.tipo;
    return filtrate.sort((a, b) =>
      tipo === "euro" || tipo === "booleano" || tipo === "numero" || tipo === "percentuale"
        ? segno * (Number(a[ordine.chiave] ?? 0) - Number(b[ordine.chiave] ?? 0))
        : colonnaOrdine?.valore
          ? segno * mostra(colonnaOrdine, a).localeCompare(mostra(colonnaOrdine, b), "it", { sensitivity: "base", numeric: true })
          : segno * testo(a[ordine.chiave]).localeCompare(testo(b[ordine.chiave]), "it", { sensitivity: "base", numeric: true }),
    );
  }, [righe, filtri, ordine, colonne, ricerca, colonnaRicerca]);

  useEffect(() => {
    onVisibili?.(visibili);
    setQuanti(60);
  }, [visibili, onVisibili]);

  const ALTEZZA_RIGA = 21;
  const primo = Math.max(0, Math.floor(finestra.alto / ALTEZZA_RIGA) - 20);
  const ultimo = Math.min(visibili.length, primo + Math.ceil(finestra.altezza / ALTEZZA_RIGA) + 40);

  const ordina = (chiave: string) =>
    setOrdine((o) => ({ chiave, su: o.chiave === chiave ? !o.su : true }));

  // Righe spuntate comunicate alla pagina (prima delle uscite anticipate: gli hook restano sempre nello stesso ordine)
  // Con "selezionabile" le spunte restano anche cambiando ricerca o filtri (si scelgono i materiali uno dopo l'altro)
  const spuntateTutte = (selezionabile ? righe : visibili).filter((r) => spuntate.has(r.id));
  const chiaveSelezione = spuntateTutte.map((r) => r.id).join(",");
  useEffect(() => {
    onSelezionate?.(spuntateTutte);
  }, [chiaveSelezione]); // eslint-disable-line react-hooks/exhaustive-deps

  if (telefono) {
    const nascondi = (c: Colonna) => ["immagine", "miniatura", "booleano", "stato", "euro"].includes(c.tipo ?? "");
    const testuali = colonne.filter((c) => !nascondi(c));
    // Titolo della riga: il nome o la descrizione, altrimenti la colonna più larga tra le prime tre
    const colTitolo = testuali.find((c) => /nome|fornitore|cliente|descrizione|impianto/i.test(c.chiave))
      ?? [...testuali.slice(0, 3)].sort((a, b) => b.larghezza - a.larghezza)[0];
    const altre = testuali.filter((c) => c !== colTitolo && !/mail/i.test(c.chiave));
    const colFoto = colonne.find((c) => c.tipo === "miniatura");
    const colStato = colonne.find((c) => c.tipo === "stato");
    const colImporto = colonne.find((c) => c.chiave === "totale") ?? colonne.find((c) => c.chiave === "prezzo_ricaricato") ?? colonne.find((c) => c.tipo === "euro");
    const spunte = onSpunta ? colonne.filter((c) => c.tipo === "booleano" && c.spuntabile) : [];
    return (
      <div className="elenco-telefono">
        <div className="elenco-telefono-barra">
          <span>{visibili.length} di {righe.length}</span>
          <label>
            Ordina per
            <select value={ordine.chiave} onChange={(e) => setOrdine({ chiave: e.target.value, su: true })}>
              {colonne.filter((c) => c.tipo !== "immagine" && c.tipo !== "miniatura").map((c) => <option key={c.chiave} value={c.chiave}>{c.titolo}</option>)}
            </select>
          </label>
          <button type="button" className="verso" aria-label={ordine.su ? "Ordine crescente: inverti" : "Ordine decrescente: inverti"} onClick={() => setOrdine((o) => ({ ...o, su: !o.su }))}>{ordine.su ? "▲" : "▼"}</button>
        </div>
        <div className="elenco-telefono-righe" onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 400 && quanti < visibili.length) setQuanti((q) => q + 60);
        }}>
          {visibili.slice(0, quanti).map((r) => {
            const dettagli = altre
              .map((c) => ({ c, v: mostra(c, r).trim() }))
              .filter((x) => x.v && x.v !== "/")
              .slice(0, 3);
            return (
              <div key={r.id} className={`riga-telefono${r.id === selezionata ? " attiva" : ""}`}>
                <button type="button" className="riga-telefono-apri"
                  onPointerDown={(e) => {
                    premutoALungo.current = false;
                    fermaPressione();
                    if (azioniRiga) pressione.current = { x: e.clientX, y: e.clientY, timer: window.setTimeout(() => apriMenuRiga(r), 550) };
                  }}
                  onPointerMove={(e) => {
                    // Il dito si sta muovendo: si sta scorrendo l'elenco
                    const p = pressione.current;
                    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) fermaPressione();
                  }}
                  onPointerUp={fermaPressione}
                  onPointerCancel={fermaPressione}
                  onContextMenu={(e) => {
                    // Android segnala il tocco prolungato anche così: niente menu del browser
                    e.preventDefault();
                    if (azioniRiga && !menuRiga) apriMenuRiga(r);
                  }}
                  onClick={() => {
                    if (premutoALungo.current) { premutoALungo.current = false; return; }
                    onSeleziona(r.id);
                    onApri(r);
                  }}>
                  {colFoto && (
                    <span className="riga-telefono-foto">
                      {typeof r[colFoto.chiave] === "string" && r[colFoto.chiave] ? <Miniatura percorso={r[colFoto.chiave] as string} archivio={colFoto.archivio!} /> : <Camera size={22} />}
                    </span>
                  )}
                  <span className="riga-telefono-testi">
                    <span className="riga-telefono-alta">
                      <b>{colTitolo ? mostra(colTitolo, r) || "(senza nome)" : ""}</b>
                      {colImporto && <b className="importo">{mostra(colImporto, r)}</b>}
                    </span>
                    {dettagli.map(({ c, v }) => (
                      <span key={c.chiave} className="riga-telefono-dettaglio">{c.tipo === "categoria" && <span className="pallino-categoria" style={{ background: coloreCategoria(v) }} />}{c.tipo === "numero" || c.tipo === "percentuale" ? `${c.titolo} ${v}` : v}</span>
                    ))}
                    {colStato && r[colStato.chiave] ? (
                      <span className="riga-telefono-dettaglio"><span className="quadratino" style={{ background: COLORI_STATO[testo(r[colStato.chiave])] ?? "#999" }} />{testo(r[colStato.chiave])}</span>
                    ) : null}
                  </span>
                </button>
                {spunte.map((c) => (
                  <label key={c.chiave} className="riga-telefono-spunta">
                    <input type="checkbox" checked={!!r[c.chiave]} onChange={(e) => onSpunta!(r, c.chiave, e.target.checked)} />
                    {c.titolo}
                  </label>
                ))}
              </div>
            );
          })}
          {!visibili.length && <p className="vuoto-linguetta">Nessun elemento trovato.</p>}
        </div>
        {menuRiga && azioniRiga && (
          <div className="velo menu-riga-velo"
            onClickCapture={(e) => { if (premutoALungo.current) { premutoALungo.current = false; e.stopPropagation(); } }}
            onClick={() => setMenuRiga(null)}>
            <div className="menu-riga" role="menu" aria-label={colTitolo ? mostra(colTitolo, menuRiga) : "Azioni"} onClick={(e) => e.stopPropagation()}>
              <div className="menu-riga-titolo">{colTitolo ? mostra(colTitolo, menuRiga) : ""}</div>
              {azioniRiga(menuRiga).map((a) => (
                <button type="button" role="menuitem" key={a.testo} className={a.pericolo ? "pericolo" : ""} onClick={() => { setMenuRiga(null); a.esegui(); }}>{a.testo}</button>
              ))}
              <button type="button" role="menuitem" onClick={() => setMenuRiga(null)}>Annulla</button>
            </div>
          </div>
        )}
        {colonne.some((c) => c.somma) && (
          <div className="griglia-piede">
            {colonne.filter((c) => c.somma).map((c) => (
              <span key={c.chiave} className="somma-colonna">{c.titolo}: <b>{euro(visibili.reduce((t, r) => t + (Number(r[c.chiave]) || 0), 0))}</b></span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const conSomma = colonne.some((c) => c.somma) || selezionabile;
  const larghezzaPrima = conSomma ? 26 : 18;
  const selezionate = !conSomma ? [] : selezionabile ? spuntateTutte : visibili.filter((r) => spuntate.has(r.id));
  const tutteSpuntate = visibili.length > 0 && visibili.every((r) => spuntate.has(r.id));
  const spunta = (r: Riga, valore: boolean, intervallo: boolean) => {
    const qui = visibili.findIndex((x) => x.id === r.id);
    const da = intervallo && ultimaSpunta.current !== null ? visibili.findIndex((x) => x.id === ultimaSpunta.current) : -1;
    const interessate = da >= 0 ? visibili.slice(Math.min(da, qui), Math.max(da, qui) + 1) : [r];
    setSpuntate((s) => {
      const n = new Set(s);
      for (const x of interessate) {
        if (valore) n.add(x.id);
        else n.delete(x.id);
      }
      return n;
    });
    ultimaSpunta.current = r.id;
  };
  const spuntaTutte = (valore: boolean) => setSpuntate((s) => {
    const n = new Set(s);
    for (const x of visibili) {
      if (valore) n.add(x.id);
      else n.delete(x.id);
    }
    return n;
  });

  const larghezze = (
    <colgroup>
      <col style={{ width: larghezzaPrima }} />
      {colonne.map((c) => <col key={c.chiave} style={{ width: c.larghezza }} />)}
    </colgroup>
  );

  return (
    <div className="griglia-dati">
      <div className="griglia-scorri" ref={scorri}>
        <table style={{ width: larghezzaPrima + colonne.reduce((t, c) => t + c.larghezza, 0) }}>
          {larghezze}
          <thead>
            <tr className="intestazioni">
              <th onClick={(e) => e.stopPropagation()}>
                {conSomma && <input type="checkbox" className="spunta" aria-label="Seleziona tutte le righe visibili" title="Seleziona tutte le righe visibili"
                  checked={tutteSpuntate} onChange={(e) => spuntaTutte(e.target.checked)} />}
              </th>
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
                <td className="indicatore-riga">
                  {conSomma ? (
                    <input type="checkbox" className="spunta" aria-label="Seleziona questa riga" checked={spuntate.has(r.id)}
                      onClick={(e) => { e.stopPropagation(); spunta(r, e.currentTarget.checked, e.shiftKey); }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onChange={() => {}} />
                  ) : r.id === selezionata ? "▸" : ""}
                </td>
                {colonne.map((c) => (
                  c.tipo === "miniatura" ? (
                    <td key={c.chiave} className="centrata cella-miniatura">
                      {typeof r[c.chiave] === "string" && r[c.chiave] ? <Miniatura percorso={r[c.chiave] as string} archivio={c.archivio!} /> : null}
                    </td>
                  ) : c.tipo === "immagine" ? (
                    <td key={c.chiave} className="centrata">{r[c.chiave] ? <Camera size={13} color="#8a6d3b" /> : null}</td>
                  ) : c.tipo === "categoria" ? (
                    <td key={c.chiave} title={testo(r[c.chiave])}>
                      {r[c.chiave] ? <><span className="pallino-categoria" style={{ background: coloreCategoria(r[c.chiave]) }} />{testo(r[c.chiave])}</> : null}
                    </td>
                  ) : c.tipo === "stato" ? (
                    <td key={c.chiave} title={testo(r[c.chiave])}>
                      {r[c.chiave] ? <><span className="quadratino" style={{ background: COLORI_STATO[testo(r[c.chiave])] ?? "#999" }} />{testo(r[c.chiave])}</> : null}
                    </td>
                  ) : c.tipo === "booleano" ? (
                    <td key={c.chiave} className="centrata">
                      {c.spuntabile && onSpunta
                        ? <input type="checkbox" className="spunta" checked={!!r[c.chiave]} title="Clicca per cambiare" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
                            onChange={(e) => onSpunta(r, c.chiave, e.target.checked)} />
                        : <input type="checkbox" checked={!!r[c.chiave]} readOnly tabIndex={-1} />}
                    </td>
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
      <div className="griglia-piede">
        {visibili.length} di {righe.length} righe
        {colonne.filter((c) => c.somma).map((c) => (
          <span key={c.chiave} className="somma-colonna">{c.titolo}: <b>{euro(visibili.reduce((t, r) => t + (Number(r[c.chiave]) || 0), 0))}</b></span>
        ))}
        {selezionate.length > 0 && (
          <span className="somma-selezione">
            {selezionate.length === 1 ? "1 riga selezionata" : `${selezionate.length} righe selezionate`}
            {colonne.filter((c) => c.somma).map((c) => (
              <span key={c.chiave}>{c.titolo}: <b>{euro(selezionate.reduce((t, r) => t + (Number(r[c.chiave]) || 0), 0))}</b></span>
            ))}
            <button type="button" onClick={() => setSpuntate(new Set())}>Togli selezione</button>
          </span>
        )}
      </div>
    </div>
  );
}
