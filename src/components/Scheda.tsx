import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Barcode, Mail, PencilLine, CircleMinus, CirclePlus, CreditCard, Maximize2, Minimize2, Minus, Phone, X } from "lucide-react";
import { euro } from "./Griglia";
import { dataIso, dataIt, leggiTutto, registra, supabase, vuoto } from "../supabase";
import { useAuth } from "../auth";
import type { Archivio, Campo } from "../archivi";
import type { Cartella } from "../pages/PaginaArchivio";
import GestioneElenco from "./GestioneElenco";
import CampoImmagine, { urlFirmato } from "./CampoImmagine";
import CercaMateriale from "./CercaMateriale";
import Autocompleta from "./Autocompleta";

interface Props {
  cfg: Archivio;
  valori: Record<string, unknown>;
  onChiudi: () => void;
  onSalvato: (id: number) => void;
  onElimina: () => void;
  cartelle: Cartella[];
  nelCestino: boolean;
  onSposta: (archivio: Cartella | null) => void;
  // Ripristino dal Cestino (scheda aperta dal Cestino)
  onRipristina?: () => void;
}

// Finestra di dettaglio come nel programma originale: linguette, campi incorniciati, piede con Salva/Azioni/Chiudi
export default function Scheda({ cfg, valori, onChiudi, onSalvato, onElimina, cartelle, nelCestino, onSposta, onRipristina }: Props) {
  const { puo, profilo } = useAuth();
  const nuovo = valori.id === undefined;
  const modificabile = !nelCestino && (nuovo ? puo(cfg.sezione, "creare") : puo(cfg.sezione, "modificare"));
  const [gestione, setGestione] = useState<Campo | null>(null);
  const [versioneOpzioni, setVersioneOpzioni] = useState(0);
  const [dati, setDati] = useState<Record<string, unknown>>(valori);
  const [opzioni, setOpzioni] = useState<Record<string, { valore: string; etichetta: string; riga?: Record<string, unknown> }[]>>({});
  const [linguetta, setLinguetta] = useState("Principale");
  const [stato, setStato] = useState("Pronto");
  const [ingrandita, setIngrandita] = useState(false);
  const [ridotta, setRidotta] = useState(false);
  const [menuAzioni, setMenuAzioni] = useState(false);
  // Campi collegati (es. Cliente): testo digitato ed elenco dei nomi disponibili
  const [testoRif, setTestoRif] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = {};
    for (const col of cfg.colonne) if (col.riferimento) t[col.riferimento.campo] = String(valori[col.chiave] ?? "");
    return t;
  });
  const [elenchiRif, setElenchiRif] = useState<Record<string, { id: number; nome: string }[]>>({});
  // Un nuovo record può arrivare con righe già compilate (es. DDT letto da PDF da correggere a mano)
  const [righe, setRighe] = useState<Record<string, unknown>[]>(() => (Array.isArray(valori._righe) ? valori._righe as Record<string, unknown>[] : []));
  const [rigaSel, setRigaSel] = useState<number | null>(null);
  const [codice, setCodice] = useState("");
  const [cercaMateriale, setCercaMateriale] = useState(false);
  const [suggerimenti, setSuggerimenti] = useState<Record<string, Record<string, unknown>[]>>({});
  const tuttiCampi = [...cfg.campi, ...(cfg.piede ?? []), ...(cfg.piedeGruppi ?? []).flatMap((g) => g.campi)];

  useEffect(() => {
    if (!cfg.righe || nuovo) return;
    supabase.from(cfg.righe.tabella).select("*").eq(cfg.righe.campo, valori.id).order("ordine")
      .then(({ data }) => setRighe(data ?? []));
  }, [cfg.righe, nuovo, valori.id]);

  // Suggerimenti da record collegati (es. impianti del cliente scelto)
  const filtriSuggerimenti = cfg.campi.filter((c) => c.suggerisciDa).map((c) => dati[c.suggerisciDa!.filtro.campo]).join("|");
  useEffect(() => {
    for (const c of cfg.campi.filter((c) => c.suggerisciDa)) {
      const { tabella, filtro } = c.suggerisciDa!;
      const valoreFiltro = dati[filtro.campo];
      if (vuoto(valoreFiltro)) {
        setSuggerimenti((s) => ({ ...s, [c.chiave]: [] }));
        continue;
      }
      supabase.from(tabella).select("*").eq(filtro.colonna, valoreFiltro).is("eliminato_il", null)
        .then(({ data }) => setSuggerimenti((s) => ({ ...s, [c.chiave]: data ?? [] })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.campi, filtriSuggerimenti]);

  const totali = cfg.calcolaTotali?.(dati, righe) ?? {};

  const cambiaRiga = (i: number, chiave: string, valore: unknown) =>
    setRighe((rr) => rr.map((r, j) => (j === i ? cfg.righe!.ricalcola({ ...r, [chiave]: valore }, chiave) : r)));
  const aggiungiRiga = (extra: Record<string, unknown> = {}) => {
    setRighe((rr) => [...rr, cfg.righe!.ricalcola({ quantita: 1, ...extra })]);
    setRigaSel(righe.length);
  };
  // Riga compilata da un materiale di magazzino
  const rigaDaMateriale = (m: Record<string, unknown>) => cfg.righe?.daMateriale?.(m) ?? ({
    materiale_id: m.id,
    codice_barre: m.codice_barre ?? null,
    descrizione: m.descrizione ?? null,
    codice_articolo: m.codice_interno ?? null,
    unita_misura: m.unita_misura ?? null,
    prezzo: m.prezzo_base ?? 0,
    ricarico: m.ricarico ?? 0,
    nome_articolo: m.nome_articolo ?? null,
  });

  const leggiCodice = async (c: string) => {
    let { data } = await supabase.from("materiali").select("*").eq("codice_barre", c).is("eliminato_il", null).limit(1);
    if (!data?.length) ({ data } = await supabase.from("materiali").select("*").eq("codice_interno", c).is("eliminato_il", null).limit(1));
    if (data?.length) {
      aggiungiRiga(rigaDaMateriale(data[0]));
      setStato(`Aggiunto: ${data[0].descrizione}`);
    } else {
      aggiungiRiga({ codice_barre: c });
      setStato(`Codice ${c} non trovato tra i materiali: compila la riga a mano`);
    }
  };

  const spostaRiga = (verso: number) => {
    if (rigaSel === null) return;
    const j = rigaSel + verso;
    if (j < 0 || j >= righe.length) return;
    setRighe((rr) => {
      const n = [...rr];
      [n[rigaSel], n[j]] = [n[j], n[rigaSel]];
      return n;
    });
    setRigaSel(j);
  };

  useEffect(() => {
    for (const c of cfg.campi.filter((c) => c.tipo === "riferimento" || c.suggerimentiDa)) {
      // Nei menu di scelta solo i record attivi (es. non i tecnici eliminati)
      leggiTutto(c.riferimentoA ?? c.suggerimentiDa!, "id, nome", true).then((r) =>
        setElenchiRif((e) => ({ ...e, [c.chiave]: r as unknown as { id: number; nome: string }[] })),
      );
    }
  }, [cfg.campi]);

  const cambia = (chiave: string, valore: unknown) =>
    setDati((d) => {
      const nuovi = { ...d, [chiave]: valore };
      return { ...nuovi, ...(cfg.quandoCambia?.(nuovi, chiave) ?? {}) };
    });

  const cambiaRiferimento = (c: Campo, testo: string) => {
    setTestoRif((t) => ({ ...t, [c.chiave]: testo }));
    const trovato = (elenchiRif[c.chiave] ?? []).find((r) => r.nome.trim().toLowerCase() === testo.trim().toLowerCase());
    cambia(c.chiave, trovato?.id ?? null);
  };

  useEffect(() => {
    for (const c of tuttiCampi.filter((c) => c.opzioniFisse)) {
      setOpzioni((o) => ({ ...o, [c.chiave]: c.opzioniFisse!.map((v) => ({ valore: v, etichetta: v })) }));
    }
    for (const c of tuttiCampi.filter((c) => c.opzioniDa)) {
      supabase.from(c.opzioniDa!).select("*").order("ordine").then(({ data }) =>
        setOpzioni((o) => ({ ...o, [c.chiave]: (data ?? []).map((r) => ({ valore: r.nome, etichetta: r.nome, riga: r })) })),
      );
    }
    for (const c of cfg.campi.filter((c) => c.opzioniRpc)) {
      supabase.rpc(c.opzioniRpc!).then(({ data }) =>
        setOpzioni((o) => ({ ...o, [c.chiave]: ((data ?? []) as { id: string; nome: string }[]).map((r) => ({ valore: r.id, etichetta: r.nome })) })),
      );
    }
  }, [cfg.campi, versioneOpzioni]);

  const salva = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!modificabile) return;
    const record: Record<string, unknown> = {};
    for (const c of tuttiCampi.filter((c) => c.tipo !== "titolo" && !(c.solaLettura && c.chiave in totali))) {
      const v = dati[c.chiave];
      if (c.solaLettura && nuovo && vuoto(v)) continue;
      if ((c.tipo === "foto" || c.tipo === "firma" || c.tipo === "pdf") && v instanceof Blob) continue;
      record[c.chiave] =
        c.tipo === "booleano" ? !!v
        : c.tipo === "numero" || c.tipo === "euro" ? (vuoto(v) ? null : Number(v))
        : c.tipo === "data" ? dataIso(v)
        : vuoto(v) ? null : String(v).trim();
    }
    for (const c of cfg.campi.filter((c) => c.suggerisciDa)) record[c.suggerisciDa!.salvaId] = dati[c.suggerisciDa!.salvaId] ?? null;
    for (const [k, v] of Object.entries(totali)) if (!k.startsWith("_")) record[k] = v;
    if (nuovo && valori.archivio_id) record.archivio_id = valori.archivio_id;
    const rifNonValido = cfg.campi.find((c) => c.tipo === "riferimento" && !vuoto(testoRif[c.chiave]) && vuoto(dati[c.chiave]));
    if (rifNonValido) return setStato(`"${testoRif[rifNonValido.chiave]}" non è presente in ${rifNonValido.riferimentoA}: sceglilo dall'elenco`);
    const obbligatorio = cfg.campi.find((c) => c.obbligatorio && vuoto(record[c.chiave]));
    if (obbligatorio) return setStato(`Compilare il campo "${obbligatorio.etichetta}"`);
    setStato("Salvataggio…");
    const risposta = nuovo
      ? await supabase.from(cfg.tabella).insert(record).select("id").single()
      : await supabase.from(cfg.tabella).update(record).eq("id", valori.id).select("id").single();
    if (risposta.error) return setStato("Errore: " + risposta.error.message);
    if (cfg.righe) {
      const { tabella, campo, colonne } = cfg.righe;
      const del = await supabase.from(tabella).delete().eq(campo, risposta.data.id);
      if (del.error) return setStato("Errore: " + del.error.message);
      const daSalvare = righe
        .filter((r) => colonne.some((c) => !vuoto(r[c.chiave])))
        .map((r, i) => {
          const o: Record<string, unknown> = { [campo]: risposta.data.id, ordine: i };
          for (const k of Object.keys(r)) if (!["id", campo, "ordine"].includes(k)) o[k] = vuoto(r[k]) ? null : r[k];
          return o;
        });
      if (daSalvare.length) {
        const ins = await supabase.from(tabella).insert(daSalvare);
        if (ins.error) return setStato("Errore: " + ins.error.message);
      }
    }
    // Foto e firma: caricamento dei nuovi file e rimozione di quelli sostituiti o eliminati
    const id = risposta.data.id;
    const immagini = tuttiCampi.filter((c) => c.tipo === "foto" || c.tipo === "firma" || c.tipo === "pdf");
    const daAggiornare: Record<string, string> = {};
    for (const c of immagini) {
      const v = dati[c.chiave];
      if (!(v instanceof Blob)) continue;
      setStato(`Caricamento ${c.etichetta.toLowerCase()}…`);
      const percorso = `${id}/${c.chiave}-${Date.now()}.${v.type === "application/pdf" ? "pdf" : v.type === "image/png" ? "png" : "jpg"}`;
      const up = await supabase.storage.from(cfg.sezione).upload(percorso, v, { contentType: v.type || "image/jpeg" });
      if (up.error) return setStato("Errore nel caricamento: " + up.error.message);
      daAggiornare[c.chiave] = percorso;
    }
    if (Object.keys(daAggiornare).length) {
      const agg = await supabase.from(cfg.tabella).update(daAggiornare).eq("id", id);
      if (agg.error) return setStato("Errore: " + agg.error.message);
    }
    const vecchi = immagini
      .map((c) => valori[c.chiave])
      .filter((p): p is string => typeof p === "string" && !!p && !immagini.some((c) => dati[c.chiave] === p));
    if (vecchi.length) await supabase.storage.from(cfg.sezione).remove(vecchi);

    await registra(`${cfg.sezione}_${nuovo ? "creato" : "modificato"}`, { id: risposta.data.id, nome: dati[cfg.colonne[0].chiave] ?? testoRif[cfg.campi.find((c) => c.tipo === "riferimento")?.chiave ?? ""] ?? null });
    onSalvato(risposta.data.id);
  };

  const campo = (c: Campo, aCapo: boolean) => {
    if (c.tipo === "titolo") return <div key={c.chiave} className={`sezione-scheda ${c.stile ?? "grigio"}`}>{c.etichetta}</div>;
    if (c.tipo === "pdf")
      return (
        <div key={c.chiave} className="campo-pdf" style={{ gridColumn: `${aCapo ? "1 / " : ""}span ${(c.larghezza ?? 2) * 2}` }}>
          <span className="etichetta">{c.etichetta}</span>
          {dati[c.chiave] instanceof Blob
            ? <span className="piccolo">Il PDF letto verrà archiviato al salvataggio</span>
            : typeof dati[c.chiave] === "string" && dati[c.chiave]
            ? <button type="button" className="btn grigio" onClick={async () => {
                const finestra = window.open("", "_blank");
                const url = await urlFirmato(cfg.sezione, String(dati[c.chiave]));
                if (finestra) finestra.location.href = url;
              }}>Apri {String(dati[c.chiave]).split("/").pop()}</button>
            : <span className="piccolo">Nessun PDF (il DDT non è stato caricato da PDF)</span>}
        </div>
      );
    if (c.tipo === "foto" || c.tipo === "firma")
      return (
        <div key={c.chiave} style={{ gridColumn: `${aCapo ? "1 / " : ""}span ${(c.larghezza ?? 2) * 2}` }}>
          <CampoImmagine archivio={cfg.sezione} cerca={c.cercaFoto?.(dati)} etichetta={c.etichetta} valore={dati[c.chiave]} firma={c.tipo === "firma"} modificabile={modificabile}
            onCambia={(v) => cambia(c.chiave, v)} />
        </div>
      );
    const valore = String((c.chiave in totali ? totali[c.chiave] : dati[c.chiave]) ?? "");
    const props = {
      id: `campo-${c.chiave}`,
      value: valore,
      readOnly: !modificabile || c.solaLettura,
      placeholder: c.segnaposto,
      onChange: (e: { target: { value: string } }) => cambia(c.chiave, e.target.value),
    };
    let controllo;
    if (c.tipo === "area") controllo = <textarea rows={2} {...props} />;
    else if (c.tipo === "data") controllo = <input type="date" {...props} value={dataIso(valore) ?? ""} />;
    else if (c.tipo === "ora") controllo = <input type="time" {...props} value={valore.slice(0, 5)} />;
    else if (c.tipo === "numero" || c.tipo === "euro")
      controllo = c.solaLettura
        ? <input {...props} className="destra" value={c.tipo === "euro" ? euro(valore) : vuoto(valore) ? "" : Number(valore).toLocaleString("it-IT", { minimumFractionDigits: 2 })} />
        : <input type="number" step="0.01" {...props} className="destra"
            value={c.tipo === "euro" && !vuoto(valore) ? String(Math.round(Number(valore) * 100) / 100) : valore} />;
    else if (c.tipo === "booleano")
      controllo = (
        <input type="checkbox" id={props.id} className="casella" checked={!!dati[c.chiave]} disabled={!modificabile}
          onChange={(e) => cambia(c.chiave, e.target.checked)} />
      );
    else if (c.suggerimentiDa)
      controllo = (
        <>
          <Autocompleta id={props.id} valore={valore} readOnly={props.readOnly}
            opzioni={(elenchiRif[c.chiave] ?? []).map((r) => r.nome)} onCambia={(t) => cambia(c.chiave, t)} />
        </>
      );
    else if (c.suggerisciDa)
      controllo = (
        <span className="scelta">
          <input {...props} />
          {modificabile && (
            <select value="" title="Scegli tra gli impianti del cliente" className="solo-freccia" onChange={(e) => {
              const r = (suggerimenti[c.chiave] ?? [])[Number(e.target.value)];
              if (!r) return;
              setDati((d) => {
                const n = { ...d, [c.suggerisciDa!.salvaId]: r.id };
                for (const k of c.suggerisciDa!.copia) n[k] = r[k] ?? null;
                return n;
              });
            }}>
              <option value="" />
              {(suggerimenti[c.chiave] ?? []).map((r, i) => <option key={i} value={i}>{c.suggerisciDa!.etichetta(r)}</option>)}
            </select>
          )}
        </span>
      );
    else if (c.tipo === "riferimento")
      controllo = (
        <>
          <Autocompleta
            id={props.id}
            valore={testoRif[c.chiave] ?? ""}
            readOnly={props.readOnly}
            nonTrovato={!vuoto(testoRif[c.chiave]) && vuoto(dati[c.chiave])}
            placeholder={modificabile ? "Scrivi le prime lettere…" : ""}
            opzioni={(elenchiRif[c.chiave] ?? []).map((r) => r.nome)}
            onCambia={(t) => cambiaRiferimento(c, t)}
          />
        </>
      );
    else if (c.tipo === "scelta")
      controllo = (
        <span className="scelta">
          <select {...props} disabled={!modificabile} onChange={(e) => {
            const scelta = (opzioni[c.chiave] ?? []).find((o) => o.valore === e.target.value);
            if (c.copiaDaOpzione && scelta?.riga) {
              setDati((d) => {
                const n: Record<string, unknown> = { ...d, [c.chiave]: e.target.value };
                for (const k of c.copiaDaOpzione!) n[k] = scelta.riga![k] ?? null;
                return n;
              });
            } else cambia(c.chiave, e.target.value);
          }}>
            <option value="" />
            {(opzioni[c.chiave] ?? []).map((o) => <option key={o.valore} value={o.valore}>{o.etichetta}</option>)}
          </select>
          {profilo?.ruolo === "admin" && c.titoloOpzioni && (
            <button type="button" title={`Gestisci ${c.titoloOpzioni}`} onClick={() => setGestione(c)}>…</button>
          )}
        </span>
      );
    else controllo = <input {...props} />;

    return (
      <div key={c.chiave} className={`cornice${c.finisciRiga ? " fine-riga" : ""}`}
        style={{ gridColumn: c.larghezza === 4 ? "1 / -1" : `${aCapo ? "1 / " : ""}span ${(c.larghezza ?? 2) * 2}` }}>
        <label htmlFor={props.id}>{c.etichetta}</label>
        {controllo}
        {c.tipo === "email" && (
          <a className="chiama" href={valore ? `mailto:${valore}` : undefined} title="Scrivi e-mail"><Mail size={14} strokeWidth={2} /></a>
        )}
        {c.colori && valore && <span className="quadratino" style={{ background: c.colori[valore] ?? "#999" }} />}
        {c.tipo === "telefono" && (
          <a className="chiama" href={valore ? `tel:${valore.replace(/\s/g, "")}` : undefined} title="Chiama">
            <Phone size={13} strokeWidth={2} />
          </a>
        )}
      </div>
    );
  };

  const principali = cfg.campi.filter((c) => !c.linguetta);

  const righeMateriali = () => {
    const rc = cfg.righe!;
    return (
      <div className="area-righe">
        {modificabile && (
          <div className="barra-righe">
            <button type="button" title="Aggiungi materiali (o riga libera)" onClick={() => setCercaMateriale(true)}><CirclePlus size={30} strokeWidth={1.4} /></button>
            <button type="button" title="Elimina riga" disabled={rigaSel === null} onClick={() => {
              setRighe((rr) => rr.filter((_, j) => j !== rigaSel));
              setRigaSel(null);
            }}><CircleMinus size={30} strokeWidth={1.4} /></button>
            <button type="button" title="Sposta giù" onClick={() => spostaRiga(1)}><ArrowDown size={22} strokeWidth={2} className="cerchiata" /></button>
            <button type="button" title="Sposta su" onClick={() => spostaRiga(-1)}><ArrowUp size={22} strokeWidth={2} className="cerchiata" /></button>
            <button type="button" title="Aggiungi una riga libera da compilare a mano" onClick={() => aggiungiRiga()}><PencilLine size={22} strokeWidth={2} className="cerchiata" /></button>
          </div>
        )}
        <div className="tabella-righe">
          <table>
            <thead>
              <tr><th style={{ width: 16 }} />{rc.colonne.map((c) => <th key={c.chiave} style={{ width: c.larghezza }}>{c.titolo}</th>)}</tr>
            </thead>
            <tbody>
              {righe.map((r, i) => (
                <tr key={i} className={i === rigaSel ? "attiva" : ""} onClick={() => setRigaSel(i)}>
                  <td className="indicatore-riga">{i === rigaSel ? "▸" : ""}</td>
                  {rc.colonne.map((c) => (
                    <td key={c.chiave} className={c.tipo && c.tipo !== "testo" ? "destra" : ""}>
                      {c.solaLettura || !modificabile ? (
                        c.tipo === "euro" ? euro(r[c.chiave]) : String(r[c.chiave] ?? "")
                      ) : (
                        <input
                          type={c.tipo && c.tipo !== "testo" ? "number" : "text"}
                          step="0.01"
                          value={c.tipo === "euro" && r[c.chiave] != null && r[c.chiave] !== "" ? String(Math.round(Number(r[c.chiave]) * 100) / 100) : String(r[c.chiave] ?? "")}
                          onChange={(e) => cambiaRiga(i, c.chiave, c.tipo && c.tipo !== "testo" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {modificabile && (
          <div className="riga-codice">
            <input
              value={codice}
              placeholder="Codice a barre"
              onChange={(e) => setCodice(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (codice.trim()) leggiCodice(codice.trim());
                  setCodice("");
                }
              }}
            />
            <Barcode size={22} />
          </div>
        )}
        {cfg.piedeGruppi && (
          <div className="piede-gruppi">
            {cfg.piedeGruppi.map((g) => (
              <div key={g.titolo} className="gruppo-piede">
                <div className="titolo-gruppo">{g.titolo}</div>
                {g.campi.map((c) => (
                  <label key={c.chiave} className="voce-piede valore">
                    <span>{c.etichetta}</span>
                    {c.tipo === "booleano" ? (
                      <input type="checkbox" checked={!!dati[c.chiave]} disabled={!modificabile} onChange={(e) => cambia(c.chiave, e.target.checked)} />
                    ) : c.solaLettura ? (
                      <b>{euro(c.chiave in totali ? totali[c.chiave] : dati[c.chiave] ?? 0)}</b>
                    ) : c.tipo === "scelta" ? (
                      <select value={String(dati[c.chiave] ?? "")} disabled={!modificabile} onChange={(e) => cambia(c.chiave, e.target.value)}>
                        <option value="" />
                        {(opzioni[c.chiave] ?? []).map((o) => <option key={o.valore} value={o.valore}>{o.etichetta}</option>)}
                      </select>
                    ) : (
                      <input type="number" step="0.01" className="destra" value={String(dati[c.chiave] ?? "")} readOnly={!modificabile}
                        placeholder={c.segnaposto} onChange={(e) => cambia(c.chiave, e.target.value)} />
                    )}
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
        {cfg.piede && (
          <div className="piede-totali">
            {cfg.piede.map((c) => (
              <label key={c.chiave} className={`voce-piede${c.tipo === "booleano" ? "" : " valore"}`}>
                <span>{c.etichetta}</span>
                {c.tipo === "booleano" ? (
                  <input type="checkbox" checked={!!dati[c.chiave]} disabled={!modificabile} onChange={(e) => cambia(c.chiave, e.target.checked)} />
                ) : c.solaLettura ? (
                  <b>{euro(c.chiave in totali ? totali[c.chiave] : dati[c.chiave] ?? 0)}</b>
                ) : (
                  <input type="number" step="0.01" className="destra" value={String(dati[c.chiave] ?? "")} readOnly={!modificabile}
                    onChange={(e) => cambia(c.chiave, e.target.value)} />
                )}
              </label>
            ))}
          </div>
        )}
      </div>
    );
  };

  const stampa = async () => {
    const finestra = window.open("", "_blank");
    if (!finestra) return setStato("Errore: il browser ha bloccato la finestra di stampa");
    // Dati dei record collegati (es. P.IVA ed e-mail del cliente) come "cliente_piva", "cliente_email"
    const collegati: Record<string, unknown> = {};
    for (const col of cfg.colonne.filter((c) => c.riferimento)) {
      const id = dati[col.riferimento!.campo];
      if (vuoto(id)) continue;
      const { data } = await supabase.from(col.riferimento!.tabella).select("*").eq("id", id).single();
      for (const [k, v] of Object.entries(data ?? {})) collegati[`${col.chiave}_${k}`] = v;
    }
    const firma = dati.firma;
    if (firma instanceof Blob) collegati._firma_url = URL.createObjectURL(firma);
    else if (typeof firma === "string" && firma) {
      collegati._firma_url = await urlFirmato(cfg.sezione, firma);
    }
    finestra.document.write(cfg.stampa!({ ...dati, ...totali, ...testoRifNomi(), ...collegati }, righe));
    finestra.document.close();
  };

  // Nomi dei record collegati (es. cliente, tecnico) per la stampa
  const testoRifNomi = () => {
    const o: Record<string, string> = {};
    for (const col of cfg.colonne) if (col.riferimento) o[col.chiave] = testoRif[col.riferimento.campo] ?? "";
    return o;
  };

  return (
    <div className="velo" onMouseDown={onChiudi}>
      <form
        className={`finestra-scheda${ingrandita ? " ingrandita" : ""}`}
        onSubmit={salva}
        onMouseDown={(e) => { e.stopPropagation(); setMenuAzioni(false); }}
      >
        <div className="scheda-titolo">
          <span><CreditCard size={14} /> {nuovo ? cfg.titoloNuovo : cfg.titoloScheda?.(valori) ?? String(valori[cfg.colonne[0].chiave] ?? "")}</span>
          <span className="comandi">
            <button type="button" title="Riduci" onClick={() => setRidotta(!ridotta)}><Minus size={16} strokeWidth={3} /></button>
            <button type="button" title="Ingrandisci" onClick={() => setIngrandita(!ingrandita)}>
              {ingrandita ? <Minimize2 size={13} strokeWidth={3} /> : <Maximize2 size={13} strokeWidth={3} />}
            </button>
            <button type="button" title="Chiudi" onClick={onChiudi}><X size={17} strokeWidth={3} /></button>
          </span>
        </div>

        {!ridotta && (
          <>
            <div className="scheda-corpo">
              <div className="linguette">
                {["Principale", ...(cfg.linguette ?? [])].map((l) => (
                  <button type="button" key={l} className={l === linguetta ? "attiva" : ""} onClick={() => setLinguetta(l)}>{l}</button>
                ))}
              </div>
              <div className="pannello-linguetta">
                {linguetta === "Principale" ? (
                  <>
                    <div className="griglia-campi">{principali.map((c, i) => campo(c, !!principali[i - 1]?.finisciRiga))}</div>
                    {cfg.righe && righeMateriali()}
                  </>
                ) : cfg.campi.some((c) => c.linguetta === linguetta) ? (
                  <div className="griglia-campi">
                    {cfg.campi.filter((c) => c.linguetta === linguetta).map((c, i, a) => campo(c, !!a[i - 1]?.finisciRiga))}
                  </div>
                ) : cfg.figli?.some((f) => f.linguetta === linguetta) ? (
                  <>
                    {cfg.figli.filter((f) => f.linguetta === linguetta).map((f) => (
                      <div key={f.tabella} className="blocco-collegati">
                        {f.titolo && <div className="sezione-scheda grigio">{f.titolo}</div>}
                        <RecordCollegati figlio={f} id={valori.id as number | undefined} />
                      </div>
                    ))}
                  </>
                ) : linguetta === "Log Cloud" ? (
                  <LogRecord sezione={cfg.sezione} id={valori.id as number | undefined} />
                ) : (
                  <p className="vuoto-linguetta">Questa linguetta verrà completata quando ricreiamo la sezione collegata.</p>
                )}
              </div>
            </div>

            <div className="scheda-piede">
              <span className={stato.startsWith("Errore") || stato.startsWith("Compilare") ? "errore" : ""}>{stato}</span>
              <span className="utente-scheda" title="Utente collegato: le modifiche vengono registrate a suo nome">
                {profilo?.ruolo === "admin" ? "Amministrazione" : profilo?.nome || profilo?.email}
              </span>
              <span className="comandi-piede">
                {modificabile && <button type="submit" className="link blu">Salva</button>}
                {!nuovo && (
                  <span className="tendina-piede">
                    <button type="button" className="link verde" onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenuAzioni(!menuAzioni)}>Azioni</button>
                    {menuAzioni && (
                      <div className="voci" onMouseDown={(e) => e.stopPropagation()}>
                        {!nelCestino && puo(cfg.sezione, "modificare") && (
                          <>
                            {cartelle.filter((a) => a.id !== valori.archivio_id).map((a) => (
                              <button type="button" key={a.id} onClick={() => onSposta(a)}>Sposta in "{a.nome}"</button>
                            ))}
                            {!!valori.archivio_id && <button type="button" onClick={() => onSposta(null)}>Togli dall'archivio</button>}
                          </>
                        )}
                        {!nelCestino && puo(cfg.sezione, "eliminare") && <button type="button" onClick={onElimina}>Elimina</button>}
                        {nelCestino && onRipristina && puo(cfg.sezione, "eliminare") && <button type="button" onClick={onRipristina}>Ripristina</button>}
                        {cfg.stampa && <button type="button" onClick={stampa}>Stampa</button>}
                        {dati.email ? <a href={`mailto:${dati.email}`}>Invia e-mail</a> : null}
                      </div>
                    )}
                  </span>
                )}
                <button type="button" className="link rosso" onClick={onChiudi}>Chiudi</button>
              </span>
            </div>
          </>
        )}
      </form>
      {cercaMateriale && (
        <div onMouseDown={(e) => e.stopPropagation()}>
          <CercaMateriale onChiudi={() => setCercaMateriale(false)} onScegli={(m) => aggiungiRiga(rigaDaMateriale(m))} onRigaVuota={() => aggiungiRiga()} />
        </div>
      )}
      {gestione && (
        <div onMouseDown={(e) => e.stopPropagation()}>
          <GestioneElenco
          titolo={gestione.titoloOpzioni!}
          tabella={gestione.opzioniDa!}
          colonne={gestione.colonneOpzioni}
            onChiudi={() => { setGestione(null); setVersioneOpzioni((v) => v + 1); }}
          />
        </div>
      )}
    </div>
  );
}

// Storico delle modifiche del record (dal registro attività, visibile all'admin)
function LogRecord({ sezione, id }: { sezione: string; id?: number }) {
  const [voci, setVoci] = useState<{ id: number; azione: string; il: string; profili: { email: string } | null }[] | null>(null);

  useEffect(() => {
    if (id === undefined) return setVoci([]);
    supabase
      .from("registro")
      .select("id, azione, il, profili(email)")
      .like("azione", `${sezione}_%`)
      .eq("dettagli->>id", String(id))
      .order("il", { ascending: false })
      .then(({ data }) => setVoci((data as never) ?? []));
  }, [sezione, id]);

  if (!voci) return <p className="vuoto-linguetta">Caricamento…</p>;
  if (!voci.length) return <p className="vuoto-linguetta">Nessuna modifica registrata.</p>;
  return (
    <table className="griglia">
      <thead><tr><th>Data e ora</th><th>Utente</th><th>Operazione</th></tr></thead>
      <tbody>
        {voci.map((v) => (
          <tr key={v.id}>
            <td>{new Date(v.il).toLocaleString("it-IT")}</td>
            <td>{v.profili?.email ?? "—"}</td>
            <td>{v.azione.replace(`${sezione}_`, "")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Record collegati mostrati in una linguetta (es. gli impianti del cliente)
function RecordCollegati({ figlio, id }: { figlio: NonNullable<Archivio["figli"]>[number]; id?: number }) {
  const [righe, setRighe] = useState<Record<string, unknown>[] | null>(null);

  useEffect(() => {
    if (id === undefined) return setRighe([]);
    let q = supabase.from(figlio.tabella).select(figlio.select ?? "*").eq(figlio.campo, id);
    // Le righe di dettaglio (es. righe dei rapporti) non hanno il cestino
    if (!figlio.select) q = q.is("eliminato_il", null);
    q.order(figlio.ordine ?? "id", { ascending: !figlio.ordine || !!figlio.crescente })
      .then(({ data }) => {
        let r = ((data as unknown as Record<string, unknown>[]) ?? []).filter((x) => !figlio.escludi?.(x));
        if (figlio.recentiPer) {
          const v = (x: Record<string, unknown>) => String(figlio.recentiPer!.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | null)?.[k], x) ?? "");
          r = [...r].sort((a, b) => v(b).localeCompare(v(a)));
        }
        setRighe(r);
      });
  }, [figlio, id]);

  if (!righe) return <p className="vuoto-linguetta">Caricamento…</p>;
  if (!righe.length) return <p className="vuoto-linguetta">Nessun elemento collegato.</p>;
  return (
    <table className="griglia">
      <thead><tr>{figlio.colonne.map((c) => <th key={c.chiave}>{c.titolo}</th>)}</tr></thead>
      <tbody>
        {righe.map((r, i) => (
          <tr key={i}>
            {figlio.colonne.map((c) => (
              <td key={c.chiave}>{(() => {
                // Chiavi annidate, es. "rapporto.numero"
                const v = c.chiave.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | null)?.[k], r);
                return c.tipo === "data" ? dataIt(v) : c.tipo === "euro" ? euro(v) : c.tipo === "booleano" ? (v ? "Sì" : "No")
                  : c.tipo === "numero" && v !== null && v !== undefined && v !== "" ? Number(v).toLocaleString("it-IT", { maximumFractionDigits: 4 }) : String(v ?? "");
              })()}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
