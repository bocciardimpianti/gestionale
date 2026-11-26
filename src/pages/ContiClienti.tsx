import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, ChevronDown, ChevronRight, ExternalLink, RefreshCw, Search } from "lucide-react";
import Scheda from "../components/Scheda";
import { ARCHIVI } from "../archivi";
import { dataIt, supabase } from "../supabase";
import { useAuth } from "../auth";
import { controllaConti } from "../notifiche";

// Conti Clienti: per ogni cliente il totale dei rapportini eseguiti e non ancora riscossi (casella "Pagata"),
// dal più alto. Soglia di avviso (2500 € per tutti, modificabile anche per singolo cliente): oltre la soglia
// il cliente è in rosso, nel menu compare il numero di clienti oltre soglia e arriva una notifica.

// non_approvato: preventivi non approvati dei rapportini divisi (script 0061). Si vedono a parte, in arancione:
// non entrano nel "Da riscuotere" né nella soglia, ma il cliente li ha in sospeso.
type Conto = { cliente_id: number; cliente: string; telefono: string | null; rapporti: number; totale: number; non_approvato: number; conteggiato: number; dal: string; al: string;
  soglia: number; soglia_personale: boolean; oltre: boolean };
type Rapporto = { id: number; numero: number | null; data: string; tecnico: string | null; attivita: string | null; importo: number; non_approvato: number; fatto_conto: string | null };

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
    setAperto(c.cliente_id); setRapporti(null); setScelti(new Set());
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

  // "Già conteggiato" (Fatto conto = Si): il rapportino resta da riscuotere, ma si sa che è già nel conto fatto al cliente
  const conteggiato = (r: Rapporto) => /^s/i.test(r.fatto_conto ?? "");
  const segnaConteggiati = async (ids: number[], si: boolean) => {
    if (!ids.length) return;
    const { data, error } = await supabase.rpc("segna_conteggiati", { p_rapporti: ids, p_conteggiati: si });
    if (error) return setStato(/segna_conteggiati|function/i.test(error.message) ? "Esegui su Supabase lo script 0061" : "Errore: " + error.message);
    setStato(`${data} ${data === 1 ? "rapportino segnato" : "rapportini segnati"} ${si ? "già conteggiati" : "da conteggiare"}`);
    setScelti(new Set());
    await ricarica();
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
          <thead><tr><th /><th>Cliente</th><th className="destra">Rapportini</th><th>Dal</th><th className="destra">Da riscuotere</th><th className="destra">Prev. non approvati</th><th>Soglia</th></tr></thead>
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
                  <tr className="dettaglio-conto"><td colSpan={7}>
                    {!rapporti && <p className="piccolo">Caricamento…</p>}
                    {rapporti && (
                      <>
                        <table className="griglia rapporti-conto">
                          <thead><tr>
                            {puoModificare && <th><input type="checkbox" aria-label="Tutti" checked={scelti.size === rapporti.length && rapporti.length > 0}
                              onChange={(e) => setScelti(e.target.checked ? new Set(rapporti.map((r) => r.id)) : new Set())} /></th>}
                            <th>N.</th><th>Data</th><th>Tecnico</th><th>Attività</th><th>Conteggiato</th><th className="destra">Importo</th><th className="destra">Prev. non appr.</th><th />
                          </tr></thead>
                          <tbody>
                            {rapporti.map((r) => (
                              <tr key={r.id} className={conteggiato(r) ? "conteggiato" : ""}>
                                {puoModificare && <td className="sel"><input type="checkbox" checked={scelti.has(r.id)} aria-label={`Rapportino ${r.numero}`}
                                  onChange={(e) => setScelti((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>}
                                <td className="num">n. {r.numero}</td>
                                <td className="data">{dataIt(r.data)}</td>
                                <td className="cella-tecnico tec">{r.tecnico}</td>
                                <td className="attivita-conto" title={r.attivita ?? ""}>{r.attivita}</td>
                                <td className="fatto">{conteggiato(r) ? <span className="bollino-conteggiato">✓ già conteggiato</span> : ""}</td>
                                <td className="destra imp">{r.importo ? euro(r.importo) : ""}</td>
                                <td className="destra imp-na">{r.non_approvato > 0 ? <span className="bollino-na">{euro(r.non_approvato)}</span> : ""}</td>
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
                            {(() => {
                              const sel = rapporti.filter((r) => scelti.has(r.id));
                              const daSegnare = sel.filter((r) => !conteggiato(r)).map((r) => r.id);
                              const daTogliere = sel.filter(conteggiato).map((r) => r.id);
                              return <>
                                <button className="btn verde-conteggio" disabled={!daSegnare.length} onClick={() => segnaConteggiati(daSegnare, true)}>
                                  ✓ Segna già conteggiati{daSegnare.length ? ` (${daSegnare.length})` : ""}
                                </button>
                                {daTogliere.length > 0 && <button className="btn grigio" onClick={() => segnaConteggiati(daTogliere, false)}>Togli conteggiato ({daTogliere.length})</button>}
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
