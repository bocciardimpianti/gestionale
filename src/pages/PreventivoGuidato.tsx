import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Copy, FileText, LogOut, Minus, Package, Plus, Printer, Save, Trash2 } from "lucide-react";
import { cancellaBozza, leggiBozza, salvaBozza } from "../bozzaPreventivo";
import { impaginatoDaConfigurazione, totaliFoglio, type Alternativa, type Configurazione } from "../impaginaGuidato";
import { dataIso, leggiTutto, registra, supabase } from "../supabase";
import { useAuth } from "../auth";
import Autocompleta from "../components/Autocompleta";
import ConfiguratoreLavoro, { useCatalogo } from "../components/ConfiguratoreLavoro";
import { stampaPreventivo } from "../stampe";
import {
  accessoriAmbiente, centralinoQuadro, type Contenitore, fruttiSerie, leggiContenitori, manodopera, moduliNecessari, moduliQuadro, SPAZIO_LIBERO, leggiCatalogo, leggiTariffe, tariffaDi, type TariffaFoglio, type TariffaPreventivo, leggiLavori, leggiSerie, marcaMateriale, type LavoroPreventivo, moduliOccupati, NOMI_TIPO, postiScatole, prezzoVoce, stimaScatole, totaleAmbiente,
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
  // Soluzioni alternative (es. 2 unità esterne / unità unica): ognuna con le sue stanze e il suo totale.
  // "foglio" è quella che si sta modificando; le altre restano in "soluzioni" (la prima è il preventivo vero)
  const [soluzioni, setSoluzioni] = useState<Alternativa[]>([]);
  const [attiva, setAttiva] = useState(0);
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
  const [contenitori, setContenitori] = useState<Contenitore[]>([]);

  useEffect(() => { leggiTutto("clienti", "id, nome", true).then((c) => setClienti(c as unknown as { id: number; nome: string }[])).catch(() => {}); }, []);

  // Preventivo lasciato aperto (andando in un'altra sezione): si riprende da dove si era rimasti
  const [ripreso, setRipreso] = useState(false);
  useEffect(() => {
    const b = leggiBozza();
    if (!b || !b.soluzioni?.length) return;
    if (idPreventivo && b.id !== idPreventivo) {
      if (!b.modificato || confirm(`C'è un altro preventivo guidato aperto con modifiche non salvate ("${b.oggetto}"). Lo chiudo e lo perdo?\n\nOK = chiudi quello e apri questo\nAnnulla = torna a quello`)) { cancellaBozza(); return; }
      naviga(b.id ? `/preventivo-guidato?id=${b.id}` : "/preventivo-guidato", { replace: true });
    }
    setSoluzioni(b.soluzioni); setAttiva(b.attiva); setFoglio(b.soluzioni[b.attiva]?.foglio ?? b.soluzioni[0].foglio);
    setOggetto(b.oggetto); setTestoCliente(b.cliente); setData(b.data); setSconto(b.sconto); setIva(b.iva);
    setId(b.id); setModificato(b.modificato); setRipreso(true);
    if (b.id && !idPreventivo) naviga(`/preventivo-guidato?id=${b.id}`, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Preventivo già fatto con il foglio: si riapre
  useEffect(() => {
    if (!idPreventivo || ripreso || leggiBozza()?.id === idPreventivo) return;
    supabase.from("preventivi").select("id, numero, data, sconto, iva, configurazione, cliente:clienti(nome)").eq("id", idPreventivo).maybeSingle().then(({ data: p, error }) => {
      if (error || !p) return setErrore("Preventivo non trovato" + (error ? ": " + error.message : ""));
      const conf = p.configurazione as Configurazione | null;
      if (!conf?.tipo) return setErrore("Questo preventivo non è stato fatto con il foglio guidato");
      const { alternative = [], nome_soluzione, ...principale } = conf;
      setFoglio(principale);
      setSoluzioni([{ nome: nome_soluzione ?? "", foglio: principale }, ...alternative]);
      setAttiva(0);
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
    if (foglio.tipo === "elettrico") leggiContenitori().then(setContenitori);
  }, [foglio?.tipo]);

  // Catalogo dei materiali: serve per trovare i frutti della serie (presa TV Matix, interruttore Matix…)
  const { materiali } = useCatalogo();
  const fruttiDi = (s: SerieCivile) => (catalogo && materiali ? fruttiSerie(s, catalogo.voci, materiali) : undefined);
  const serieFoglio = (s: SerieCivile | null): Foglio["serie"] => s && { id: s.id, nome: s.nome, prezzo_supporto_3: s.prezzo_supporto_3, prezzo_supporto_4: s.prezzo_supporto_4, prezzo_placca_3: s.prezzo_placca_3, prezzo_placca_4: s.prezzo_placca_4, prezzo_copriforo: s.prezzo_copriforo, collegati: s.collegati, cerca_frutti: s.cerca_frutti, frutti: fruttiDi(s) };
  const sceltaSerie = (s: SerieCivile | null) => {
    cambia((x) => ({ ...x, serie: serieFoglio(s) }));
  };
  // Serie scelta prima che il catalogo fosse pronto (foglio nuovo): i frutti si calcolano appena arriva
  useEffect(() => {
    if (idPreventivo || !foglio?.serie || foglio.serie.frutti !== undefined || !catalogo || !materiali || !serieCivili) return;
    const s = serieCivili.find((x) => x.id === foglio.serie!.id);
    if (s) setFoglio((x) => (x?.serie ? { ...x, serie: { ...x.serie, frutti: fruttiSerie(s, catalogo.voci, materiali) } } : x));
  }, [idPreventivo, foglio?.serie, catalogo, materiali, serieCivili]);
  // Frutti con i prezzi di oggi (anche per un preventivo riaperto)
  const aggiornaFrutti = () => {
    const s = serieCivili?.find((x) => x.id === foglio?.serie?.id);
    if (!s || !catalogo || !materiali) return alert("Attendi il caricamento del catalogo e riprova");
    cambia((x) => (x.serie ? { ...x, serie: { ...x.serie, cerca_frutti: s.cerca_frutti, frutti: fruttiSerie(s, catalogo.voci, materiali) } } : x));
  };

  // ---- Lavori ("Cosa facciamo?"): ogni lavoro scelto è una sezione del foglio con i suoi materiali ----
  const lavoroDi = (lavoroId: number) => foglio?.lavori?.find((l) => l.lavoro_id === lavoroId && foglio.ambienti.some((a) => a.chiave === l.chiave));
  // Lavoro con una stanza "quadro" dello stesso nome (Quadro elettrico): si aggiunge la stanza (o si va a quella che c'è)
  const stanzaQuadro = (l: LavoroPreventivo) => catalogo?.ambienti.find((a) => a.quadro && a.nome.trim().toLowerCase() === l.nome.trim().toLowerCase());
  const premiLavoro = (l: LavoroPreventivo) => {
    const tq = stanzaQuadro(l);
    if (tq) {
      const c = foglio?.ambienti.find((a) => a.quadro);
      if (c) return document.getElementById(c.chiave)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return aggiungiAmbiente(tq);
    }
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
  // Tutte le soluzioni con quella attiva aggiornata
  const tutte = (): Alternativa[] => (foglio ? (soluzioni.length ? soluzioni.map((x, i) => (i === attiva ? { ...x, foglio } : x)) : [{ nome: "", foglio }]) : []);
  const vaiSoluzione = (i: number) => { const t = tutte(); setSoluzioni(t); setFoglio(t[i].foglio); setAttiva(i); };
  // Nuova soluzione: vuota (si riempie da capo), con la stessa tariffa; per l'elettrico si chiede prima la serie civile
  const [chiediSerie, setChiediSerie] = useState(false);
  // Nella finestra: copiare le stanze (con punti e ore) della soluzione attuale invece di partire vuota
  const [mantieniStanze, setMantieniStanze] = useState(false);
  const aggiungiSoluzione = () => { setMantieniStanze(false); setChiediSerie(true); };
  const creaSoluzione = (serie: Foglio["serie"] | undefined) => {
    if (!foglio) return;
    setChiediSerie(false);
    const t = tutte();
    const copia = mantieniStanze ? JSON.parse(JSON.stringify({ ambienti: foglio.ambienti, lavori: foglio.lavori ?? [] })) as Pick<Foglio, "ambienti" | "lavori"> : null;
    const nuova: Alternativa = { nome: `Soluzione ${t.length + 1}`, foglio: {
      tipo: foglio.tipo, ambienti: copia?.ambienti ?? [], lavori: copia?.lavori ?? [], tariffa_oraria: foglio.tariffa_oraria, tariffa_nome: foglio.tariffa_nome,
      ...(foglio.tipo === "elettrico" ? { serie: serie === undefined ? foglio.serie ?? null : serie } : {}),
    } };
    setSoluzioni([...t, nuova]); setFoglio(nuova.foglio); setAttiva(t.length); setModificato(true);
  };
  const togliSoluzione = (i: number) => {
    const t = tutte();
    if (t.length < 2 || !confirm(`Togliere "${t[i].nome || `Soluzione ${i + 1}`}" e tutte le sue stanze?`)) return;
    const n = t.filter((_, j) => j !== i);
    const k = Math.min(attiva >= i ? Math.max(0, attiva - 1) : attiva, n.length - 1);
    setSoluzioni(n); setFoglio(n[k].foglio); setAttiva(k); setModificato(true);
  };
  const rinominaSoluzione = (i: number, nome: string) => { setSoluzioni(tutte().map((x, j) => (j === i ? { ...x, nome } : x))); setModificato(true); };
  // Il preventivo aperto resta su questo dispositivo: cambiando sezione (o chiudendo la pagina) si riprende da qui
  const chiuso = useRef(false);
  useEffect(() => {
    if (chiuso.current || !foglio || (!id && !foglio.ambienti.length && soluzioni.length < 2 && !modificato)) return;
    salvaBozza({ id, soluzioni: tutte(), attiva, oggetto, cliente: testoCliente, data, sconto, iva, modificato });
  }, [foglio, soluzioni, attiva, oggetto, testoCliente, data, sconto, iva, id, modificato]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esci: salva ed esci, esci senza salvare, elimina il preventivo
  const [chiediEsci, setChiediEsci] = useState(false);
  const esci = async (come: "salva" | "senza" | "elimina") => {
    if (come === "salva") { const ok = await salva(); if (!ok) { setChiediEsci(false); return; } }
    if (come === "elimina") {
      if (!confirm(id ? "Eliminare questo preventivo? Va nel Cestino dei preventivi (si può recuperare)." : "Buttare via questo preventivo non salvato?")) return;
      if (id) {
        const { error } = await supabase.from("preventivi").update({ eliminato_il: new Date().toISOString() }).eq("id", id);
        if (error) { setChiediEsci(false); return setErrore("Non eliminato: " + error.message); }
        await registra("preventivi_eliminato", { id, nome: oggetto, guidato: true });
      }
    }
    chiuso.current = true;
    cancellaBozza();
    naviga("/s/preventivi");
  };

  // Configurazione da salvare: la prima soluzione è il foglio del preventivo, le altre vanno in "alternative"
  const configurazione = (): Configurazione => {
    const [prima, ...altre] = tutte();
    return { ...prima.foglio, ...(prima.nome.trim() ? { nome_soluzione: prima.nome.trim() } : {}), ...(altre.length ? { alternative: altre } : {}) };
  };

  // Ambiente dal tipo: le sue voci con i prezzi attuali; il nome si numera se c'è già (Camera, Camera 2…)
  const aggiungiAmbiente = (t: AmbienteTipo | null) => {
    if (!foglio || !catalogo) return;
    const base = t?.nome ?? "Nuovo ambiente";

    const stessi = foglio.ambienti.filter((a) => a.nome === base || a.nome.startsWith(`${base} `)).length;
    const voci = (t?.voci ?? []).map((x) => catalogo.voci.find((v) => v.id === x.voce_id) && { v: catalogo.voci.find((v) => v.id === x.voce_id)!, q: x.quantita })
      .filter((x): x is { v: VoceImpianto; q: number } => !!x)
      // Nel quadro le voci in ordine di catalogo (C6, C10, C16… poi differenziali e relè)
      .sort((x, y) => (t?.quadro ? x.v.ordine - y.v.ordine : 0))
      .map(({ v, q }) => ({ voce_id: v.id, nome: v.nome, unita: v.unita, prezzo: prezzoVoce(v), quantita: q, moduli: v.moduli }));
    const chiave = nuovaChiave();
    // Scatole: quelle dell'ambiente tipo, altrimenti una stima dai moduli
    const nuovo: AmbienteFoglio = { chiave, nome: stessi ? `${base} ${stessi + 1}` : base, voci };
    if (t?.quadro) nuovo.quadro = { tipo: "incasso", contenitori };
    else if (foglio.tipo === "elettrico") {
      const conTipo = (t?.scatole_3 ?? 0) + (t?.scatole_4 ?? 0) > 0;
      nuovo.scatole_3 = conTipo ? t!.scatole_3 : stimaScatole(moduliOccupati(nuovo));
      nuovo.scatole_4 = conTipo ? t!.scatole_4 : 0;
    }
    cambia((x) => ({ ...x, ambienti: [...x.ambienti, nuovo] }));
    setTimeout(() => document.getElementById(chiave)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
  };

  // Tariffa oraria della manodopera: quella del foglio, altrimenti la "Standard" delle tariffe
  const pred: TariffaFoglio = { nome: foglio?.tariffa_nome ?? "Manodopera", prezzo: foglio?.tariffa_oraria ?? 0 };
  const [tariffe, setTariffe] = useState<TariffaPreventivo[]>([]);
  const tariffeTipo = tariffe.filter((t) => t.attiva && (!t.tipo || t.tipo === foglio?.tipo));
  const oreTotali = (foglio?.ambienti ?? []).reduce((t, a) => t + (a.ore ?? 0), 0);
  // Ore e importo per tariffa (riepilogo)
  const perTariffa = [...(foglio?.ambienti ?? []).filter((a) => (a.ore ?? 0) > 0).reduce((m, a) => {
    const t = tariffaDi(a, pred);
    const k = `${t.nome}|${t.prezzo}`;
    const x = m.get(k) ?? { ...t, ore: 0 };
    x.ore += a.ore ?? 0;
    return m.set(k, x);
  }, new Map<string, TariffaFoglio & { ore: number }>()).values()];
  useEffect(() => {
    if (!foglio?.tipo) return;
    leggiTariffe().then(({ tariffe: t }) => {
      setTariffe(t);
      // Foglio nuovo: la tariffa predefinita per il tipo di impianto
      const scelta = t.find((x) => x.attiva && x.predefinita && x.tipo === foglio.tipo) ?? t.find((x) => x.attiva && x.predefinita && !x.tipo) ?? t.find((x) => x.attiva && (!x.tipo || x.tipo === foglio.tipo));
      setFoglio((x) => (x && x.tariffa_oraria === undefined ? { ...x, tariffa_oraria: scelta?.prezzo_ora ?? 0, tariffa_nome: scelta?.nome ?? "Manodopera" } : x));
    }).catch(() => {});
  }, [foglio?.tipo]); // eslint-disable-line react-hooks/exhaustive-deps
  const sceltaTariffa = (nome: string): TariffaFoglio | null => { const t = tariffe.find((x) => x.nome === nome); return t ? { nome: t.nome, prezzo: t.prezzo_ora } : null; };

  const totali = useMemo(() => {
    const imponibile = r2((foglio?.ambienti ?? []).reduce((t, a) => t + totaleAmbiente(a, foglio?.serie, pred), 0));
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

  const salva = async (): Promise<number | null> => {
    if (!foglio) return null;
    if (!oggetto.trim()) { setErrore("Scrivi l'oggetto del preventivo (es. Impianto elettrico appartamento)"); return null; }
    if (testoCliente.trim() && !cliente) { setErrore("Cliente non trovato in anagrafica: sceglilo dall'elenco"); return null; }
    setErrore(""); setStato("Salvataggio…");
    // Totali e righe del preventivo: quelli della prima soluzione (le alternative sono solo nell'impaginato)
    const principale = tutte()[0].foglio;
    const predP: TariffaFoglio = { nome: principale.tariffa_nome ?? "Manodopera", prezzo: principale.tariffa_oraria ?? 0 };
    const record = {
      numero: oggetto.trim(), data, cliente_id: cliente?.id ?? null,
      sconto: numero(sconto) || 0, iva: numero(iva) || 0, ...totaliFoglio(principale, numero(sconto) || 0, numero(iva) || 0), configurazione: configurazione(),
    };
    const ris = id
      ? await supabase.from("preventivi").update(record).eq("id", id).select("id").single()
      : await supabase.from("preventivi").insert({ ...record, stato: "Aperto" }).select("id").single();
    if (ris.error) { setStato(""); setErrore(/configurazione/.test(ris.error.message) ? "Esegui su Supabase lo script 0031_preventivo_guidato.sql" : ris.error.message); return null; }
    const nuovoId = ris.data.id as number;
    // Righe del preventivo: "Ambiente – Voce", ricreate a ogni salvataggio
    await supabase.from("righe_preventivo").delete().eq("preventivo_id", nuovoId);
    const righe = principale.ambienti.flatMap((a) => [
      ...a.voci.filter((v) => v.quantita > 0).map((v) => ({ nome: v.nome, unita: v.unita, quantita: v.quantita, prezzo: v.prezzo, materiale_id: v.materiale_id ?? null })),
      ...accessoriAmbiente(a, principale.serie).map((x) => ({ ...x, unita: "pz", materiale_id: null })),
      ...manodopera(a, predP),
    ].map((v) => ({
      materiale_id: v.materiale_id,
      descrizione: `${a.nome} – ${v.nome}`, unita_misura: v.unita, quantita: v.quantita, prezzo_base: v.prezzo, ricarico: 0, prezzo: v.prezzo, totale: r2(v.prezzo * v.quantita),
    }))).map((r, i) => ({ ...r, preventivo_id: nuovoId, ordine: i }));
    if (righe.length) {
      const { error } = await supabase.from("righe_preventivo").insert(righe);
      if (error) { setStato(""); setErrore("Righe non salvate: " + error.message); return null; }
    }
    await registra(`preventivi_${id ? "modificato" : "creato"}`, { id: nuovoId, nome: oggetto, guidato: foglio.tipo });
    setId(nuovoId);
    setModificato(false);
    setStato(`Preventivo salvato (${righe.length} righe, totale ${euro(record.totale)})${tutte().length > 1 ? ` · ${tutte().length} soluzioni` : ""}`);
    return nuovoId;
  };

  // Preventivo impaginato (modello della ditta): stanze con l'elenco di quello che si installa, totale in fondo
  const impagina = async () => {
    if (!foglio) return;
    const nuovoId = await salva();
    if (!nuovoId) return;
    const { data: p } = await supabase.from("preventivi").select("impaginato").eq("id", nuovoId).maybeSingle();
    const gia = (p?.impaginato as { soluzioni?: unknown[] } | null)?.soluzioni?.length;
    if (!gia || confirm("Questo preventivo è già stato impaginato. Rifare il testo dal foglio guidato?\n\nOK = testo nuovo dal foglio (le modifiche fatte a mano si perdono)\nAnnulla = apri l'impaginato com'è")) {
      const { error } = await supabase.from("preventivi").update({ impaginato: impaginatoDaConfigurazione(configurazione(), oggetto, numero(sconto) || 0) }).eq("id", nuovoId);
      if (error) return setErrore(/impaginato/.test(error.message) ? "Esegui su Supabase lo script 0058_preventivo_impaginato.sql" : error.message);
    }
    naviga(`/preventivo-impaginato?id=${nuovoId}`);
  };

  const stampa = async () => {
    if (!foglio) return;
    const finestra = window.open("", "_blank");
    if (!finestra) return setErrore("Il browser ha bloccato la finestra di stampa");
    const { data: c } = cliente ? await supabase.from("clienti").select("nome, indirizzo_fatturazione, piva, codice_fiscale, email").eq("id", cliente.id).maybeSingle() : { data: null };
    // Ogni ambiente: riga del titolo (con il suo totale se i prezzi delle voci sono nascosti), poi le voci
    const righe = foglio.ambienti.flatMap((a) => [
      { descrizione: `▸ ${a.nome.toUpperCase()}`, quantita: null, prezzo: null, totale: prezziVoci ? null : totaleAmbiente(a, foglio.serie, pred) },
      ...[...a.voci.filter((v) => v.quantita > 0), ...accessoriAmbiente(a, foglio.serie).map((x) => ({ ...x, unita: "pz" })), ...manodopera(a, pred)].map((v) => ({
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
            <button key={t} className={`carta-tipo ${t}`} onClick={() => { setFoglio({ tipo: t, ambienti: [] }); setSoluzioni([]); setAttiva(0); setOggetto(NOMI_TIPO[t]); }}>
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
        <h1>{foglio.tipo === "elettrico" ? "⚡" : "💧"} {NOMI_TIPO[foglio.tipo]}{modificato ? " *" : ""}
          <button type="button" className="btn grigio esci-foglio" onClick={() => setChiediEsci(true)} title="Chiudi il preventivo: salvalo, lascialo com'era o eliminalo"><LogOut size={15} /> Chiudi preventivo</button></h1>
        {ripreso && <p className="piccolo ripreso">Ripreso il preventivo che avevi lasciato aperto{modificato ? " (con modifiche non ancora salvate)" : ""}.</p>}
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

      <div className="soluzioni-foglio">
        {tutte().map((x, i) => (
          <div key={i} className={`linguetta-soluzione${i === attiva ? " attiva" : ""}`}>
            {i === attiva && tutte().length > 1
              ? <input value={x.nome} placeholder={i ? `Soluzione ${i + 1}` : "Soluzione 1 (titolo nel preventivo)"} aria-label="Nome della soluzione" onChange={(e) => rinominaSoluzione(i, e.target.value)} />
              : <button type="button" onClick={() => vaiSoluzione(i)}>{x.nome.trim() || `Soluzione ${i + 1}`}</button>}
            {tutte().length > 1 && i === attiva && <button type="button" className="togli-soluzione" title="Togli questa soluzione" onClick={() => togliSoluzione(i)}>×</button>}
          </div>
        ))}
        <button type="button" className="aggiungi-soluzione" onClick={aggiungiSoluzione} title="Nuova soluzione vuota (es. con unità esterna unica): nel preventivo impaginato ognuna ha il suo foglio e il suo totale">
          <Plus size={14} /> Aggiungi soluzione alternativa</button>
      </div>

      {(foglio.tipo === "idraulico" || !!lavori?.some((l) => l.attivo)) && (
        <div className="cosa-facciamo">
          <span className="titolo-pillole">Cosa facciamo?</span>
          {erroreLavori && <span className="errore">{erroreLavori}</span>}
          {lavori?.filter((l) => l.attivo).map((l) => {
            const lf = lavoroDi(l.id) || (stanzaQuadro(l) && foglio.ambienti.some((a) => a.quadro));
            return (
              <button key={l.id} className={`pillola-lavoro${lf ? " scelta" : ""}${lavoroAperto === l.id ? " aperta" : ""}`} onClick={() => premiLavoro(l)}>
                {l.icona} {l.nome}{typeof lf === "object" && lf?.marca ? <small> · {lf.marca}</small> : null}
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
                {a.voci.length > 0 && (
                  <div className="voce-foglio intestazione-voci" aria-hidden>
                    <span className="nome-voce">Voce</span><span className="contatore-voce">Q.tà</span>
                    <span className="prezzo-voce" title={a.quadro || foglio.lavori?.some((l) => l.chiave === a.chiave) ? "Prezzo di vendita" : "Prezzo di montaggio a punto (il frutto della serie si aggiunge sotto)"}>{a.quadro || foglio.lavori?.some((l) => l.chiave === a.chiave) ? "Prezzo" : "Montaggio"}</span><span className="totale-voce">Totale</span><span />
                  </div>
                )}
                {a.voci.map((v, k) => (
                  <div key={k} className={`voce-foglio${v.quantita ? "" : " zero"}`}>
                    <span className="nome-voce" title={v.nome}>{v.nome}</span>
                    <span className="contatore-voce">
                      <button aria-label="Meno" onClick={() => cambiaAmbiente(a.chiave, (x) => ({ ...x, voci: x.voci.map((y, j) => (j === k ? { ...y, quantita: Math.max(0, y.quantita - 1) } : y)) }))}><Minus size={14} /></button>
                      <CampoNumero etichetta="Quantità" valore={v.quantita} onCambia={(q) => cambiaAmbiente(a.chiave, (x) => ({ ...x, voci: x.voci.map((y, j) => (j === k ? { ...y, quantita: q } : y)) }))} />
                      <button aria-label="Più" onClick={() => cambiaAmbiente(a.chiave, (x) => ({ ...x, voci: x.voci.map((y, j) => (j === k ? { ...y, quantita: y.quantita + 1 } : y)) }))}><Plus size={14} /></button>
                    </span>
                    <span className="prezzo-voce">
                      <input inputMode="decimal" defaultValue={String(v.prezzo).replace(".", ",")} aria-label="Montaggio a punto" title="Montaggio a punto (il frutto della serie si aggiunge sotto, in automatico)"
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
                  {catalogo?.voci.filter((v) => v.attiva && !!v.quadro === !!a.quadro && !a.voci.some((x) => x.voce_id === v.id)).map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                </select>
                <div className="ore-ambiente">
                  <span>⏱ Ore di lavoro</span>
                  <span className="contatore-voce">
                    <button aria-label="Meno ore" onClick={() => cambiaAmbiente(a.chiave, (x) => ({ ...x, ore: Math.max(0, (x.ore ?? 0) - 0.5) }))}><Minus size={14} /></button>
                    <CampoNumero etichetta={`Ore di lavoro ${a.nome}`} valore={a.ore ?? 0} onCambia={(n) => cambiaAmbiente(a.chiave, (x) => ({ ...x, ore: n }))} />
                    <button aria-label="Più ore" onClick={() => cambiaAmbiente(a.chiave, (x) => ({ ...x, ore: (x.ore ?? 0) + 0.5 }))}><Plus size={14} /></button>
                  </span>
                  <span className="totale-voce">{euro((a.ore ?? 0) * tariffaDi(a, pred).prezzo)}</span>
                  <select className="tariffa-sezione" aria-label={`Tariffa ${a.nome}`} value={a.tariffa?.nome ?? ""} onChange={(e) => cambiaAmbiente(a.chiave, (x) => ({ ...x, tariffa: sceltaTariffa(e.target.value) }))}>
                    <option value="">{pred.nome} · {euro(pred.prezzo)}/h (predefinita)</option>
                    {a.tariffa && !tariffeTipo.some((t) => t.nome === a.tariffa!.nome) && <option value={a.tariffa.nome}>{a.tariffa.nome} · {euro(a.tariffa.prezzo)}/h</option>}
                    {tariffeTipo.filter((t) => t.nome !== pred.nome).map((t) => <option key={t.id} value={t.nome}>{t.nome} · {euro(t.prezzo_ora)}/h</option>)}
                  </select>
                </div>
                {a.quadro && <QuadroBox a={a} contenitoriAttuali={contenitori} onCambia={(q) => cambiaAmbiente(a.chiave, (x) => ({ ...x, quadro: q }))} />}
                {foglio.tipo === "elettrico" && !a.quadro && !(foglio.lavori?.some((l) => l.chiave === a.chiave) && !(a.scatole_3 || a.scatole_4) && !accessoriAmbiente(a, foglio.serie).length) && <Scatole a={a} serie={foglio.serie} onCambia={(s3, s4) => cambiaAmbiente(a.chiave, (x) => ({ ...x, scatole_3: s3, scatole_4: s4 }))} />}
                <div className="totale-ambiente"><span>Totale {a.nome}</span><b>{euro(totaleAmbiente(a, foglio.serie, pred))}</b></div>
              </div>
            ))}
          </div>
        </div>

        <aside className="riepilogo-foglio">
          <div className="titolo-tavolozza">Riepilogo</div>
          {foglio.ambienti.map((a) => <div key={a.chiave} className="riga-riepilogo"><span>{a.nome}</span><span>{euro(totaleAmbiente(a, foglio.serie, pred))}</span></div>)}
          <div className="ore-riepilogo">
            <div className="riga-riepilogo"><span>⏱ Ore di lavoro</span><b>{String(oreTotali).replace(".", ",")} h</b></div>
            <label className="riga-tariffa">Tariffa predefinita
              <select value={pred.nome} onChange={(e) => { const t = sceltaTariffa(e.target.value); if (t) cambia((x) => ({ ...x, tariffa_oraria: t.prezzo, tariffa_nome: t.nome })); }}>
                {!tariffeTipo.some((t) => t.nome === pred.nome) && <option value={pred.nome}>{pred.nome} · {euro(pred.prezzo)}/h</option>}
                {tariffeTipo.map((t) => <option key={t.id} value={t.nome}>{t.nome} · {euro(t.prezzo_ora)}/h</option>)}
              </select>
            </label>
            {perTariffa.map((t) => <div key={`${t.nome}${t.prezzo}`} className="riga-riepilogo piccola"><span>{t.nome}: {String(t.ore).replace(".", ",")} h × {euro(t.prezzo)}</span><span>{euro(t.ore * t.prezzo)}</span></div>)}
            <div className="riga-riepilogo"><span>Manodopera</span><b>{euro(perTariffa.reduce((s, t) => s + t.ore * t.prezzo, 0))}</b></div>
          </div>
          {foglio.tipo === "elettrico" && foglio.serie && (
            <div className="frutti-riepilogo">
              <span>🔌 Frutti {foglio.serie.nome}: {foglio.serie.frutti === undefined ? (idPreventivo ? "non calcolati" : "calcolo…") : `${Object.keys(foglio.serie.frutti).length} trovati`}</span>
              <button className="link" onClick={aggiornaFrutti} title="Ricerca di nuovo i frutti nel catalogo con i prezzi di oggi">{foglio.serie.frutti === undefined ? "Calcola" : "Aggiorna prezzi"}</button>
            </div>
          )}
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
          <button className="btn blu" onClick={impagina} title="Preventivo impaginato con logo: stanze con l'elenco dei punti, senza prezzi, totale in fondo"><FileText size={16} /> Impagina</button>
          <button className="btn grigio" onClick={() => setVediMateriali(true)}><Package size={16} /> Materiali da ordinare</button>
        </aside>
      </div>

      {chiediEsci && (
        <div className="velo" onMouseDown={() => setChiediEsci(false)}>
          <div className="finestra stretta" onMouseDown={(e) => e.stopPropagation()}>
            <div className="finestra-titolo">Chiudi il preventivo<button className="chiudi" onClick={() => setChiediEsci(false)}>×</button></div>
            <div className="finestra-corpo scelta-serie-soluzione">
              <p><b>{oggetto || NOMI_TIPO[foglio.tipo]}</b>{modificato ? " — ci sono modifiche non salvate" : id ? " — salvato" : " — non ancora salvato"}</p>
              <button type="button" className="btn blu" onClick={() => esci("salva")}><Save size={15} /> Salva ed esci</button>
              {(modificato || !id) && <button type="button" className="btn grigio" onClick={() => esci("senza")}>{id ? "Esci senza salvare le modifiche" : "Esci senza salvare"}</button>}
              {id && !modificato && <button type="button" className="btn grigio" onClick={() => esci("senza")}>Esci</button>}
              <button type="button" className="btn rosso" onClick={() => esci("elimina")}><Trash2 size={15} /> {id ? "Elimina il preventivo" : "Butta via"}</button>
              <button type="button" className="btn grigio" onClick={() => setChiediEsci(false)}>Annulla, resto qui</button>
              <span className="piccolo">Se vai in un'altra sezione senza uscire, il preventivo resta aperto e lo riprendi da dove eri.</span>
            </div>
          </div>
        </div>
      )}
      {chiediSerie && (
        <div className="velo" onMouseDown={() => setChiediSerie(false)}>
          <div className="finestra stretta" onMouseDown={(e) => e.stopPropagation()}>
            <div className="finestra-titolo">Nuova soluzione alternativa<button className="chiudi" onClick={() => setChiediSerie(false)}>×</button></div>
            <div className="finestra-corpo scelta-serie-soluzione">
              <div className="scelta-stanze">
                <button type="button" className={mantieniStanze ? "" : "attiva"} onClick={() => setMantieniStanze(false)}>Parti vuota</button>
                <button type="button" className={mantieniStanze ? "attiva" : ""} onClick={() => setMantieniStanze(true)} disabled={!foglio.ambienti.length}>
                  Mantieni le stanze{foglio.ambienti.length ? ` (${foglio.ambienti.length})` : ""}</button>
              </div>
              <span className="piccolo">{mantieniStanze ? "Le stanze con i loro punti e le ore vengono copiate: poi le modifichi solo nella nuova soluzione." : "La nuova soluzione non ha stanze: la riempi da capo."}</span>
              {foglio.tipo === "elettrico" ? <>
                <p>Che serie civile usa?</p>
                <button type="button" className="btn blu" onClick={() => creaSoluzione(foglio.serie ?? null)}>Mantieni la stessa{foglio.serie ? `: ${foglio.serie.nome}` : " (nessuna)"}</button>
                <div className="piccolo">oppure cambiala{mantieniStanze ? " (frutti, placche e supporti si ricalcolano con la nuova serie)" : ""}:</div>
                {serieCivili?.filter((x) => x.attiva && x.id !== foglio.serie?.id).map((x) => (
                  <button type="button" key={x.id} className="btn grigio" onClick={() => creaSoluzione(serieFoglio(x))}>{x.nome}</button>
                ))}
                <button type="button" className="btn grigio" onClick={() => creaSoluzione(null)}>Nessuna serie</button>
              </> : <button type="button" className="btn blu" onClick={() => creaSoluzione(undefined)}>Crea la soluzione</button>}
            </div>
          </div>
        </div>
      )}
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
        <span>Frutti e scatole{serie ? <small> · {serie.nome}</small> : null}</span>
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

// Stanza del quadro: incasso o esterno, moduli occupati e centralino scelto (sempre almeno il 40% libero)
function QuadroBox({ a, contenitoriAttuali, onCambia }: { a: AmbienteFoglio; contenitoriAttuali: Contenitore[]; onCambia: (q: NonNullable<AmbienteFoglio["quadro"]>) => void }) {
  const q = a.quadro!;
  const occupati = moduliQuadro(a), serve = moduliNecessari(a);
  const c = centralinoQuadro(a);
  const delTipo = q.contenitori.filter((x) => x.tipo === q.tipo);
  const massimo = Math.max(0, ...delTipo.map((x) => x.moduli));
  const libero = c ? Math.round((1 - occupati / c.moduli) * 100) : 0;
  return (
    <div className="scatole-ambiente quadro-ambiente">
      <div className="riga-scatole">
        <span>Centralino</span>
        <span className="scelta-quadro" role="group" aria-label="Tipo di quadro">
          {(["incasso", "esterno"] as const).map((t) => (
            <button key={t} type="button" className={q.tipo === t ? "attiva" : ""} onClick={() => onCambia({ ...q, tipo: t })}>{t === "incasso" ? "Da incasso" : "Esterno"}</button>
          ))}
        </span>
      </div>
      <div className={`moduli-scatole${!c && occupati ? " pochi" : ""}`}>
        {occupati} moduli occupati · con il {Math.round(SPAZIO_LIBERO * 100)}% libero servono almeno {serve} moduli
      </div>
      {c ? (
        <div className="voce-foglio auto" title={c.materiale ?? "Prezzo scritto in Impianti tipo"}>
          <span className="nome-voce">{c.nome}{c.materiale ? "" : " (prezzo a mano)"} · {libero}% libero</span>
          <span className="quantita-auto">1</span>
          <span className="prezzo-auto">{String(c.prezzo).replace(".", ",")}</span>
          <span className="totale-voce">{euro(c.prezzo)}</span>
          <span />
        </div>
      ) : occupati > 0 && (
        <div className="moduli-scatole pochi">{delTipo.length ? `⚠ Servono ${serve} moduli: il centralino più grande è da ${massimo}. Dividi in due quadri o aggiungi una misura più grande in Impianti tipo.` : "⚠ Nessun centralino di questo tipo: aggiungili in Impianti tipo (script 0053)."}</div>
      )}
      {!q.contenitori.length && contenitoriAttuali.length > 0 && (
        <button className="link" onClick={() => onCambia({ ...q, contenitori: contenitoriAttuali })}>Carica i centralini</button>
      )}
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
