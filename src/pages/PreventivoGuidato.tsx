import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Copy, Minus, Package, Plus, Printer, Save, Trash2 } from "lucide-react";
import { dataIso, leggiTutto, registra, supabase } from "../supabase";
import { useAuth } from "../auth";
import Autocompleta from "../components/Autocompleta";
import ConfiguratoreLavoro from "../components/ConfiguratoreLavoro";
import { stampaPreventivo } from "../stampe";
import {
  accessoriAmbiente, manodopera, leggiCatalogo, leggiLavori, leggiSerie, marcaMateriale, type LavoroPreventivo, moduliOccupati, NOMI_TIPO, postiScatole, prezzoVoce, stimaScatole, totaleAmbiente,
  type AmbienteFoglio, type AmbienteTipo, type Foglio, type SerieCivile, type TipoImpianto, type VoceImpianto,
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
  const [serieCivili, setSerieCivili] = useState<SerieCivile[] | null>(null);
  const [erroreSerie, setErroreSerie] = useState("");
  const [lavori, setLavori] = useState<LavoroPreventivo[] | null>(null);
  const [erroreLavori, setErroreLavori] = useState("");
  const [lavoroAperto, setLavoroAperto] = useState<number | null>(null);

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
    leggiCatalogo(foglio.tipo).then((c) => {
      setCatalogo(c);
      // Fogli salvati prima dei "moduli": si prendono dal catalogo
      setFoglio((x) => x && ({ ...x, ambienti: x.ambienti.map((a) => ({ ...a, voci: a.voci.map((v) => (v.moduli === undefined ? { ...v, moduli: c.voci.find((y) => y.id === v.voce_id)?.moduli ?? 0 } : v)) })) }));
    }).catch((e) => setErrore((e as Error).message));
    leggiLavori(foglio.tipo).then(setLavori).catch((e) => { setLavori([]); setErroreLavori((e as Error).message); });
    if (foglio.tipo === "elettrico") leggiSerie().then(setSerieCivili).catch((e) => { setSerieCivili([]); setErroreSerie((e as Error).message); });
  }, [foglio?.tipo]);

  const sceltaSerie = (s: SerieCivile | null) => {
    cambia((x) => ({ ...x, serie: s && { id: s.id, nome: s.nome, prezzo_supporto_3: s.prezzo_supporto_3, prezzo_supporto_4: s.prezzo_supporto_4, prezzo_placca_3: s.prezzo_placca_3, prezzo_placca_4: s.prezzo_placca_4, prezzo_copriforo: s.prezzo_copriforo, collegati: s.collegati } }));
  };

  // ---- Lavori ("Cosa facciamo?"): ogni lavoro scelto è una sezione del foglio con i suoi materiali ----
  const lavoroDi = (lavoroId: number) => foglio?.lavori?.find((l) => l.lavoro_id === lavoroId && foglio.ambienti.some((a) => a.chiave === l.chiave));
  const premiLavoro = (l: LavoroPreventivo) => {
    if (lavoroDi(l.id)) return setLavoroAperto(lavoroAperto === l.id ? null : l.id);
    const chiave = nuovaChiave();
    cambia((x) => ({ ...x, ambienti: [...x.ambienti, { chiave, nome: l.nome, voci: [] }], lavori: [...(x.lavori ?? []), { lavoro_id: l.id, chiave, marca: null }] }));
    setLavoroAperto(l.id);
  };
  const aggiungiMateriale = (lavoroId: number, m: Record<string, unknown> & { id: number }, principale: boolean) => {
    const lf = lavoroDi(lavoroId);
    if (!lf) return;
    cambia((x) => ({
      ...x,
      // Il materiale "principale" (la caldaia, il climatizzatore…) decide la marca degli accessori
      lavori: principale ? x.lavori?.map((y) => (y.chiave === lf.chiave ? { ...y, marca: marcaMateriale(m.descrizione) } : y)) : x.lavori,
      ambienti: x.ambienti.map((a) => (a.chiave !== lf.chiave ? a : { ...a, voci: [...a.voci, {
        voce_id: null, materiale_id: m.id, nome: String(m.descrizione ?? ""), unita: String(m.unita_misura ?? "pz") || "pz",
        prezzo: Math.round(Number(m.prezzo_ricaricato ?? 0) * 100) / 100, quantita: 1,
      }] })),
    }));
  };
  const quantitaMateriale = (lavoroId: number, materialeId: number, q: number) => {
    const lf = lavoroDi(lavoroId);
    if (!lf) return;
    cambiaAmbiente(lf.chiave, (a) => ({ ...a, voci: q > 0 ? a.voci.map((v) => (v.materiale_id === materialeId ? { ...v, quantita: q } : v)) : a.voci.filter((v) => v.materiale_id !== materialeId) }));
  };

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
      .map(({ v, q }) => ({ voce_id: v.id, nome: v.nome, unita: v.unita, prezzo: prezzoVoce(v), quantita: q, moduli: v.moduli }));
    const chiave = nuovaChiave();
    // Scatole: quelle dell'ambiente tipo, altrimenti una stima dai moduli
    const nuovo: AmbienteFoglio = { chiave, nome: stessi ? `${base} ${stessi + 1}` : base, voci };
    if (foglio.tipo === "elettrico") {
      const conTipo = (t?.scatole_3 ?? 0) + (t?.scatole_4 ?? 0) > 0;
      nuovo.scatole_3 = conTipo ? t!.scatole_3 : stimaScatole(moduliOccupati(nuovo));
      nuovo.scatole_4 = conTipo ? t!.scatole_4 : 0;
    }
    cambia((x) => ({ ...x, ambienti: [...x.ambienti, nuovo] }));
    setTimeout(() => document.getElementById(chiave)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
  };

  // Tariffa oraria della manodopera: quella del foglio, altrimenti la "Standard" delle tariffe
  const tariffa = foglio?.tariffa_oraria ?? 0;
  const oreTotali = (foglio?.ambienti ?? []).reduce((t, a) => t + (a.ore ?? 0), 0);
  useEffect(() => {
    if (!foglio || foglio.tariffa_oraria !== undefined) return;
    supabase.from("tariffe").select("nome, tariffa_oraria").order("ordine").then(({ data }) => {
      const t = (data ?? []) as { nome: string; tariffa_oraria: number | null }[];
      const scelta = t.find((x) => /standard/i.test(x.nome) && x.tariffa_oraria) ?? t.find((x) => x.tariffa_oraria);
      setFoglio((x) => (x && x.tariffa_oraria === undefined ? { ...x, tariffa_oraria: Number(scelta?.tariffa_oraria ?? 0) } : x));
    });
  }, [foglio?.tipo, foglio?.tariffa_oraria]);

  const totali = useMemo(() => {
    const imponibile = r2((foglio?.ambienti ?? []).reduce((t, a) => t + totaleAmbiente(a, foglio?.serie, tariffa), 0));
    const scontoTotale = r2(imponibile * (numero(sconto) || 0) / 100);
    const scontato = r2(imponibile - scontoTotale);
    const ivaTotale = r2(scontato * (numero(iva) || 0) / 100);
    return { imponibile, sconto_totale: scontoTotale, prezzo_scontato: scontato, iva_totale: ivaTotale, totale: r2(scontato + ivaTotale) };
  }, [foglio, sconto, iva]);

  // Materiali da ordinare: i kit delle voci moltiplicati per le quantità
  const materialiDaOrdinare = useMemo(() => {
    const m = new Map<number | string, { descrizione: string; unita: string; quantita: number }>();
    for (const a of foglio?.ambienti ?? []) for (const v of a.voci) {
      if (v.materiale_id && v.quantita > 0) {
        const r = m.get(v.materiale_id) ?? { descrizione: v.nome, unita: v.unita, quantita: 0 };
        r.quantita += v.quantita;
        m.set(v.materiale_id, r);
      }
      const voce = catalogo?.voci.find((x) => x.id === v.voce_id);
      for (const k of voce?.kit ?? []) {
        const r = m.get(k.materiale_id) ?? { descrizione: k.descrizione, unita: k.unita_misura ?? "", quantita: 0 };
        r.quantita += k.quantita * v.quantita;
        m.set(k.materiale_id, r);
      }
    }
    for (const a of foglio?.ambienti ?? []) for (const x of accessoriAmbiente(a, foglio?.serie)) {
      const nome = x.materiale ?? x.nome;
      const r = m.get(nome) ?? { descrizione: nome, unita: "pz", quantita: 0 };
      r.quantita += x.quantita;
      m.set(nome, r);
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
    const righe = foglio.ambienti.flatMap((a) => [
      ...a.voci.filter((v) => v.quantita > 0).map((v) => ({ nome: v.nome, unita: v.unita, quantita: v.quantita, prezzo: v.prezzo, materiale_id: v.materiale_id ?? null })),
      ...accessoriAmbiente(a, foglio.serie).map((x) => ({ ...x, unita: "pz", materiale_id: null })),
      ...manodopera(a, tariffa),
    ].map((v) => ({
      materiale_id: v.materiale_id,
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
      { descrizione: `▸ ${a.nome.toUpperCase()}`, quantita: null, prezzo: null, totale: prezziVoci ? null : totaleAmbiente(a, foglio.serie, tariffa) },
      ...[...a.voci.filter((v) => v.quantita > 0), ...accessoriAmbiente(a, foglio.serie).map((x) => ({ ...x, unita: "pz" })), ...manodopera(a, tariffa)].map((v) => ({
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

  // ---- Elettrico: prima la serie civile (placche, supporti, copriforo) ----
  if (foglio.tipo === "elettrico" && foglio.serie === undefined) {
    return (
      <div className="pagina-guidato">
        <div className="testata"><h1>⚡ Che serie civile si monta?</h1></div>
        <p className="piccolo">Dalla serie e dalle scatole di ogni stanza calcolo da solo supporti, placche e copriforo.</p>
        {erroreSerie && <p className="errore">{erroreSerie}</p>}
        {!serieCivili && <p className="piccolo">Caricamento…</p>}
        <div className="scelta-serie">
          {serieCivili?.filter((s) => s.attiva).map((s) => (
            <button key={s.id} className="carta-serie" onClick={() => sceltaSerie(s)}>
              <b>{s.nome}</b>
              <span className="piccolo">placca 3M {euro(s.prezzo_placca_3)} · supporto {euro(s.prezzo_supporto_3)}</span>
              <span className={`piccolo ${Object.keys(s.collegati ?? {}).length ? "ok" : ""}`}>{Object.keys(s.collegati ?? {}).length ? `prezzi dal catalogo (${Object.keys(s.collegati ?? {}).length}/5)` : "prezzi scritti a mano"}</span>
            </button>
          ))}
          <button className="carta-serie vuota" onClick={() => sceltaSerie(null)}><b>Nessuna / decido dopo</b><span className="piccolo">niente placche e supporti</span></button>
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
          {foglio.tipo === "elettrico" && (
            <label>Serie civile
              <select value={foglio.serie?.id ?? ""} onChange={(e) => sceltaSerie(serieCivili?.find((s) => s.id === Number(e.target.value)) ?? null)}>
                <option value="">Nessuna</option>
                {foglio.serie && !serieCivili?.some((s) => s.id === foglio.serie!.id) && <option value={foglio.serie.id}>{foglio.serie.nome}</option>}
                {serieCivili?.filter((s) => s.attiva || s.id === foglio.serie?.id).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
      {errore && <p className="errore">{errore}</p>}

      {(foglio.tipo === "idraulico" || !!lavori?.some((l) => l.attivo)) && (
        <div className="cosa-facciamo">
          <span className="titolo-pillole">Cosa facciamo?</span>
          {erroreLavori && <span className="errore">{erroreLavori}</span>}
          {lavori?.filter((l) => l.attivo).map((l) => {
            const lf = lavoroDi(l.id);
            return (
              <button key={l.id} className={`pillola-lavoro${lf ? " scelta" : ""}${lavoroAperto === l.id ? " aperta" : ""}`} onClick={() => premiLavoro(l)}>
                {l.icona} {l.nome}{lf?.marca ? <small> · {lf.marca}</small> : null}
              </button>
            );
          })}
        </div>
      )}
      {(() => {
        const l = lavori?.find((x) => x.id === lavoroAperto);
        const lf = l && lavoroDi(l.id);
        const a = lf && foglio.ambienti.find((y) => y.chiave === lf.chiave);
        return l && lf && a ? (
          <ConfiguratoreLavoro lavoro={l} ambiente={a} marca={lf.marca ?? null} onChiudi={() => setLavoroAperto(null)}
            onAggiungi={(m, c) => aggiungiMateriale(l.id, m, c.principale)} onQuantita={(id, q) => quantitaMateriale(l.id, id, q)} />
        ) : null;
      })()}

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
                  <button title="Togli l'ambiente" className="rosso" onClick={() => confirm(`Togliere "${a.nome}" dal preventivo?`) && cambia((x) => ({ ...x, ambienti: x.ambienti.filter((y) => y.chiave !== a.chiave), lavori: x.lavori?.filter((y) => y.chiave !== a.chiave) }))}><Trash2 size={15} /></button>
                </div>
                {a.voci.map((v, k) => (
                  <div key={k} className={`voce-foglio${v.quantita ? "" : " zero"}`}>
                    <span className="nome-voce" title={v.nome}>{v.nome}</span>
                    <span className="contatore-voce">
                      <button aria-label="Meno" onClick={() => cambiaAmbiente(a.chiave, (x) => ({ ...x, voci: x.voci.map((y, j) => (j === k ? { ...y, quantita: Math.max(0, y.quantita - 1) } : y)) }))}><Minus size={14} /></button>
                      <CampoNumero etichetta="Quantità" valore={v.quantita} onCambia={(q) => cambiaAmbiente(a.chiave, (x) => ({ ...x, voci: x.voci.map((y, j) => (j === k ? { ...y, quantita: q } : y)) }))} />
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
                  if (v) cambiaAmbiente(a.chiave, (x) => ({ ...x, voci: [...x.voci, { voce_id: v.id, nome: v.nome, unita: v.unita, prezzo: prezzoVoce(v), quantita: 1, moduli: v.moduli }] }));
                }}>
                  <option value="">+ aggiungi voce…</option>
                  {catalogo?.voci.filter((v) => v.attiva && !a.voci.some((x) => x.voce_id === v.id)).map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                </select>
                <div className="ore-ambiente">
                  <span>⏱ Ore di lavoro</span>
                  <span className="contatore-voce">
                    <button aria-label="Meno ore" onClick={() => cambiaAmbiente(a.chiave, (x) => ({ ...x, ore: Math.max(0, (x.ore ?? 0) - 0.5) }))}><Minus size={14} /></button>
                    <CampoNumero etichetta={`Ore di lavoro ${a.nome}`} valore={a.ore ?? 0} onCambia={(n) => cambiaAmbiente(a.chiave, (x) => ({ ...x, ore: n }))} />
                    <button aria-label="Più ore" onClick={() => cambiaAmbiente(a.chiave, (x) => ({ ...x, ore: (x.ore ?? 0) + 0.5 }))}><Plus size={14} /></button>
                  </span>
                  <span className="totale-voce">{euro((a.ore ?? 0) * tariffa)}</span>
                </div>
                {foglio.tipo === "elettrico" && <Scatole a={a} serie={foglio.serie} onCambia={(s3, s4) => cambiaAmbiente(a.chiave, (x) => ({ ...x, scatole_3: s3, scatole_4: s4 }))} />}
                <div className="totale-ambiente"><span>Totale {a.nome}</span><b>{euro(totaleAmbiente(a, foglio.serie, tariffa))}</b></div>
              </div>
            ))}
          </div>
        </div>

        <aside className="riepilogo-foglio">
          <div className="titolo-tavolozza">Riepilogo</div>
          {foglio.ambienti.map((a) => <div key={a.chiave} className="riga-riepilogo"><span>{a.nome}</span><span>{euro(totaleAmbiente(a, foglio.serie, tariffa))}</span></div>)}
          <div className="ore-riepilogo">
            <div className="riga-riepilogo"><span>⏱ Ore di lavoro</span><b>{String(oreTotali).replace(".", ",")} h</b></div>
            <label className="riga-riepilogo"><span>Tariffa €/ora</span><CampoNumero etichetta="Tariffa oraria" valore={tariffa} onCambia={(n) => cambia((x) => ({ ...x, tariffa_oraria: n }))} /></label>
            <div className="riga-riepilogo"><span>Manodopera</span><span>{euro(oreTotali * tariffa)}</span></div>
          </div>
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

// Scatole dell'ambiente (3 e 4 moduli) e righe automatiche di supporti, placche e copriforo
function Scatole({ a, serie, onCambia }: { a: AmbienteFoglio; serie: Foglio["serie"]; onCambia: (s3: number, s4: number) => void }) {
  const s3 = a.scatole_3 ?? 0, s4 = a.scatole_4 ?? 0;
  const occupati = moduliOccupati(a), posti = postiScatole(a);
  const contatore = (v: number, set: (n: number) => void, nome: string) => (
    <span className="contatore-voce">
      <button aria-label={`Meno scatole ${nome}`} onClick={() => set(Math.max(0, v - 1))}><Minus size={14} /></button>
      <input inputMode="numeric" value={v} aria-label={`Scatole ${nome}`} onChange={(e) => { const n = parseInt(e.target.value || "0", 10); if (!Number.isNaN(n) && n >= 0) set(n); }} />
      <button aria-label={`Più scatole ${nome}`} onClick={() => set(v + 1)}><Plus size={14} /></button>
    </span>
  );
  return (
    <div className="scatole-ambiente">
      <div className="riga-scatole">
        <span>Scatole{serie ? <small> · {serie.nome}</small> : null}</span>
        <span className="tipo-scatola">3M {contatore(s3, (n) => onCambia(n, s4), "3 moduli")}</span>
        <span className="tipo-scatola">4M {contatore(s4, (n) => onCambia(s3, n), "4 moduli")}</span>
      </div>
      <div className={`moduli-scatole${occupati > posti ? " pochi" : ""}`}>
        {occupati > posti ? `⚠ ${occupati} moduli ma solo ${posti} posti: aggiungi scatole` : `${occupati} moduli su ${posti} posti`}
      </div>
      {accessoriAmbiente(a, serie).map((x) => (
        <div key={x.nome} className="voce-foglio auto" title="Calcolato da serie e scatole">
          <span className="nome-voce">{x.breve}</span>
          <span className="quantita-auto">{x.quantita}</span>
          <span className="prezzo-auto">{String(x.prezzo).replace(".", ",")}</span>
          <span className="totale-voce">{euro(x.prezzo * x.quantita)}</span>
          <span />
        </div>
      ))}
      {!serie && <div className="piccolo">Scegli la serie civile in alto per calcolare placche e supporti.</div>}
    </div>
  );
}

// Campo numerico con la virgola: tiene il testo mentre si scrive ("2," non diventa "2")
function CampoNumero({ valore, onCambia, etichetta }: { valore: number; onCambia: (n: number) => void; etichetta: string }) {
  const [testo, setTesto] = useState(String(valore).replace(".", ","));
  useEffect(() => { if (numero(testo || "0") !== valore) setTesto(String(valore).replace(".", ",")); }, [valore]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input inputMode="decimal" aria-label={etichetta} value={testo} onFocus={(e) => e.target.select()}
      onChange={(e) => { setTesto(e.target.value); const n = numero(e.target.value || "0"); if (!Number.isNaN(n) && n >= 0) onCambia(n); }} />
  );
}
