import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { ARCHIVI } from "../archivi";
import { MODELLI_DISPONIBILI, type DdtPdf } from "../ddtPdf";
import { euro } from "./Griglia";
import CercaMateriale from "./CercaMateriale";
import { type TecnicoDdt } from "../tecnicoDdt";
import { abbina, cercaDoppione, chiaveRiga, costo, ETICHETTE, leggiPdfDdt, norm, salvaDdt, tipologiaPagamento, umDa, type Rec, type Riga } from "../ddtImport";

// Importazione di un DDT di acquisto dal PDF del fornitore:
// lettura delle righe, abbinamento ai materiali di magazzino (con conferma) e salvataggio.

export default function ImportaDdtPdf({ onChiudi, onFinito, onCorreggi, fileIniziale, onSalvatoIniziale }: {
  onChiudi: () => void;
  onFinito: () => void;
  // DDT in arrivo da Drive da controllare: si apre subito questo PDF; salvato, si avvisa chi l'ha aperto
  fileIniziale?: File;
  onSalvatoIniziale?: (ddtId: number, messaggio: string) => void;
  // Apre la normale scheda di un nuovo DDT già compilata con quanto letto, da completare a mano
  onCorreggi: (valori: Record<string, unknown>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [coda, setCoda] = useState<File[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [urlPdf, setUrlPdf] = useState("");
  const [ddt, setDdt] = useState<DdtPdf | null>(null);
  const [righe, setRighe] = useState<Riga[]>([]);
  const [fornitori, setFornitori] = useState<Rec[]>([]);
  const [fornitoreId, setFornitoreId] = useState<number | null>(null);
  const [doppione, setDoppione] = useState("");
  const [stato, setStato] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [scegliPer, setScegliPer] = useState<number | null>(null);
  const [fatti, setFatti] = useState<string[]>([]);
  const [materiali, setMateriali] = useState<Rec[]>([]);
  const [nuovoFornitore, setNuovoFornitore] = useState({ nome: "", piva: "" });
  // Tecnico che ha ordinato/ritirato: riconosciuto dalle note del DDT, si può cambiare
  const [tecnici, setTecnici] = useState<TecnicoDdt[]>([]);
  const [tecnicoId, setTecnicoId] = useState<number | null>(null);
  const [tecnicoDa, setTecnicoDa] = useState("");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (fileIniziale) apri(fileIniziale, []); }, []);

  const fornitore = fornitori.find((f) => f.id === fornitoreId) ?? null;

  const apri = async (f: File, resto: File[]) => {
    setFile(f);
    setCoda(resto);
    setDdt(null);
    setRighe([]);
    setDoppione("");
    setInCorso(true);
    if (urlPdf) URL.revokeObjectURL(urlPdf);
    setUrlPdf(URL.createObjectURL(f));
    try {
      const l = await leggiPdfDdt(f, f.name, setStato);
      setDoppione(l.doppione);
      setTecnici(l.tecnici);
      setTecnicoId(l.tecnicoId);
      setTecnicoDa(l.tecnicoDa);
      setFornitori(l.fornitori);
      setMateriali(l.materiali);
      setNuovoFornitore({ nome: l.ddt.nomeFornitore ?? "", piva: l.ddt.pivaFornitore ?? "" });
      setFornitoreId(l.fornitoreId);
      setDdt(l.ddt);
      setRighe(l.righe);
      setStato(l.fornitoreId ? "" : "Fornitore non trovato in anagrafica: sceglilo dall'elenco o crealo");
    } catch (e) {
      setStato("Errore: " + (e as Error).message);
    }
    setInCorso(false);
  };

  // La scelta fatta su una riga vale anche per le altre righe non confermate con lo stesso codice
  const cambia = (i: number, v: Partial<Riga>) => setRighe((rr) => rr.map((r, j) =>
    j === i || (v.confermata && !r.confermata && chiaveRiga(r.pdf) === chiaveRiga(rr[i].pdf)) ? { ...r, ...v } : r));

  // Fornitore scelto a mano: gli abbinamenti ricordati e il controllo dei doppioni dipendono da lui.
  // Le scelte già fatte sulle righe restano.
  const applicaFornitore = async (fid: number | null, elenco = fornitori) => {
    setFornitoreId(fid);
    setDoppione("");
    if (!ddt) return;
    let ricordati = new Map<string, number>();
    if (fid) {
      const { data } = await supabase.from("abbinamenti_fornitore").select("codice, materiale_id").eq("fornitore_id", fid);
      ricordati = new Map((data ?? []).map((a) => [norm(a.codice), a.materiale_id as number]));
      setDoppione(await cercaDoppione(fid, ddt.numeroDdt));
    }
    const nuove = abbina(ddt, materiali, ricordati);
    setRighe((rr) => nuove.map((n, i) => (rr[i] && ["scelto", "libera"].includes(rr[i].stato) ? rr[i] : n)));
    setStato(elenco.some((f) => f.id === fid) ? "" : "Fornitore non trovato in anagrafica: sceglilo dall'elenco o crealo");
  };

  const creaFornitore = async () => {
    const nome = nuovoFornitore.nome.trim();
    if (!nome) return;
    setInCorso(true);
    const { data, error } = await supabase.from("fornitori").insert({ nome, piva: nuovoFornitore.piva.trim() || null }).select("id, nome, piva, email, tipologia_pagamento").single();
    setInCorso(false);
    if (error) return setStato("Errore: fornitore non creato: " + error.message);
    const elenco = [...fornitori, data as Rec];
    setFornitori(elenco);
    await applicaFornitore((data as Rec).id, elenco);
  };

  // Righe come verranno salvate nel DDT (stessi calcoli della scheda)
  const cfg = ARCHIVI.ddt_acquisto;
  const righeDdt = useMemo(() => righe.map((r, i) => {
    const m = r.materiale;
    return cfg.righe!.ricalcola({
      ordine: i,
      materiale_id: m?.id ?? null,
      codice_barre: m ? m.codice_interno ?? m.codice_barre ?? null : r.pdf.codice,
      descrizione: m ? m.descrizione : r.stato === "nuovo" ? r.nuovaDescrizione : r.pdf.descrizione,
      unita_misura: m ? m.unita_misura : r.stato === "nuovo" ? r.nuovaUm : umDa(r.pdf.um),
      quantita: r.pdf.quantita, costo: r.pdf.prezzo, sconto: 0, iva: r.pdf.iva,
    });
  }), [righe, cfg]);
  const totali = cfg.calcolaTotali!({}, righeDdt);

  const daConfermare = righe.filter((r) => !r.confermata).length;
  const bloccato = !ddt || ddt.errori.length > 0 || !!doppione || !fornitore || daConfermare > 0 || !ddt.numeroDdt.trim() || !ddt.data;

  // Correzione a mano: le righe abbinate restano collegate al materiale, le altre diventano righe libere
  const correggi = async () => {
    if (!ddt || !file) return;
    const righeScheda = righe.map((r, i) => {
      const m = r.confermata || r.stato === "proposta" ? r.materiale : null;
      return cfg.righe!.ricalcola({
        ordine: i, materiale_id: m?.id ?? null,
        codice_barre: m ? m.codice_interno ?? m.codice_barre ?? null : r.pdf.codice,
        descrizione: m ? m.descrizione : r.pdf.descrizione,
        unita_misura: m ? m.unita_misura : umDa(r.pdf.um),
        quantita: r.pdf.quantita, costo: r.pdf.prezzo, sconto: 0, iva: r.pdf.iva,
      });
    });
    const avvisi = [...ddt.errori, ...ddt.avvisi];
    onCorreggi({
      data: ddt.data || null, numero_ddt: ddt.numeroDdt || null, stato: "Chiuso",
      fornitore_id: fornitore?.id ?? null, fornitore: fornitore?.nome ?? "",
      tecnico_id: tecnicoId, tecnico: tecnici.find((t) => t.id === tecnicoId)?.nome ?? "",
      email: fornitore?.email ?? null, tipologia_pagamento: fornitore ? await tipologiaPagamento(fornitore) : null,
      note: [ddt.note, avvisi.length ? `Da controllare (lettura PDF): ${avvisi.join("; ")}` : ""].filter(Boolean).join("\n") || null,
      pdf: file,
      _righe: righeScheda,
    });
  };

  const salva = async () => {
    if (!ddt || !fornitore || !file || bloccato) return;
    setInCorso(true);
    try {
      const gia = await cercaDoppione(fornitore.id, ddt.numeroDdt);
      if (gia) {
        setDoppione(gia);
        setInCorso(false);
        return;
      }
      const { messaggio, id } = await salvaDdt({ ddt, fornitore, righe, file, tecnicoId, avanzamento: setStato });
      if (fileIniziale && file === fileIniziale) onSalvatoIniziale?.(id, messaggio);
      setFatti((f) => [...f, messaggio]);
      setStato(messaggio);
      onFinito();
      setDdt(null);
      setRighe([]);
      setFile(null);
      if (coda.length) await apri(coda[0], coda.slice(1));
    } catch (e) {
      setStato("Errore: " + (e as Error).message);
    }
    setInCorso(false);
  };

  const azioniRiga = (r: Riga, i: number) => {
    const btn = (testo: string, f: () => void, classe = "grigio") => <button type="button" className={`btn piccolo-btn ${classe}`} onClick={f}>{testo}</button>;
    return (
      <div className="azioni-riga-pdf">
        {r.stato === "proposta" && !r.confermata && btn("Conferma", () => cambia(i, { confermata: true }), "verde")}
        {(r.stato === "multipli" || r.stato === "simili") && r.candidati.map((c) => btn(`${c.codice_interno ?? ""} ${String(c.descrizione ?? "").slice(0, 30)}`, () => cambia(i, { materiale: c, stato: "scelto", confermata: true })))}
        {(r.stato === "nuovo" || r.stato === "simili") && !r.confermata && btn("Crea nuovo materiale", () => cambia(i, { stato: "nuovo", confermata: true }), r.stato === "nuovo" ? "verde" : "grigio")}
        {btn(r.materiale ? "Cambia materiale" : "Scegli materiale", () => setScegliPer(i))}
        {r.stato !== "libera" && btn("Senza magazzino", () => cambia(i, { materiale: null, stato: "libera", confermata: true }))}
      </div>
    );
  };

  return (
    <div className="velo" onMouseDown={() => !inCorso && onChiudi()}>
      <div className="finestra finestra-ddt-pdf" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Importa DDT da PDF<button type="button" className="chiudi" disabled={inCorso} onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          {!ddt && (
            <div
              className="trascina-pdf"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = [...e.dataTransfer.files].filter((x) => x.name.toLowerCase().endsWith(".pdf"));
                if (f.length && !inCorso) apri(f[0], f.slice(1));
              }}
              onClick={() => !inCorso && fileRef.current?.click()}
            >
              <b>Trascina qui il PDF del DDT</b> (anche più di uno) oppure clicca per sceglierlo.
              <div className="piccolo">Lettura dedicata: {MODELLI_DISPONIBILI.join(", ")}. Altri fornitori: lettura automatica da controllare. Le scansioni non si possono leggere.</div>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple hidden onChange={(e) => {
            const f = [...(e.target.files ?? [])];
            e.target.value = "";
            if (f.length) apri(f[0], f.slice(1));
          }} />
          {stato && <p className={stato.startsWith("Errore") || stato.startsWith("Fornitore non") ? "errore" : "ok"}>{stato}</p>}

          {ddt && (
            <>
              <div className="testata-ddt-pdf">
                <label>Fornitore
                  <select value={fornitoreId ?? ""} onChange={(e) => applicaFornitore(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— scegli —</option>
                    {[...fornitori].sort((a, b) => String(a.nome).localeCompare(String(b.nome))).map((f) => <option key={f.id} value={f.id}>{String(f.nome)}</option>)}
                  </select>
                </label>
                {ddt.generico ? (
                  <>
                    <label>Numero DDT<input value={ddt.numeroDdt}
                      onChange={(e) => setDdt({ ...ddt, numeroDdt: e.target.value })}
                      onBlur={async () => setDoppione(fornitoreId ? await cercaDoppione(fornitoreId, ddt.numeroDdt) : "")} /></label>
                    <label>Data<input type="date" value={ddt.data} onChange={(e) => setDdt({ ...ddt, data: e.target.value })} /></label>
                  </>
                ) : (
                  <>
                    <label>Numero DDT<input readOnly value={ddt.numeroDdt} /></label>
                    <label>Data<input readOnly value={ddt.data.split("-").reverse().join("/")} /></label>
                  </>
                )}
                <button type="button" className="btn grigio" onClick={() => window.open(urlPdf, "_blank")}>Apri il PDF</button>
              </div>
              {ddt.generico && !fornitore && (
                <div className="nuovo-materiale">
                  <span className="piccolo">Nuovo fornitore:</span>
                  <input value={nuovoFornitore.nome} placeholder="Ragione sociale" onChange={(e) => setNuovoFornitore({ ...nuovoFornitore, nome: e.target.value })} />
                  <input value={nuovoFornitore.piva} placeholder="Partita IVA" onChange={(e) => setNuovoFornitore({ ...nuovoFornitore, piva: e.target.value })} />
                  <button type="button" className="btn verde piccolo-btn" disabled={inCorso || !nuovoFornitore.nome.trim()} onClick={creaFornitore}>Crea fornitore</button>
                </div>
              )}
              {ddt.note && <div className="piccolo">Note: {ddt.note.split("\n").join(" · ")}</div>}
              <label className="tecnico-ddt">Tecnico che ha ordinato
                <select value={tecnicoId ?? ""} onChange={(e) => { setTecnicoId(e.target.value ? Number(e.target.value) : null); setTecnicoDa(""); }}>
                  <option value="">— nessuno —</option>
                  {tecnici.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
                <span className="piccolo">{tecnicoDa ? `riconosciuto dal DDT ("${tecnicoDa}")`
                  : tecnicoId ? ""
                  : ddt.ritira ? `sul DDT "RITIRA ${ddt.ritira}": nome non riconosciuto, sceglilo (e aggiungilo negli altri nomi del tecnico)`
                  : "non indicato sul DDT: sceglilo se lo sai"}</span>
              </label>
              {ddt.errori.map((e) => <p key={e} className="errore">⛔ {e}</p>)}
              {doppione && <p className="errore">⛔ {doppione}</p>}
              {ddt.avvisi.map((e) => <p key={e} className="avviso">⚠ {e}</p>)}

              <div className="tabella-ddt-pdf">
                <table className="griglia">
                  <thead>
                    <tr>
                      <th>Dal PDF</th>
                      <th className="destra">Q.tà</th>
                      <th className="destra">Prezzo</th>
                      <th className="destra">IVA</th>
                      <th>Materiale in magazzino</th>
                      <th className="destra">Costo in magazzino</th>
                    </tr>
                  </thead>
                  <tbody>
                    {righe.map((r, i) => {
                      const et = ETICHETTE[r.stato];
                      const colore = r.confermata ? "verde" : et.colore;
                      const pb = Number(r.materiale?.prezzo_base ?? 0);
                      return (
                        <tr key={i} className={`riga-pdf ${colore}`}>
                          <td>
                            <div><b>{r.pdf.codice}</b> <span className="piccolo">{r.pdf.codiceProduttore}</span></div>
                            <div>{r.pdf.descrizione}</div>
                          </td>
                          <td className="destra">{r.pdf.quantita.toLocaleString("it-IT")} {r.pdf.um}</td>
                          <td className="destra">{costo(r.pdf.prezzo)}</td>
                          <td className="destra">{r.pdf.iva}%</td>
                          <td>
                            <div className={`etichetta-pdf ${colore}`}>{r.confermata && r.stato === "proposta" ? "Confermato" : r.confermata && r.stato === "nuovo" ? "Verrà creato" : et.testo}</div>
                            {r.materiale && <div><b>{String(r.materiale.codice_interno ?? "")}</b> {String(r.materiale.descrizione ?? "")}</div>}
                            {r.stato === "nuovo" && (
                              <div className="piccolo">Codice interno: {ddt.codiceInternoDalFornitore ? <b>{r.pdf.codice}</b> : "progressivo (assegnato al salvataggio)"}</div>
                            )}
                            {r.stato === "nuovo" && (
                              <div className="nuovo-materiale">
                                <input value={r.nuovaDescrizione} onChange={(e) => cambia(i, { nuovaDescrizione: e.target.value })} title="Descrizione del nuovo materiale" />
                                <input value={r.nuovaUm} onChange={(e) => cambia(i, { nuovaUm: e.target.value })} title="Unità di misura" className="um" />
                              </div>
                            )}
                            {azioniRiga(r, i)}
                          </td>
                          <td className="destra">
                            {r.materiale && (
                              <>
                                {costo(pb)}
                                {r.pdf.prezzo > pb + 0.00005 && <div className="avviso piccolo">↑ diventa {costo(r.pdf.prezzo)}</div>}
                                {r.pdf.prezzo < pb - 0.00005 && <div className="piccolo">↓ resta invariato</div>}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="piede-ddt-pdf">
                <span>{righe.length} righe · Imponibile <b>{euro(totali.imponibile)}</b> · IVA <b>{euro(totali.iva_totale)}</b> · Totale <b>{euro(totali.totale)}</b></span>
                {daConfermare > 0 && <span className="avviso">{daConfermare} righe da confermare</span>}
              </div>
            </>
          )}
          {fatti.length > 1 && <details><summary className="ok">{fatti.length} DDT salvati</summary><ul className="piccolo">{fatti.map((f) => <li key={f}>{f}</li>)}</ul></details>}
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" disabled={inCorso} onClick={onChiudi}>Chiudi</button>
          {coda.length > 0 && <span className="piccolo" style={{ padding: "0 10px" }}>Altri {coda.length} PDF in attesa</span>}
          <span style={{ flex: 1 }} />
          {ddt && coda.length > 0 && <button type="button" className="btn grigio" disabled={inCorso} onClick={() => apri(coda[0], coda.slice(1))}>Salta questo</button>}
          {ddt && !doppione && (
            <button type="button" className="btn grigio" disabled={inCorso} onClick={correggi}
              title="Apre la scheda di un nuovo DDT già compilata con quanto letto: correggi quello che serve e salva">
              Correggi a mano
            </button>
          )}
          {ddt && (
            <button type="button" className="btn blu" disabled={inCorso || bloccato} onClick={salva}
              title={bloccato ? "Risolvi gli errori e conferma tutte le righe" : "Salva il DDT e carica il magazzino"}>
              {inCorso ? "Salvataggio…" : "Salva DDT"}
            </button>
          )}
        </div>
      </div>
      {scegliPer !== null && (
        <div onMouseDown={(e) => e.stopPropagation()}>
        <CercaMateriale
          titolo={`Materiale per: ${righe[scegliPer].pdf.descrizione}`}
          testoIniziale={righe[scegliPer].pdf.descrizione.split(/\s+/)[0] ?? ""}
          onChiudi={() => setScegliPer(null)}
          onScegli={(m) => { cambia(scegliPer, { materiale: m as Rec, stato: "scelto", confermata: true }); setScegliPer(null); }}
        />
        </div>
      )}
    </div>
  );
}
