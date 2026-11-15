import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Copy, Minus, Package, Plus, Printer, Save, Trash2 } from "lucide-react";
import { dataIso, leggiTutto, registra, supabase } from "../supabase";
import { useAuth } from "../auth";
import Autocompleta from "../components/Autocompleta";
import { stampaPreventivo } from "../stampe";
import {
  leggiCatalogo, NOMI_TIPO, prezzoVoce, totaleAmbiente,
  type AmbienteFoglio, type AmbienteTipo, type Foglio, type TipoImpianto, type VoceImpianto,
} from "../impianti";

// Preventivo guidato: si sceglie elettrico o idraulico, poi su un foglio largo si aggiungono gli ambienti
// (Cucina, Camera…) già compilati con il loro impianto tipo, modificabili (+/−, voci in più, prezzi).
// Salvando nasce (o si aggiorna) un preventivo normale, con le righe divise per ambiente.

const euro = (v: number) => v.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const r2 = (x: number) => Math.round(x * 100) / 100;
const numero = (s: string) => Number(String(s).replace(",", "."));
let progressivo = 0;
const nuovaChiave = () => `a${Date.now().toString(36)}${progressivo++}`;

export default function PreventivoGuidato() {
  const naviga = useNavigate();
  const { profilo } = useAuth();
  const [parametri] = useSearchParams();
  const idPreventivo = parametri.get("id") ? Number(parametri.get("id")) : null;

  const [foglio, setFoglio] = useState<Foglio | null>(null);
  const [catalogo, setCatalogo] = useState<{ voci: VoceImpianto[]; ambienti: AmbienteTipo[] } | null>(null);
  const [clienti, setClienti] = useState<{ id: number; nome: string }[]>([]);
  const [testoCliente, setTestoCliente] = useState("");
  const [oggetto, setOggetto] = useState("");
  const [data, setData] = useState(dataIso(new Date())!);
  const [sconto, setSconto] = useState("0");
  const [iva, setIva] = useState("22");
  const [id, setId] = useState<number | null>(idPreventivo);
  const [stato, setStato] = useState("");
  const [errore, setErrore] = useState("");
  const [modificato, setModificato] = useState(false);
  const [prezziVoci, setPrezziVoci] = useState(true);
  const [vediMateriali, setVediMateriali] = useState(false);

  useEffect(() => { leggiTutto("clienti", "id, nome", true).then((c) => setClienti(c as unknown as { id: number; nome: string }[])).catch(() => {}); }, []);

  // Preventivo già fatto con il foglio: si riapre
  useEffect(() => {
    if (!idPreventivo) return;
    supabase.from("preventivi").select("id, numero, data, sconto, iva, configurazione, cliente:clienti(nome)").eq("id", idPreventivo).maybeSingle().then(({ data: p, error }) => {
      if (error || !p) return setErrore("Preventivo non trovato" + (error ? ": " + error.message : ""));
      const conf = p.configurazione as Foglio | null;
      if (!conf?.tipo) return setErrore("Questo preventivo non è stato fatto con il foglio guidato");
      setFoglio(conf);
      setOggetto(String(p.numero ?? ""));
      setData(String(p.data));
      setSconto(String(p.sconto ?? 0).replace(".", ","));
      setIva(String(p.iva ?? 0).replace(".", ","));
      setTestoCliente((p.cliente as unknown as { nome: string } | null)?.nome ?? "");
    });
  }, [idPreventivo]);

  useEffect(() => {
    if (!foglio?.tipo) return;
    leggiCatalogo(foglio.tipo).then(setCatalogo).catch((e) => setErrore((e as Error).message));
  }, [foglio?.tipo]);

  const cliente = clienti.find((c) => c.nome.trim().toLowerCase() === testoCliente.trim().toLowerCase()) ?? null;
  const cambia = (f: (x: Foglio) => Foglio) => { setFoglio((x) => (x ? f(x) : x)); setModificato(true); };
  const cambiaAmbiente = (chiave: string, f: (a: AmbienteFoglio) => AmbienteFoglio) =>
    cambia((x) => ({ ...x, ambienti: x.ambienti.map((a) => (a.chiave === chiave ? f(a) : a)) }));

  // Ambiente dal tipo: le sue voci con i prezzi attuali; il nome si numera se c'è già (Camera, Camera 2…)
  const aggiungiAmbiente = (t: AmbienteTipo | null) => {
    if (!foglio || !catalogo) return;
    const base = t?.nome ?? "Nuovo ambiente";
    const stessi = foglio.ambienti.filter((a) => a.nome === base || a.nome.startsWith(`${base} `)).length;
    const voci = (t?.voci ?? []).map((x) => catalogo.voci.find((v) => v.id === x.voce_id) && { v: catalogo.voci.find((v) => v.id === x.voce_id)!, q: x.quantita })
      .filter((x): x is { v: VoceImpianto; q: number } => !!x)
      .map(({ v, q }) => ({ voce_id: v.id, nome: v.nome, unita: v.unita, prezzo: prezzoVoce(v), quantita: q }));
    const chiave = nuovaChiave();
    cambia((x) => ({ ...x, ambienti: [...x.ambienti, { chiave, nome: stessi ? `${base} ${stessi + 1}` : base, voci }] }));
    setTimeout(() => document.getElementById(chiave)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
  };

  const totali = useMemo(() => {
    const imponibile = r2((foglio?.ambienti ?? []).reduce((t, a) => t + totaleAmbiente(a), 0));
    const scontoTotale = r2(imponibile * (numero(sconto) || 0) / 100);
    const scontato = r2(imponibile - scontoTotale);
    const ivaTotale = r2(scontato * (numero(iva) || 0) / 100);
    return { imponibile, sconto_totale: scontoTotale, prezzo_scontato: scontato, iva_totale: ivaTotale, totale: r2(scontato + ivaTotale) };
  }, [foglio, sconto, iva]);

  // Materiali da ordinare: i kit delle voci moltiplicati per le quantità
  const materialiDaOrdinare = useMemo(() => {
    const m = new Map<number, { descrizione: string; unita: string; quantita: number }>();
    for (const a of foglio?.ambienti ?? []) for (const v of a.voci) {
      const voce = catalogo?.voci.find((x) => x.id === v.voce_id);
      for (const k of voce?.kit ?? []) {
        const r = m.get(k.materiale_id) ?? { descrizione: k.descrizione, unita: k.unita_misura ?? "", quantita: 0 };
        r.quantita += k.quantita * v.quantita;
        m.set(k.materiale_id, r);
      }
    }
    return [...m.values()].sort((a, b) => a.descrizione.localeCompare(b.descrizione));
  }, [foglio, catalogo]);

  const salva = async () => {
    if (!foglio) return;
    if (!oggetto.trim()) return setErrore("Scrivi l'oggetto del preventivo (es. Impianto elettrico appartamento)");
    if (testoCliente.trim() && !cliente) return setErrore("Cliente non trovato in anagrafica: sceglilo dall'elenco");
    setErrore(""); setStato("Salvataggio…");
    const record = {
      numero: oggetto.trim(), data, cliente_id: cliente?.id ?? null,
      sconto: numero(sconto) || 0, iva: numero(iva) || 0, ...totali, configurazione: foglio,
    };
    const ris = id
      ? await supabase.from("preventivi").update(record).eq("id", id).select("id").single()
      : await supabase.from("preventivi").insert({ ...record, stato: "Aperto" }).select("id").single();
    if (ris.error) { setStato(""); return setErrore(/configurazione/.test(ris.error.message) ? "Esegui su Supabase lo script 0031_preventivo_guidato.sql" : ris.error.message); }
    const nuovoId = ris.data.id as number;
    // Righe del preventivo: "Ambiente – Voce", ricreate a ogni salvataggio
    await supabase.from("righe_preventivo").delete().eq("preventivo_id", nuovoId);
    const righe = foglio.ambienti.flatMap((a) => a.voci.filter((v) => v.quantita > 0).map((v) => ({
      descrizione: `${a.nome} – ${v.nome}`, unita_misura: v.unita, quantita: v.quantita, prezzo_base: v.prezzo, ricarico: 0, prezzo: v.prezzo, totale: r2(v.prezzo * v.quantita),
    }))).map((r, i) => ({ ...r, preventivo_id: nuovoId, ordine: i }));
    if (righe.length) {
      const { error } = await supabase.from("righe_preventivo").insert(righe);
      if (error) { setStato(""); return setErrore("Righe non salvate: " + error.message); }
    }
    await registra(`preventivi_${id ? "modificato" : "creato"}`, { id: nuovoId, nome: oggetto, guidato: foglio.tipo });
    setId(nuovoId);
    setModificato(false);
    setStato(`Preventivo salvato (${righe.length} righe, totale ${euro(totali.totale)})`);
  };

  const stampa = async () => {
    if (!foglio) return;
    const finestra = window.open("", "_blank");
    if (!finestra) return setErrore("Il browser ha bloccato la finestra di stampa");
    const { data: c } = cliente ? await supabase.from("clienti").select("nome, indirizzo_fatturazione, piva, codice_fiscale, email").eq("id", cliente.id).maybeSingle() : { data: null };
    // Ogni ambiente: riga del titolo (con il suo totale se i prezzi delle voci sono nascosti), poi le voci
    const righe = foglio.ambienti.flatMap((a) => [
      { descrizione: `▸ ${a.nome.toUpperCase()}`, quantita: null, prezzo: null, totale: prezziVoci ? null : totaleAmbiente(a) },
      ...a.voci.filter((v) => v.quantita > 0).map((v) => ({
        descrizione: `   ${v.nome}`, quantita: v.quantita, unita_misura: v.unita,
        prezzo: prezziVoci ? v.prezzo : null, totale: prezziVoci ? r2(v.prezzo * v.quantita) : null,
      })),
    ]);
    finestra.document.write(stampaPreventivo({
      numero: oggetto, data, cliente: c?.nome ?? testoCliente, cliente_indirizzo_fatturazione: c?.indirizzo_fatturazione, cliente_piva: c?.piva,
      cliente_codice_fiscale: c?.codice_fiscale, cliente_email: c?.email, sconto: numero(sconto) || 0, iva: numero(iva) || 0, ...totali,
    }, righe));
    finestra.document.close();
  };

  // ---- Scelta del tipo ----
  if (!foglio) {
    if (idPreventivo && !errore) return <p className="piccolo">Caricamento…</p>;
    return (
      <div className="pagina-guidato">
        <div className="testata"><h1>Nuovo preventivo guidato</h1></div>
        {errore && <p className="errore">{errore}</p>}
        <p>Che impianto è?</p>
        <div className="scelta-tipo-impianto">
          {(Object.keys(NOMI_TIPO) as TipoImpianto[]).map((t) => (
            <button key={t} className={`carta-tipo ${t}`} onClick={() => { setFoglio({ tipo: t, ambienti: [] }); setOggetto(NOMI_TIPO[t]); }}>
              <span className="icona-tipo">{t === "elettrico" ? "⚡" : "💧"}</span>
              <b>{NOMI_TIPO[t]}</b>
              <span className="piccolo">{t === "elettrico" ? "Punti luce, prese, comandi, linee, quadro…" : "Punti acqua, scarichi, collettori, caldaia…"}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- Foglio ----
  return (
    <div className="pagina-guidato foglio">
      <div className="testata-foglio">
        <h1>{foglio.tipo === "elettrico" ? "⚡" : "💧"} {NOMI_TIPO[foglio.tipo]}{modificato ? " *" : ""}</h1>
        <div className="dati-foglio">
          <label>Cliente<Autocompleta id="cliente-guidato" valore={testoCliente} opzioni={clienti.map((c) => c.nome)} onCambia={(t) => { setTestoCliente(t); setModificato(true); }} placeholder="Scrivi le prime lettere…" nonTrovato={!!testoCliente.trim() && !cliente} /></label>
          <label>Oggetto<input value={oggetto} onChange={(e) => { setOggetto(e.target.value); setModificato(true); }} /></label>
          <label>Data<input type="date" value={data} onChange={(e) => { setData(e.target.value); setModificato(true); }} /></label>
        </div>
      </div>
      {errore && <p className="errore">{errore}</p>}

      <div className="area-foglio">
        <aside className="tavolozza-ambienti">
          <div className="titolo-tavolozza">Aggiungi ambiente</div>
          {!catalogo && <p className="piccolo">Caricamento…</p>}
          {catalogo?.ambienti.map((a) => (
            <button key={a.id} onClick={() => aggiungiAmbiente(a)}><Plus size={15} /> {a.nome}<span>{euro(a.voci.reduce((t, x) => { const v = catalogo.voci.find((y) => y.id === x.voce_id); return t + (v ? prezzoVoce(v) * x.quantita : 0); }, 0))}</span></button>
          ))}
          <button className="vuoto" onClick={() => aggiungiAmbiente(null)}><Plus size={15} /> Ambiente vuoto</button>
          {profilo?.ruolo === "admin" && <button className="link" onClick={() => naviga("/admin/impianti-tipo")}>Modifica ambienti e voci…</button>}
        </aside>

        <div className="foglio-bianco">
          {!foglio.ambienti.length && <p className="vuoto-foglio">Scegli a sinistra gli ambienti da inserire: arrivano già compilati con il loro impianto tipo, poi li modifichi qui.</p>}
          <div className="ambienti-foglio">
            {foglio.ambienti.map((a) => (
              <div key={a.chiave} id={a.chiave} className="ambiente-foglio">
                <div className="testa-ambiente">
                  <input value={a.nome} onChange={(e) => cambiaAmbiente(a.chiave, (x) => ({ ...x, nome: e.target.value }))} aria-label="Nome dell'ambiente" />
                  <button title="Duplica (es. Camera 2)" onClick={() => cambia((x) => {
                    const i = x.ambienti.findIndex((y) => y.chiave === a.chiave);
                    const copia = { ...a, chiave: nuovaChiave(), nome: `${a.nome} (copia)`, voci: a.voci.map((v) => ({ ...v })) };
                    return { ...x, ambienti: [...x.ambienti.slice(0, i + 1), copia, ...x.ambienti.slice(i + 1)] };
                  })}><Copy size={15} /></button>
                  <button title="Togli l'ambiente" className="rosso" onClick={() => confirm(`Togliere "${a.nome}" dal preventivo?`) && cambia((x) => ({ ...x, ambienti: x.ambienti.filter((y) => y.chiave !== a.chiave) }))}><Trash2 size={15} /></button>
                </div>
                {a.voci.map((v, k) => (
                  <div key={k} className={`voce-foglio${v.quantita ? "" : " zero"}`}>
                    <span className="nome-voce" title={v.nome}>{v.nome}</span>
                    <span className="contatore-voce">
                      <button aria-label="Meno" onClick={() => cambiaAmbiente(a.chiave, (x) => ({ ...x, voci: x.voci.map((y, j) => (j === k ? { ...y, quantita: Math.max(0, y.quantita - 1) } : y)) }))}><Minus size={14} /></button>
                      <input inputMode="decimal" value={String(v.quantita).replace(".", ",")} aria-label="Quantità"
                        onChange={(e) => { const q = numero(e.target.value); if (!Number.isNaN(q) && q >= 0) cambiaAmbiente(a.chiave, (x) => ({ ...x, voci: x.voci.map((y, j) => (j === k ? { ...y, quantita: q } : y)) })); }} />
                      <button aria-label="Più" onClick={() => cambiaAmbiente(a.chiave, (x) => ({ ...x, voci: x.voci.map((y, j) => (j === k ? { ...y, quantita: y.quantita + 1 } : y)) }))}><Plus size={14} /></button>
                    </span>
                    <span className="prezzo-voce">
                      <input inputMode="decimal" defaultValue={String(v.prezzo).replace(".", ",")} aria-label="Prezzo a punto"
                        onBlur={(e) => { const p = numero(e.target.value); if (!Number.isNaN(p) && p !== v.prezzo) cambiaAmbiente(a.chiave, (x) => ({ ...x, voci: x.voci.map((y, j) => (j === k ? { ...y, prezzo: p } : y)) })); }} />
                    </span>
                    <span className="totale-voce">{euro(v.prezzo * v.quantita)}</span>
                    <button className="togli-voce" aria-label="Togli la voce" onClick={() => cambiaAmbiente(a.chiave, (x) => ({ ...x, voci: x.voci.filter((_, j) => j !== k) }))}>×</button>
                  </div>
                ))}
                <select value="" onChange={(e) => {
                  const v = catalogo?.voci.find((x) => x.id === Number(e.target.value));
                  if (v) cambiaAmbiente(a.chiave, (x) => ({ ...x, voci: [...x.voci, { voce_id: v.id, nome: v.nome, unita: v.unita, prezzo: prezzoVoce(v), quantita: 1 }] }));
                }}>
                  <option value="">+ aggiungi voce…</option>
                  {catalogo?.voci.filter((v) => v.attiva && !a.voci.some((x) => x.voce_id === v.id)).map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                </select>
                <div className="totale-ambiente"><span>Totale {a.nome}</span><b>{euro(totaleAmbiente(a))}</b></div>
              </div>
            ))}
          </div>
        </div>

        <aside className="riepilogo-foglio">
          <div className="titolo-tavolozza">Riepilogo</div>
          {foglio.ambienti.map((a) => <div key={a.chiave} className="riga-riepilogo"><span>{a.nome}</span><span>{euro(totaleAmbiente(a))}</span></div>)}
          <div className="riga-riepilogo forte"><span>Imponibile</span><span>{euro(totali.imponibile)}</span></div>
          <label className="riga-riepilogo"><span>Sconto %</span><input inputMode="decimal" value={sconto} onChange={(e) => { setSconto(e.target.value); setModificato(true); }} /></label>
          {totali.sconto_totale > 0 && <div className="riga-riepilogo"><span>Sconto</span><span>− {euro(totali.sconto_totale)}</span></div>}
          <label className="riga-riepilogo"><span>IVA %</span><input inputMode="decimal" value={iva} onChange={(e) => { setIva(e.target.value); setModificato(true); }} /></label>
          <div className="riga-riepilogo"><span>IVA</span><span>{euro(totali.iva_totale)}</span></div>
          <div className="riga-riepilogo totale"><span>Totale</span><span>{euro(totali.totale)}</span></div>
          <button className="btn blu" onClick={salva}><Save size={16} /> {id ? "Salva modifiche" : "Salva come preventivo"}</button>
          {stato && <p className="ok">{stato}</p>}
          {id && !modificato && <button className="link" onClick={() => naviga(`/s/preventivi?apri=${id}`)}>Apri il preventivo</button>}
          <label className="riga-check"><input type="checkbox" checked={prezziVoci} onChange={(e) => setPrezziVoci(e.target.checked)} /> Stampa con i prezzi delle singole voci</label>
          <button className="btn grigio" onClick={stampa}><Printer size={16} /> Stampa</button>
          <button className="btn grigio" onClick={() => setVediMateriali(true)}><Package size={16} /> Materiali da ordinare</button>
        </aside>
      </div>

      {vediMateriali && (
        <div className="velo" onMouseDown={() => setVediMateriali(false)}>
          <div className="finestra" onMouseDown={(e) => e.stopPropagation()}>
            <div className="finestra-titolo">Materiali da ordinare<button className="chiudi" onClick={() => setVediMateriali(false)}>×</button></div>
            <div className="finestra-corpo">
              {!materialiDaOrdinare.length ? <p className="piccolo">Nessuna voce del foglio ha un kit di materiali: impostali in "Impianti tipo".</p> : (
                <table className="griglia tabella-voci">
                  <thead><tr><th>Materiale</th><th className="destra">Quantità</th><th>UM</th></tr></thead>
                  <tbody>{materialiDaOrdinare.map((m, i) => <tr key={i}><td>{m.descrizione}</td><td className="destra">{(Math.round(m.quantita * 100) / 100).toLocaleString("it-IT")}</td><td>{m.unita}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
