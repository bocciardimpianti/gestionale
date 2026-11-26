import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, FileOutput, Printer, ChevronDown, ChevronRight, ExternalLink, RefreshCw, Search } from "lucide-react";
import Scheda from "../components/Scheda";
import { ARCHIVI } from "../archivi";
import { dataIt, supabase } from "../supabase";
import { useAuth } from "../auth";
import { controllaConti } from "../notifiche";
import { stampaConto, type OpzioniConto, type PiedePreventivo } from "../stampe";
import { serviziRapporto } from "../dividiRapportino";
import { fatturaEasyfatt, scaricaEasyfatt, type RigaFattura } from "../easyfatt";

// Conti Clienti: per ogni cliente il totale dei rapportini eseguiti e non ancora riscossi (casella "Pagata"),
// dal più alto. Soglia di avviso (2500 € per tutti, modificabile anche per singolo cliente): oltre la soglia
// il cliente è in rosso, nel menu compare il numero di clienti oltre soglia e arriva una notifica.

// non_approvato: preventivi non approvati dei rapportini divisi (script 0061). Si vedono a parte, in arancione:
// non entrano nel "Da riscuotere" né nella soglia, ma il cliente li ha in sospeso.
type Conto = { cliente_id: number; cliente: string; telefono: string | null; rapporti: number; totale: number; non_approvato: number; conteggiato: number; conteggiato_dal: string | null; dal: string; al: string;
  soglia: number; soglia_personale: boolean; oltre: boolean };
type Rapporto = { id: number; numero: number | null; data: string; tecnico: string | null; attivita: string | null; importo: number; non_approvato: number; fatto_conto: string | null; conteggiato_il?: string | null };

type Filtro = "conteggiati" | "non" | "tutti";
// Giorni passati da una data (aaaa-mm-gg) a oggi
const giorniDa = (d: string | null | undefined) => {
  if (!d) return null;
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((oggi.getTime() - new Date(d + "T00:00:00").getTime()) / 86400000));
};
// Colore dei giorni dal conto: verde fino a 30, arancio fino a 60, rosso oltre
const classeGiorni = (g: number) => (g > 60 ? "giorni-rosso" : g > 30 ? "giorni-arancio" : "giorni-verde");
const euro = (v: number) => Number(v ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const numero = (s: string) => Number(s.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));

export default function ContiClienti() {
  const { profilo, puo } = useAuth();
  const admin = profilo?.ruolo === "admin";
  const puoModificare = puo("conti_clienti", "modificare") || puo("rapporti", "modificare");
  // Rapportino aperto sopra questa pagina (senza cambiare sezione)
  const [scheda, setScheda] = useState<Record<string, unknown> | null>(null);
  const apriRapporto = async (id: number) => {
    const cfg = ARCHIVI.rapporti;
    const { data, error } = await supabase.from(cfg.tabella).select(cfg.select ?? "*").eq("id", id).single();
    if (error || !data) return setStato("Errore: " + (error?.message ?? "rapportino non trovato"));
    const r = data as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(r)) if (v && typeof v === "object" && "nome" in v) r[k] = (v as { nome: unknown }).nome;
    setScheda(r);
  };
  // Dopo una modifica al rapportino si ricaricano il conto e, se aperto, l'elenco del cliente
  const ricarica = async () => {
    const clienteAperto = (conti ?? []).find((c) => c.cliente_id === aperto);
    await carica();
    if (clienteAperto) {
      const { data } = await supabase.rpc("rapporti_da_riscuotere_cliente", { p_cliente: clienteAperto.cliente_id });
      setRapporti(((data ?? []) as Rapporto[]).map((r) => ({ ...r, importo: Number(r.importo), non_approvato: Number(r.non_approvato ?? 0) })));
    }
  };
  const [conti, setConti] = useState<Conto[] | null>(null);
  const [errore, setErrore] = useState("");
  const [stato, setStato] = useState("");
  const [cerca, setCerca] = useState("");
  const [soloOltre, setSoloOltre] = useState(false);
  const [aperto, setAperto] = useState<number | null>(null);
  const [rapporti, setRapporti] = useState<Rapporto[] | null>(null);
  const [scelti, setScelti] = useState<Set<number>>(new Set());
  const [sogliaGenerale, setSogliaGenerale] = useState<string>("");

  const carica = useCallback(async () => {
    const { data, error } = await supabase.rpc("conti_clienti");
    if (error) {
      setConti([]);
      return setErrore(/failed to fetch|network|load failed/i.test(error.message)
        ? "Connessione assente o interrotta: controlla la rete e premi il pulsante ↻ qui sopra."
        : /conti_clienti|function/i.test(error.message) ? "Esegui su Supabase lo script 0040_conti_clienti.sql" : error.message);
    }
    setErrore("");
    setConti(((data ?? []) as Conto[]).map((c) => ({ ...c, totale: Number(c.totale), non_approvato: Number(c.non_approvato ?? 0), conteggiato: Number(c.conteggiato ?? 0), soglia: Number(c.soglia) })));
    const { data: s } = await supabase.rpc("soglia_conto_predefinita");
    if (s != null) setSogliaGenerale(String(s).replace(".", ","));
    controllaConti();
  }, []);
  useEffect(() => { carica(); }, [carica]);

  const apri = async (c: Conto) => {
    if (aperto === c.cliente_id) { setAperto(null); return; }
    setAperto(c.cliente_id); setRapporti(null); setScelti(new Set()); setPagatiOra(new Set());
    const { data, error } = await supabase.rpc("rapporti_da_riscuotere_cliente", { p_cliente: c.cliente_id });
    if (error) return setStato("Errore: " + error.message);
    setRapporti(((data ?? []) as Rapporto[]).map((r) => ({ ...r, importo: Number(r.importo), non_approvato: Number(r.non_approvato ?? 0) })));
  };

  const riscuoti = async (ids: number[], cliente: string) => {
    if (!ids.length) return;
    const tot = (rapporti ?? []).filter((r) => ids.includes(r.id)).reduce((s, r) => s + r.importo, 0);
    if (!confirm(`Segnare come riscossi ${ids.length} ${ids.length === 1 ? "rapportino" : "rapportini"} di ${cliente} (${euro(tot)})?\nNei rapportini verrà spuntato "Pagata" con la data di oggi.`)) return;
    const { data, error } = await supabase.rpc("segna_riscossi", { p_rapporti: ids });
    if (error) return setStato("Errore: " + error.message);
    setStato(`${data} ${data === 1 ? "rapportino segnato" : "rapportini segnati"} come riscossi (${euro(tot)})`);
    setAperto(null);
    carica();
  };

  // Spunta "Pagato" sul singolo rapportino: resta nell'elenco barrato finché non si chiude il cliente (così si può togliere)
  const [pagatiOra, setPagatiOra] = useState<Set<number>>(new Set());
  const segnaPagato = async (r: Rapporto, si: boolean) => {
    const { error } = si
      ? await supabase.rpc("segna_riscossi", { p_rapporti: [r.id] })
      : await supabase.from("rapporti").update({ pagata: false, data_pagamento: null }).eq("id", r.id);
    if (error) return setStato("Errore: " + error.message);
    setPagatiOra((x) => { const n = new Set(x); if (si) n.add(r.id); else n.delete(r.id); return n; });
    setScelti((x) => { const n = new Set(x); n.delete(r.id); return n; });
    setStato(si ? `Rapportino n. ${r.numero} segnato pagato (${euro(r.importo)})` : `Rapportino n. ${r.numero}: tolto "pagato"`);
    carica();
  };

  // "Già conteggiato" (Fatto conto = Si): il rapportino resta da riscuotere, ma si sa che è già nel conto fatto al cliente
  const conteggiato = (r: Rapporto) => /^s/i.test(r.fatto_conto ?? "");
  // Data del conto: oggi, oppure quella di un conto già fatto per il cliente (rapportino dimenticato)
  const [chiediData, setChiediData] = useState<{ ids: number[]; conti: { data: string; n: number; tot: number }[] } | null>(null);
  const chiediConto = (ids: number[]) => {
    const conti = new Map<string, { data: string; n: number; tot: number }>();
    for (const r of (rapporti ?? []).filter((r) => conteggiato(r) && r.conteggiato_il && !pagatiOra.has(r.id))) {
      const c = conti.get(r.conteggiato_il!) ?? { data: r.conteggiato_il!, n: 0, tot: 0 };
      c.n++; c.tot += r.importo; conti.set(c.data, c);
    }
    if (!conti.size) return segnaConteggiati(ids, true);
    setChiediData({ ids, conti: [...conti.values()].sort((a, b) => b.data.localeCompare(a.data)) });
  };
  const segnaConteggiati = async (ids: number[], si: boolean, dataConto?: string) => {
    if (!ids.length) return;
    setChiediData(null);
    const { data, error } = await supabase.rpc("segna_conteggiati", { p_rapporti: ids, p_conteggiati: si, ...(dataConto ? { p_data: dataConto } : {}) });
    if (error) return setStato(/segna_conteggiati|function/i.test(error.message) ? `Esegui su Supabase lo script ${dataConto ? "0063" : "0061"}` : "Errore: " + error.message);
    setStato(`${data} ${data === 1 ? "rapportino segnato" : "rapportini segnati"} ${si ? "già conteggiati" : "da conteggiare"}`);
    setScelti(new Set());
    await ricarica();
  };

  // Stampa del conto per il cliente: si scelgono i rapportini (di partenza i già conteggiati) e cosa mettere
  const [sceltaStampa, setSceltaStampa] = useState<{ c: Conto; ids: Set<number>; filtro: Filtro } & OpzioniConto | null>(null);
  const apriStampa = (c: Conto) => {
    const lista = (rapporti ?? []).filter((r) => !pagatiOra.has(r.id));
    const cont = lista.filter(conteggiato);
    setSceltaStampa({ c, filtro: cont.length ? "conteggiati" : "tutti", ids: new Set((cont.length ? cont : lista).map((r) => r.id)), materiali: true, prezzi: false, nonApprovati: lista.some((r) => r.non_approvato > 0) });
  };
  const passa = (r: Rapporto, f: Filtro) => f === "tutti" || (f === "conteggiati") === conteggiato(r);
  const stampa = async () => {
    if (!sceltaStampa) return;
    const { c, ids, filtro: _f, ...opzioni } = sceltaStampa;
    const lista = (rapporti ?? []).filter((r) => ids.has(r.id) && !pagatiOra.has(r.id) && passa(r, sceltaStampa.filtro));
    if (!lista.length) return;
    const finestra = window.open("", "_blank");
    if (!finestra) return setStato("Il browser ha bloccato la finestra di stampa: consenti i popup per il gestionale");
    finestra.document.write("<p style='font-family: sans-serif'>Preparazione della stampa…</p>");
    const [{ data: righe }, { data: dati }, { data: imp }] = await Promise.all([
      supabase.from("righe_rapporto").select("rapporto_id, descrizione, nome_articolo, quantita, unita_misura, totale, non_approvato, ordine")
        .in("rapporto_id", lista.map((r) => r.id)).order("ordine"),
      supabase.from("rapporti").select("id, totale_ore, tariffa_oraria, km_percorsi, tariffa_km, diritto_chiamata, tariffa_fissa, servizi_non_approvati").in("id", lista.map((r) => r.id)),
      supabase.from("impostazioni").select("valore").eq("chiave", "preventivo_piede").maybeSingle(),
    ]);
    const voci = (id: number, no: boolean) => ((righe ?? []) as Record<string, unknown>[])
      .filter((x) => x.rapporto_id === id && !!x.non_approvato === no && String(x.descrizione || x.nome_articolo || "").trim())
      .map((x) => ({ descrizione: String(x.descrizione || x.nome_articolo), quantita: x.quantita as number | null, unita_misura: x.unita_misura as string | null, totale: x.totale as number | null }));
    const html = stampaConto(c.cliente, lista.map((r) => {
      const d = ((dati ?? []) as Record<string, unknown>[]).find((x) => x.id === r.id) ?? {};
      const servizi = serviziRapporto(d).filter((x) => x.nonApprovato)
        .map((x) => ({ descrizione: x.nome + (x.dettaglio ? ` (${x.dettaglio})` : ""), quantita: null, unita_misura: null, totale: x.importo }));
      return { numero: r.numero, data: r.data, attivita: r.attivita, importo: r.importo, materiali: voci(r.id, false), nonApprovati: [...voci(r.id, true), ...servizi] };
    }), (imp?.valore as PiedePreventivo | undefined) ?? null, opzioni);
    finestra.document.open(); finestra.document.write(html); finestra.document.close();
    setSceltaStampa(null);
  };

  // Fattura per Danea Easy Fatt (file Easyfatt-XML da importare): rapportini scelti, righe riassunte o dettagliate, IVA a scelta
  type SceltaEf = { c: Conto; ids: Set<number>; filtro: Filtro; modo: "riassunta" | "dettagliata"; ivaMateriali: number; ivaManodopera: number };
  const [sceltaEf, setSceltaEf] = useState<SceltaEf | null>(null);
  const apriEasyfatt = (c: Conto) => {
    const lista = (rapporti ?? []).filter((r) => !pagatiOra.has(r.id));
    const cont = lista.filter(conteggiato);
    setSceltaEf({ c, filtro: cont.length ? "conteggiati" : "tutti", ids: new Set((cont.length ? cont : lista).map((r) => r.id)), modo: "riassunta", ivaMateriali: 22, ivaManodopera: 22 });
  };
  const preparaEasyfatt = async () => {
    if (!sceltaEf) return;
    const s = sceltaEf;
    const lista = (rapporti ?? []).filter((r) => s.ids.has(r.id) && !pagatiOra.has(r.id) && passa(r, s.filtro));
    if (!lista.length) return;
    setStato("Preparazione della fattura per Easy Fatt…");
    const ids = lista.map((r) => r.id);
    const [{ data: cli, error: e1 }, { data: dati }, { data: righe }] = await Promise.all([
      supabase.from("clienti").select("nome, codice_fiscale, piva, email, indirizzo_fatturazione, tipologia_pagamento").eq("id", s.c.cliente_id).maybeSingle(),
      supabase.from("rapporti").select("id, totale_ore, tariffa_oraria, km_percorsi, tariffa_km, diritto_chiamata, tariffa_fissa, servizi_non_approvati, considera_totale_preventivo, totale_preventivo, azzera_imponibile").in("id", ids),
      supabase.from("righe_rapporto").select("rapporto_id, descrizione, nome_articolo, quantita, unita_misura, prezzo_finale, totale, non_approvato, ordine").in("rapporto_id", ids).order("ordine"),
    ]);
    if (e1 || !cli) return setStato("Errore: cliente non trovato " + (e1?.message ?? ""));
    const out: RigaFattura[] = [];
    for (const r of [...lista].sort((a, b) => a.data.localeCompare(b.data))) {
      const d = ((dati ?? []) as Record<string, unknown>[]).find((x) => x.id === r.id) ?? {};
      out.push({ descrizione: `Intervento del ${dataIt(r.data)} (rapportino n. ${r.numero ?? ""})${r.attivita ? ": " + r.attivita.trim() : ""}` });
      if (d.azzera_imponibile) continue;
      if (d.considera_totale_preventivo) { out.push({ descrizione: "Importo concordato", prezzo: Number(d.totale_preventivo ?? 0), iva: s.ivaMateriali }); continue; }
      const mat = ((righe ?? []) as Record<string, unknown>[]).filter((x) => x.rapporto_id === r.id && !x.non_approvato && (Number(x.totale) || String(x.descrizione || x.nome_articolo || "").trim()));
      const servizi = serviziRapporto(d).filter((x) => !x.nonApprovato);
      if (s.modo === "riassunta") {
        const totMat = mat.reduce((t, x) => t + Number(x.totale ?? 0), 0);
        const totServ = servizi.reduce((t, x) => t + x.importo, 0);
        if (totMat) out.push({ descrizione: "Materiale", prezzo: Math.round(totMat * 100) / 100, iva: s.ivaMateriali });
        if (totServ) out.push({ descrizione: "Manodopera", prezzo: Math.round(totServ * 100) / 100, iva: s.ivaManodopera });
      } else {
        for (const x of mat) out.push({ descrizione: String(x.descrizione || x.nome_articolo || "Materiale"), quantita: Number(x.quantita ?? 1) || 1, um: (x.unita_misura as string) ?? "",
          prezzo: Number(x.prezzo_finale ?? (Number(x.totale ?? 0) / (Number(x.quantita) || 1))), iva: s.ivaMateriali });
        for (const x of servizi) out.push({ descrizione: x.nome.replace(/\s*\(.*\)$/, "") + (x.dettaglio ? ` (${x.dettaglio})` : ""), prezzo: x.importo, iva: s.ivaManodopera });
      }
    }
    scaricaEasyfatt(fatturaEasyfatt(cli as Parameters<typeof fatturaEasyfatt>[0], out), `Fattura ${s.c.cliente} ${new Date().toLocaleDateString("it-IT").replace(/\//g, "-")}`);
    setStato(`File per Easy Fatt scaricato (${lista.length} ${lista.length === 1 ? "rapportino" : "rapportini"}): importalo in Easy Fatt e controlla la fattura prima di emetterla`);
    setSceltaEf(null);
  };

  const cambiaSoglia = async (c: Conto, testo: string) => {
    const t = testo.trim();
    const valore = t === "" ? null : numero(t);
    if (valore !== null && (Number.isNaN(valore) || valore < 0)) return setStato("Soglia non valida");
    if (valore === (c.soglia_personale ? c.soglia : null)) return;
    const { error } = await supabase.rpc("imposta_soglia_conto", { p_cliente: c.cliente_id, p_soglia: valore });
    if (error) return setStato("Errore: " + error.message);
    setStato(valore === null ? `${c.cliente}: torna alla soglia generale` : `${c.cliente}: avviso oltre ${euro(valore)}`);
    carica();
  };

  const cambiaSogliaGenerale = async () => {
    const v = numero(sogliaGenerale);
    if (Number.isNaN(v) || v < 0) return setStato("Soglia non valida");
    const { error } = await supabase.rpc("imposta_soglia_conto_predefinita", { p_soglia: v });
    if (error) return setStato("Errore: " + error.message);
    setStato(`Soglia generale: ${euro(v)} (vale per i clienti senza una soglia propria)`);
    carica();
  };

  const visibili = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return (conti ?? []).filter((c) => (!soloOltre || c.oltre) && (!q || c.cliente.toLowerCase().includes(q)));
  }, [conti, cerca, soloOltre]);
  const totale = (conti ?? []).reduce((s, c) => s + c.totale, 0);
  const totaleNo = (conti ?? []).reduce((s, c) => s + c.non_approvato, 0);
  const conPrev = (conti ?? []).filter((c) => c.non_approvato > 0).length;
  const oltre = (conti ?? []).filter((c) => c.oltre);

  return (
    <div className="pagina-conti">
      <div className="testata">
        <h1><span className="icona-titolo"><Banknote size={20} strokeWidth={2} /></span>Conti Clienti</h1>
        <div className="ricerca">
          <label><Search size={16} /><input type="search" placeholder="Cerca un cliente…" value={cerca} onChange={(e) => setCerca(e.target.value)} /></label>
        </div>
        <div className="pulsanti">
          <button className="btn grigio" onClick={() => { setConti(null); carica(); }} title="Aggiorna"><RefreshCw size={16} /></button>
        </div>
      </div>

      {errore && <p className="errore">{errore}</p>}
      {stato && <p className={stato.startsWith("Errore") ? "errore" : "ok"}>{stato}</p>}

      <div className="riepilogo-conti">
        <div className="carta-conto"><span>Da riscuotere in totale</span><b>{euro(totale)}</b><small>{conti?.length ?? 0} clienti</small></div>
        <div className="carta-conto prev-na"><span>Preventivi non approvati</span><b>{euro(totaleNo)}</b><small>{conPrev ? `${conPrev} ${conPrev === 1 ? "cliente" : "clienti"} · non compresi nel da riscuotere` : "nessuno"}</small></div>
        <button className={`carta-conto${oltre.length ? " allarme" : ""}${soloOltre ? " attiva" : ""}`} onClick={() => setSoloOltre(!soloOltre)}
          title={soloOltre ? "Mostra tutti i clienti" : "Mostra solo i clienti oltre la soglia"}>
          <span>{oltre.length ? <><AlertTriangle size={15} /> Oltre la soglia</> : "Oltre la soglia"}</span>
          <b>{oltre.length}</b><small>{oltre.length ? euro(oltre.reduce((s, c) => s + c.totale, 0)) : "nessun cliente"}{soloOltre ? " · solo questi" : ""}</small>
        </button>
        <div className="carta-conto">
          <span>Soglia di avviso generale</span>
          {admin ? (
            <span className="campo-soglia"><input inputMode="decimal" value={sogliaGenerale} onChange={(e) => setSogliaGenerale(e.target.value)}
              onBlur={cambiaSogliaGenerale} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label="Soglia generale" /> €</span>
          ) : <b>{sogliaGenerale} €</b>}
          <small>per ogni cliente, salvo soglia propria</small>
        </div>
      </div>

      {!conti && !errore && <p className="piccolo">Caricamento…</p>}
      {conti && !conti.length && !errore && <p className="vuoto-linguetta">Nessun rapportino da riscuotere. 👍</p>}

      {visibili.length > 0 && (
        <table className="griglia tabella-conti">
          <thead><tr><th /><th>Cliente</th><th className="destra">Rapportini</th><th>Dal</th><th className="destra">Da riscuotere</th><th className="destra" title="Giorni passati da quando hai segnato conteggiati i rapportini (il più vecchio ancora da pagare)">Giorni dal conto</th><th className="destra">Prev. non approvati</th><th>Soglia</th></tr></thead>
          <tbody>
            {visibili.map((c) => (
              <Fragment key={c.cliente_id}>
                <tr className={`${c.oltre ? "oltre" : ""}${aperto === c.cliente_id ? " aperto" : ""}`} onClick={() => apri(c)}>
                  <td className="freccia">{aperto === c.cliente_id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                  <td>
                    <b>{c.cliente}</b>{c.oltre && <span className="bollino-oltre"><AlertTriangle size={13} /> oltre la soglia</span>}
                    {c.telefono && <div className="piccolo">{c.telefono}</div>}
                  </td>
                  <td className="destra">{c.rapporti}</td>
                  <td>{dataIt(c.dal)}</td>
                  <td className="destra importo-conto">
                    <b>{euro(c.totale)}</b>
                    <span className="barra-soglia"><span style={{ width: `${Math.min(100, (c.totale / Math.max(c.soglia, 1)) * 100)}%` }} /></span>
                    {c.conteggiato > 0 && <small className="gia-conteggiato">di cui già conteggiati {euro(c.conteggiato)}</small>}
                  </td>
                  <td className="destra giorni-conto">{(() => { const g = giorniDa(c.conteggiato_dal); return g === null ? "" : <span className={`bollino-giorni ${classeGiorni(g)}`} title={`Conteggiati dal ${dataIt(c.conteggiato_dal)}`}>{g} {g === 1 ? "giorno" : "giorni"}</span>; })()}</td>
                  <td className="destra importo-na">{c.non_approvato > 0 ? <span className="bollino-na">{euro(c.non_approvato)}</span> : ""}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {puoModificare ? (
                      <span className="campo-soglia">
                        <input inputMode="decimal" defaultValue={c.soglia_personale ? String(c.soglia).replace(".", ",") : ""} placeholder={String(c.soglia).replace(".", ",")}
                          title="Vuoto = soglia generale" aria-label={`Soglia di ${c.cliente}`}
                          onBlur={(e) => cambiaSoglia(c, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} /> €
                        {c.soglia_personale && <span className="piccolo"> propria</span>}
                      </span>
                    ) : <>{euro(c.soglia)}</>}
                  </td>
                </tr>
                {aperto === c.cliente_id && (
                  <tr className="dettaglio-conto"><td colSpan={8}>
                    {!rapporti && <p className="piccolo">Caricamento…</p>}
                    {rapporti && (
                      <>
                        <table className="griglia rapporti-conto">
                          <thead><tr>
                            {puoModificare && <th><input type="checkbox" aria-label="Tutti" checked={scelti.size === rapporti.length && rapporti.length > 0}
                              onChange={(e) => setScelti(e.target.checked ? new Set(rapporti.map((r) => r.id)) : new Set())} /></th>}
                            <th>N.</th><th>Data</th><th>Tecnico</th><th>Attività</th><th>Conteggiato</th><th className="destra">Importo</th><th className="destra">Prev. non appr.</th><th className="centro">Pagato</th><th />
                          </tr></thead>
                          <tbody>
                            {rapporti.map((r) => (
                              <tr key={r.id} className={`${conteggiato(r) ? "conteggiato" : ""}${pagatiOra.has(r.id) ? " pagato-ora" : ""}`}>
                                {puoModificare && <td className="sel"><input type="checkbox" disabled={pagatiOra.has(r.id)} checked={scelti.has(r.id) && !pagatiOra.has(r.id)} aria-label={`Rapportino ${r.numero}`}
                                  onChange={(e) => setScelti((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>}
                                <td className="num">n. {r.numero}</td>
                                <td className="data">{dataIt(r.data)}</td>
                                <td className="cella-tecnico tec">{r.tecnico}</td>
                                <td className="attivita-conto" title={r.attivita ?? ""}>{r.attivita}</td>
                                <td className="fatto">{conteggiato(r) ? <span className="bollino-conteggiato">✓ già conteggiato</span> : ""}
                                  {conteggiato(r) && r.conteggiato_il && (() => { const g = giorniDa(r.conteggiato_il)!; return <span className={`data-conteggio ${classeGiorni(g)}`}>il {dataIt(r.conteggiato_il)} · {g} gg</span>; })()}</td>
                                <td className="destra imp">{r.importo ? euro(r.importo) : ""}</td>
                                <td className="destra imp-na">{r.non_approvato > 0 ? <span className="bollino-na">{euro(r.non_approvato)}</span> : ""}</td>
                                <td className="pagato centro">
                                  <label className="spunta-pagato" title={pagatiOra.has(r.id) ? "Pagato: togli la spunta se è un errore" : "Segna questo rapportino come pagato"}>
                                    <input type="checkbox" disabled={!puoModificare} checked={pagatiOra.has(r.id)} onChange={(e) => segnaPagato(r, e.target.checked)} />
                                    <span>{pagatiOra.has(r.id) ? "Pagato" : ""}</span>
                                  </label>
                                </td>
                                <td className="apri"><button className="link" title="Apri il rapportino" onClick={() => apriRapporto(r.id)}><ExternalLink size={15} /></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {puoModificare && (
                          <div className="azioni-conto">
                            <button className="btn blu" disabled={!scelti.size} onClick={() => riscuoti([...scelti], c.cliente)}>
                              Segna riscossi {scelti.size ? `(${scelti.size} · ${euro(rapporti.filter((r) => scelti.has(r.id)).reduce((s, r) => s + r.importo, 0))})` : ""}
                            </button>
                            <button className="btn grigio" onClick={() => riscuoti(rapporti.map((r) => r.id), c.cliente)}>Riscosso tutto ({euro(c.totale)})</button>
                            <span className="separa-azioni" />
                            {/* Già conteggiati e stampa del conto: solo amministratori */}
                            {admin && (() => {
                              const sel = rapporti.filter((r) => scelti.has(r.id));
                              const daSegnare = sel.filter((r) => !conteggiato(r)).map((r) => r.id);
                              const daTogliere = sel.filter(conteggiato).map((r) => r.id);
                              return <>
                                <button className="btn verde-conteggio" disabled={!daSegnare.length} onClick={() => chiediConto(daSegnare)}>
                                  ✓ Segna già conteggiati{daSegnare.length ? ` (${daSegnare.length})` : ""}
                                </button>
                                {daTogliere.length > 0 && <button className="btn grigio" onClick={() => segnaConteggiati(daTogliere, false)}>Togli conteggiato ({daTogliere.length})</button>}
                                <button className="btn blu" title="Stampa il conto per il cliente: scegli i rapportini e cosa mettere" onClick={() => apriStampa(c)}>
                                  <Printer size={15} /> Stampa conto…
                                </button>
                                <button className="btn easyfatt" title="Prepara la fattura per Danea Easy Fatt con i rapportini scelti" onClick={() => apriEasyfatt(c)}>
                                  <FileOutput size={15} /> Easy Fatt…
                                </button>
                              </>;
                            })()}
                          </div>
                        )}
                      </>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {chiediData && (
        <div className="velo" onMouseDown={() => setChiediData(null)}>
          <div className="finestra finestra-data-conto" onMouseDown={(e) => e.stopPropagation()}>
            <div className="finestra-titolo">In quale conto metti {chiediData.ids.length === 1 ? "il rapportino" : `i ${chiediData.ids.length} rapportini`}?</div>
            <div className="finestra-corpo">
              <button className="dc-scelta oggi" onClick={() => segnaConteggiati(chiediData.ids, true)}>
                <b>Conto di oggi</b><span>{new Date().toLocaleDateString("it-IT")} · i giorni partono da oggi</span>
              </button>
              {chiediData.conti.map((c) => (
                <button key={c.data} className="dc-scelta" onClick={() => segnaConteggiati(chiediData.ids, true, c.data)}>
                  <b>Aggiungi al conto del {dataIt(c.data)}</b>
                  <span>{c.n} {c.n === 1 ? "rapportino" : "rapportini"} · {euro(c.tot)} · {giorniDa(c.data)} giorni fa</span>
                </button>
              ))}
            </div>
            <div className="finestra-piede"><span style={{ flex: 1 }} /><button className="btn grigio" onClick={() => setChiediData(null)}>Annulla</button></div>
          </div>
        </div>
      )}
      {sceltaEf && (() => {
        const s = sceltaEf;
        const lista = (rapporti ?? []).filter((r) => !pagatiOra.has(r.id));
        const visibili3 = lista.filter((r) => passa(r, s.filtro));
        const scelti3 = visibili3.filter((r) => s.ids.has(r.id));
        const cambia = (v: Partial<SceltaEf>) => setSceltaEf({ ...s, ...v });
        const iva = (chiave: "ivaMateriali" | "ivaManodopera") => (
          <span className="ef-iva">{[22, 10].map((v) => <button key={v} className={s[chiave] === v ? "attivo" : ""} onClick={() => cambia({ [chiave]: v })}>{v}%</button>)}</span>
        );
        return (
          <div className="velo" onMouseDown={() => setSceltaEf(null)}>
            <div className="finestra finestra-stampa-conto" onMouseDown={(e) => e.stopPropagation()}>
              <div className="finestra-titolo">Fattura per Easy Fatt – {s.c.cliente}</div>
              <div className="finestra-corpo">
                <div className="sc-rapidi">
                  <b>Rapportini da fatturare</b>
                  <span style={{ flex: 1 }} />
                  {(["conteggiati", "non", "tutti"] as Filtro[]).map((f) => (
                    <button key={f} className={`sc-filtro${s.filtro === f ? " attivo" : ""}`}
                      onClick={() => cambia({ filtro: f, ids: new Set(lista.filter((r) => passa(r, f)).map((r) => r.id)) })}>
                      {{ conteggiati: "Già conteggiati", non: "Non conteggiati", tutti: "Tutti" }[f]} ({lista.filter((r) => passa(r, f)).length})
                    </button>
                  ))}
                </div>
                {visibili3.map((r) => (
                  <label key={r.id} className={`sc-voce${s.ids.has(r.id) ? " scelta" : ""}`}>
                    <input type="checkbox" checked={s.ids.has(r.id)} onChange={() => { const n = new Set(s.ids); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); cambia({ ids: n }); }} />
                    <span className="sc-testi"><b>n. {r.numero} · {dataIt(r.data)}</b><span className="piccolo">{r.attivita}</span></span>
                    <span className="sc-importi"><b>{r.importo ? euro(r.importo) : ""}</b></span>
                  </label>
                ))}
                {!visibili3.length && <p className="vuoto-linguetta">Nessun rapportino in questo gruppo.</p>}
                <div className="sc-opzioni">
                  <b>Righe della fattura</b>
                  <label><input type="radio" name="ef-modo" checked={s.modo === "riassunta"} onChange={() => cambia({ modo: "riassunta" })} /> Riassunta: per ogni rapportino l'attività, poi "Materiale" e "Manodopera" con i totali</label>
                  <label><input type="radio" name="ef-modo" checked={s.modo === "dettagliata"} onChange={() => cambia({ modo: "dettagliata" })} /> Dettagliata: ogni materiale con quantità e prezzo, poi manodopera, diritto di chiamata e trasferta</label>
                  <b>IVA</b>
                  <div className="ef-righe-iva"><span>Materiale</span>{iva("ivaMateriali")}<span>Manodopera</span>{iva("ivaManodopera")}</div>
                  <span className="piccolo">I preventivi non approvati non vanno in fattura. Il numero della fattura lo dà Easy Fatt.</span>
                </div>
              </div>
              <div className="finestra-piede">
                <span className="piccolo">{scelti3.length} rapportini · imponibile {euro(scelti3.reduce((t, r) => t + r.importo, 0))}</span>
                <span style={{ flex: 1 }} />
                <button className="btn grigio" onClick={() => setSceltaEf(null)}>Annulla</button>
                <button className="btn blu" disabled={!scelti3.length} onClick={preparaEasyfatt}><FileOutput size={15} /> Scarica file per Easy Fatt</button>
              </div>
            </div>
          </div>
        );
      })()}
      {sceltaStampa && (() => {
        const s = sceltaStampa;
        const lista = (rapporti ?? []).filter((r) => !pagatiOra.has(r.id));
        const visibili2 = lista.filter((r) => passa(r, s.filtro));
        // Si stampano solo i rapportini spuntati e visibili nel gruppo scelto
        const scelti2 = visibili2.filter((r) => s.ids.has(r.id));
        const cambia = (v: Partial<typeof s>) => setSceltaStampa({ ...s, ...v });
        const tocca = (id: number) => { const n = new Set(s.ids); if (n.has(id)) n.delete(id); else n.add(id); cambia({ ids: n }); };
        return (
          <div className="velo" onMouseDown={() => setSceltaStampa(null)}>
            <div className="finestra finestra-stampa-conto" onMouseDown={(e) => e.stopPropagation()}>
              <div className="finestra-titolo">Stampa conto – {s.c.cliente}</div>
              <div className="finestra-corpo">
                <div className="sc-rapidi">
                  <b>Rapportini da stampare</b>
                  <span style={{ flex: 1 }} />
                  {/* Mostra solo quel gruppo e lo sceglie tutto (poi si toglie a mano quello che non serve) */}
                  {(["conteggiati", "non", "tutti"] as Filtro[]).map((f) => (
                    <button key={f} className={`sc-filtro${s.filtro === f ? " attivo" : ""}`}
                      onClick={() => cambia({ filtro: f, ids: new Set(lista.filter((r) => passa(r, f)).map((r) => r.id)) })}>
                      {{ conteggiati: "Già conteggiati", non: "Non conteggiati", tutti: "Tutti" }[f]} ({lista.filter((r) => passa(r, f)).length})
                    </button>
                  ))}
                </div>
                <div className="sc-tutti">
                  <button className="link" onClick={() => cambia({ ids: new Set([...s.ids, ...visibili2.map((r) => r.id)]) })}>Spunta tutti</button>
                  <button className="link" onClick={() => cambia({ ids: new Set() })}>Togli tutte le spunte</button>
                </div>
                {!visibili2.length && <p className="vuoto-linguetta">Nessun rapportino in questo gruppo.</p>}
                {visibili2.map((r) => (
                  <label key={r.id} className={`sc-voce${s.ids.has(r.id) ? " scelta" : ""}`}>
                    <input type="checkbox" checked={s.ids.has(r.id)} onChange={() => tocca(r.id)} />
                    <span className="sc-testi"><b>n. {r.numero} · {dataIt(r.data)}</b>{conteggiato(r) && <span className="bollino-conteggiato">✓ già conteggiato</span>}
                      <span className="piccolo">{r.attivita}</span></span>
                    <span className="sc-importi"><b>{r.importo ? euro(r.importo) : ""}</b>{r.non_approvato > 0 && <span className="bollino-na">{euro(r.non_approvato)}</span>}</span>
                  </label>
                ))}
                <div className="sc-opzioni">
                  <b>Cosa mettere in stampa</b>
                  <label><input type="checkbox" checked={s.materiali} onChange={(e) => cambia({ materiali: e.target.checked })} /> Elenco dei materiali di ogni rapportino</label>
                  <label className={s.materiali ? "" : "spento"}><input type="checkbox" disabled={!s.materiali} checked={s.prezzi && s.materiali} onChange={(e) => cambia({ prezzi: e.target.checked })} /> Prezzi dei materiali</label>
                  <label><input type="checkbox" checked={s.nonApprovati} onChange={(e) => cambia({ nonApprovati: e.target.checked })} /> Preventivi non approvati <span className="piccolo">(a parte, fuori dal totale)</span></label>
                </div>
              </div>
              <div className="finestra-piede">
                <span className="piccolo">{scelti2.length} rapportini · totale {euro(scelti2.reduce((t, r) => t + r.importo, 0))}
                  {s.nonApprovati && scelti2.some((r) => r.non_approvato > 0) ? ` · non approvati ${euro(scelti2.reduce((t, r) => t + r.non_approvato, 0))}` : ""}</span>
                <span style={{ flex: 1 }} />
                <button className="btn grigio" onClick={() => setSceltaStampa(null)}>Annulla</button>
                <button className="btn blu" disabled={!scelti2.length} onClick={stampa}><Printer size={15} /> Stampa</button>
              </div>
            </div>
          </div>
        );
      })()}
      {scheda && (
        <Scheda
          cfg={ARCHIVI.rapporti}
          valori={scheda}
          cartelle={[]}
          nelCestino={false}
          onChiudi={() => setScheda(null)}
          onSalvato={() => { setScheda(null); ricarica(); }}
          onElimina={async () => {
            if (!confirm("Spostare il rapportino nel Cestino?")) return;
            const { error } = await supabase.from("rapporti").update({ eliminato_il: new Date().toISOString() }).eq("id", scheda.id);
            if (error) return setStato("Errore: " + error.message);
            setScheda(null);
            ricarica();
          }}
          onSposta={() => {}}
        />
      )}
    </div>
  );
}
