import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Eye, FileText, Plus, Printer, Save, Trash2 } from "lucide-react";
import { dataIso, leggiTutto, registra, supabase } from "../supabase";
import { useAuth } from "../auth";
import Autocompleta from "../components/Autocompleta";
import MicDettatura from "../components/MicDettatura";
import { impaginatoDaConfigurazione, type Configurazione } from "../impaginaGuidato";
import { AZIENDA, htmlPreventivoImpaginato, importoPreventivo, type PiedePreventivo, type PreventivoImpaginato as Impaginato, type SoluzionePreventivo } from "../stampe";

// Preventivo impaginato come il modello Word della ditta: si scrive il testo (una o più soluzioni con titolo,
// descrizione e totale) e il gestionale lo impagina con logo, cliente, data, "Totale €. … + IVA" e piè di pagina.
// Il testo resta salvato nel preventivo (script 0058) e si può riaprire, modificare e ristampare.

const NOTA = "* I preventivi hanno validità di 30 giorni dalla data del documento.";
const PIEDE_PREDEFINITO: PiedePreventivo = {
  riga1: `VIA UGO FOSCOLO, 6 - 56029 STAFFOLI (PISA) - TEL. ${AZIENDA.telefono} - E-mail: ${AZIENDA.email}`,
  riga2: `PARTITA IVA ${AZIENDA.piva}`,
};
const nuovaSoluzione = (nuovaPagina = false): SoluzionePreventivo => ({ titolo: "", testo: "", totale: null, nuovaPagina });

export default function PreventivoImpaginato() {
  const [parametri] = useSearchParams();
  const naviga = useNavigate();
  const { profilo } = useAuth();
  const admin = profilo?.ruolo === "admin";
  const [id, setId] = useState<number | null>(parametri.get("id") ? Number(parametri.get("id")) : null);
  const [clienti, setClienti] = useState<{ id: number; nome: string }[]>([]);
  const [testoCliente, setTestoCliente] = useState("");
  const [data, setData] = useState(dataIso(new Date())!);
  const [oggetto, setOggetto] = useState("");
  const [p, setP] = useState<Impaginato>({ soluzioni: [nuovaSoluzione()], nota: NOTA });
  const [piede, setPiede] = useState<PiedePreventivo>(PIEDE_PREDEFINITO);
  const [piedeAperto, setPiedeAperto] = useState(false);
  const [stato, setStato] = useState("");
  const [modificato, setModificato] = useState(false);
  // Preventivo nato dal foglio guidato: totali e righe restano quelli del foglio; il testo si può rifare da lì
  const [guidato, setGuidato] = useState<{ conf: Configurazione; sconto: number } | null>(null);
  const [inCorso, setInCorso] = useState(false);
  // Preventivo con righe di materiali (es. da un'offerta del fornitore): il testo parte dall'elenco dei materiali,
  // i totali restano quelli delle righe
  const [conRighe, setConRighe] = useState<{ materiali: string[]; totale: number } | null>(null);
  // Anteprima A4 accanto al testo, aggiornata mentre si scrive
  const [anteprima, setAnteprima] = useState("");
  // Valori più recenti (letti dopo il caricamento, fuori dal ciclo di React)
  const pRef = useRef(p), clienteRef = useRef(testoCliente), dataRef = useRef(data), oggettoRef = useRef(oggetto);
  pRef.current = p; clienteRef.current = testoCliente; dataRef.current = data; oggettoRef.current = oggetto;
  const conRigheRef = useRef(conRighe);
  conRigheRef.current = conRighe;

  useEffect(() => {
    leggiTutto("clienti", "id, nome", true).then((c) => setClienti(c as { id: number; nome: string }[])).catch(() => {});
    supabase.from("impostazioni").select("valore").eq("chiave", "preventivo_piede").maybeSingle().then(({ data }) => {
      if (data?.valore) setPiede({ ...PIEDE_PREDEFINITO, ...(data.valore as PiedePreventivo) });
    });
    if (!id) { ripristinaBozza(); return; }
    supabase.from("preventivi").select("id, data, numero, impaginato, configurazione, sconto, imponibile, prezzo_scontato, cliente:clienti(nome)").eq("id", id).maybeSingle().then(async ({ data: r, error }) => {
      if (error) return setStato(/impaginato/.test(error.message) ? "Esegui su Supabase lo script 0058_preventivo_impaginato.sql" : "Errore: " + error.message);
      if (!r) return setStato("Preventivo non trovato");
      setData(String(r.data ?? dataIso(new Date())));
      setOggetto(String(r.numero ?? ""));
      setTestoCliente(String((r.cliente as unknown as { nome: string } | null)?.nome ?? ""));
      if (r.configurazione) setGuidato({ conf: r.configurazione as Configurazione, sconto: Number(r.sconto ?? 0) });
      const imp = r.impaginato as Impaginato | null;
      if (imp?.soluzioni?.length) setP({ soluzioni: imp.soluzioni, nota: imp.nota ?? NOTA });
      if (r.configurazione) return;
      // Materiali del preventivo: elenco puntato (quantità e descrizione, senza prezzi) e il totale delle righe
      const { data: righe } = await supabase.from("righe_preventivo").select("descrizione, quantita, unita_misura, ordine").eq("preventivo_id", id).order("ordine");
      const elenco = ((righe ?? []) as { descrizione: string | null; quantita: number | null; unita_misura: string | null }[]).filter((x) => String(x.descrizione ?? "").trim());
      // Manodopera del preventivo (script 0068): una riga in fondo all'elenco, senza prezzo
      const { data: md } = await supabase.from("preventivi").select("ore_lavoro, numero_tecnici").eq("id", id).maybeSingle();
      const ore = Number(md?.ore_lavoro ?? 0), tecnici = Number(md?.numero_tecnici ?? 1) || 1;
      if (!elenco.length && !ore) return;
      const qta = (q: number | null) => Number(q ?? 1).toLocaleString("it-IT", { maximumFractionDigits: 2 });
      // Ogni materiale è una voce dell'elenco (nome modificabile, si spunta se va nel preventivo); in fondo la manodopera
      const materiali = [
        ...elenco.map((x) => `${qta(x.quantita)} ${/^(pz|nr|n)\.?$/i.test(String(x.unita_misura ?? "")) || !x.unita_misura ? "x" : String(x.unita_misura).toLowerCase()} ${String(x.descrizione).trim()}`),
        ...(ore ? [`Manodopera: ${tecnici} ${tecnici === 1 ? "tecnico" : "tecnici"} per ${ore.toLocaleString("it-IT")} ${ore === 1 ? "ora" : "ore"}`] : []),
      ];
      const totale = Number(r.prezzo_scontato ?? r.imponibile ?? 0) || 0;
      setConRighe({ materiali, totale });
      if (!imp?.soluzioni?.length) {
        setP({ soluzioni: [{ titolo: String(r.numero ?? "").toUpperCase(), testo: "", totale: totale || null, nuovaPagina: false, materiali: materiali.map((nome) => ({ nome, mostra: true })) }], nota: NOTA });
        setModificato(true);
      }
    }).then(ripristinaBozza);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Modifiche non salvate: restano sul dispositivo e si ritrovano riaprendo l'impaginato (finché non si salva)
  const chiaveBozza = `bozza-impaginato:${id ?? "nuovo"}`;
  // base: i materiali del preventivo quando è stata fatta la bozza (se poi cambiano, l'elenco si aggiorna)
  type Bozza = { p: Impaginato; cliente: string; data: string; oggetto: string; quando: string; base?: string };
  const [caricato, setCaricato] = useState(false);
  const [ripristinata, setRipristinata] = useState(false);
  // Contenuto appena aperto (dal database o dai materiali): la bozza si salva solo se lo si cambia davvero
  const iniziale = useRef("");
  const istantanea = () => JSON.stringify([pRef.current, clienteRef.current, dataRef.current, oggettoRef.current]);
  function ripristinaBozza() {
    // Si aspetta che il contenuto caricato sia a video, poi si guarda se c'è una bozza più recente
    window.setTimeout(() => {
      iniziale.current = istantanea();
      try {
        const b = JSON.parse(localStorage.getItem(chiaveBozza) ?? "null") as Bozza | null;
        if (b?.p?.soluzioni?.length) {
          // Materiali del preventivo cambiati dopo la bozza: si tiene il testo scritto, l'elenco e il totale si rifanno
          const ora = conRigheRef.current;
          const cambiati = !!ora && b.base !== undefined && b.base !== ora.materiali.join("\n");
          const pp = cambiati ? { ...b.p, soluzioni: b.p.soluzioni.map((x, j) => (j === 0 ? { ...x, materiali: ora!.materiali.map((nome) => ({ nome, mostra: true })), totale: ora!.totale || x.totale } : x)) } : b.p;
          setP(pp); setTestoCliente(b.cliente); setData(b.data); setOggetto(b.oggetto); setModificato(true); setRipristinata(true);
          setStato(`Ripristinate le modifiche non salvate del ${new Date(b.quando).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}.${cambiati ? " I materiali del preventivo sono cambiati: elenco e totale aggiornati." : ""}`);
        }
      } catch { /* bozza illeggibile: si ignora */ }
      setCaricato(true);
    }, 80);
  }
  useEffect(() => {
    if (!caricato || !modificato) return;
    const t = window.setTimeout(() => {
      if (istantanea() === iniziale.current) return;
      try { localStorage.setItem(chiaveBozza, JSON.stringify({ p, cliente: testoCliente, data, oggetto, quando: new Date().toISOString(), base: conRighe?.materiali.join("\n") } satisfies Bozza)); } catch { /* spazio pieno */ }
    }, 400);
    return () => window.clearTimeout(t);
  }, [p, testoCliente, data, oggetto, modificato, caricato]); // eslint-disable-line react-hooks/exhaustive-deps
  const scartaBozza = () => {
    if (!confirm("Scartare le modifiche non salvate e tornare all'ultima versione salvata?")) return;
    try { localStorage.removeItem(chiaveBozza); } catch { /* niente */ }
    location.reload();
  };

  useEffect(() => {
    const t = window.setTimeout(() => setAnteprima(htmlPreventivoImpaginato({ cliente: testoCliente.trim(), data, titolo: "Anteprima" }, p, piede, false)), 500);
    return () => window.clearTimeout(t);
  }, [p, testoCliente, data, piede]);

  const cliente = clienti.find((c) => c.nome.trim().toLowerCase() === testoCliente.trim().toLowerCase()) ?? null;
  const cambia = (i: number, v: Partial<SoluzionePreventivo>) => { setModificato(true); setP((x) => ({ ...x, soluzioni: x.soluzioni.map((s, j) => (j === i ? { ...s, ...v } : s)) })); };
  const sposta = (i: number, d: number) => setP((x) => {
    const s = [...x.soluzioni];
    const j = i + d;
    if (j < 0 || j >= s.length) return x;
    [s[i], s[j]] = [s[j], s[i]];
    setModificato(true);
    return { ...x, soluzioni: s };
  });

  const finestra = (stampa: boolean) => {
    const w = window.open("", "_blank");
    if (!w) return setStato("Errore: il browser ha bloccato la finestra (permetti le finestre popup per questo sito)");
    w.document.write(htmlPreventivoImpaginato({ cliente: testoCliente.trim(), data, titolo: `Preventivo ${testoCliente.trim()} ${oggetto}`.trim() }, p, piede, stampa));
    w.document.close();
  };

  const salva = async () => {
    const primo = p.soluzioni.find((s) => s.titolo.trim()) ?? p.soluzioni[0];
    const ogg = oggetto.trim() || primo?.titolo.trim().slice(0, 120) || "Preventivo";
    if (testoCliente.trim() && !cliente && !confirm(`"${testoCliente.trim()}" non è in anagrafica clienti: il preventivo si salva senza cliente collegato (il nome resta solo nella stampa). Continuare?`)) return;
    setInCorso(true);
    const totale = Number(primo?.totale ?? 0) || 0;
    const record: Record<string, unknown> = {
      data, numero: ogg, cliente_id: cliente?.id ?? null, impaginato: { ...p, cliente_testo: testoCliente.trim() },
      // dal foglio guidato i totali restano quelli calcolati là
      ...(guidato || conRighe ? {} : { imponibile: totale, prezzo_scontato: totale, totale, sconto: 0, sconto_totale: 0, iva: 0, iva_totale: 0 }),
    };
    const r = id
      ? await supabase.from("preventivi").update(record).eq("id", id).select("id").single()
      : await supabase.from("preventivi").insert({ ...record, stato: "Aperto" }).select("id").single();
    setInCorso(false);
    if (r.error) return setStato("Errore: " + (/impaginato/.test(r.error.message) ? "esegui su Supabase lo script 0058_preventivo_impaginato.sql" : r.error.message));
    if (!id) { setId(r.data.id); naviga(`/preventivo-impaginato?id=${r.data.id}`, { replace: true }); }
    setOggetto(ogg);
    setModificato(false);
    // Salvato: la bozza sul dispositivo non serve più
    try { localStorage.removeItem(chiaveBozza); localStorage.removeItem(`bozza-impaginato:${r.data.id}`); } catch { /* niente */ }
    await registra(id ? "preventivo_impaginato_modificato" : "preventivo_impaginato_creato", { id: r.data.id, oggetto: ogg });
    setStato(`Preventivo salvato (${ogg}).`);
  };

  const salvaPiede = async () => {
    const { error } = await supabase.from("impostazioni").upsert({ chiave: "preventivo_piede", valore: piede });
    setStato(error ? "Errore: " + error.message : "Piè di pagina salvato per tutti i preventivi.");
  };

  const totaleTesto = (s: SoluzionePreventivo) => (s.totale ? `Totale €. ${importoPreventivo(s.totale)} + IVA` : "");
  return (
    <div className="impaginato-due">
    <div className="pagina-impaginato">
      <div className="testata"><h1><span className="icona-titolo"><FileText size={20} strokeWidth={2} /></span>Preventivo impaginato</h1></div>
      <p className="piccolo">Scrivi il testo: il gestionale lo impagina come il modello della ditta (logo, cliente e data, titolo in maiuscolo, testo, <b>Totale €. … + IVA</b>, piè di pagina). Per un elenco puntato inizia la riga con <b>-</b>. Una riga vuota separa i paragrafi.</p>

      <div className="testa-impaginato">
        <label>Cliente<Autocompleta id="cliente-impaginato" valore={testoCliente} opzioni={clienti.map((c) => c.nome)}
          onCambia={(t) => { setTestoCliente(t); setModificato(true); }} placeholder="Scrivi le prime lettere…" nonTrovato={!!testoCliente.trim() && !cliente} /></label>
        <label>Data<input type="date" value={data} onChange={(e) => { setData(e.target.value); setModificato(true); }} /></label>
        <label className="largo">Nome nell'elenco dei preventivi (non va in stampa)<input value={oggetto} placeholder="se lo lasci vuoto: il titolo della prima soluzione" onChange={(e) => { setOggetto(e.target.value); setModificato(true); }} /></label>
      </div>

      {p.soluzioni.map((s, i) => (
        <div key={i} className="soluzione-impaginato">
          <div className="si-testa">
            <b>{p.soluzioni.length > 1 ? `Soluzione ${i + 1}` : "Testo del preventivo"}</b>
            {i > 0 && <label className="piccolo"><input type="checkbox" checked={!!s.nuovaPagina} onChange={(e) => cambia(i, { nuovaPagina: e.target.checked })} /> inizia su una nuova pagina</label>}
            <span style={{ flex: 1 }} />
            {p.soluzioni.length > 1 && <>
              <button type="button" className="link" title="Sposta su" onClick={() => sposta(i, -1)} disabled={i === 0}><ArrowUp size={16} /></button>
              <button type="button" className="link" title="Sposta giù" onClick={() => sposta(i, 1)} disabled={i === p.soluzioni.length - 1}><ArrowDown size={16} /></button>
              <button type="button" className="link" title="Togli questa soluzione" onClick={() => confirm("Togliere questa soluzione?") && (setModificato(true), setP((x) => ({ ...x, soluzioni: x.soluzioni.filter((_, j) => j !== i) })))}><Trash2 size={16} /></button>
            </>}
          </div>
          <label>Titolo<input className="si-titolo" value={s.titolo} placeholder="es. IMPIANTO RISCALDAMENTO E IMPIANTO CLIMATIZZAZIONE CANALIZZATO" onChange={(e) => cambia(i, { titolo: e.target.value })} /></label>
          <label>Testo
            <div className="con-microfono">
              <textarea rows={14} value={s.testo} placeholder={"Fornitura e posa in opera di …\n\nAl termine dell'installazione verrà rilasciata …\n\n- primo punto dell'elenco\n- secondo punto"}
                onChange={(e) => cambia(i, { testo: e.target.value })} />
              <MicDettatura testoLibero onTesto={(t) => cambia(i, { testo: (s.testo ? s.testo.replace(/\s*$/, " ") : "") + t })} />
            </div>
          </label>
          {/* Elenco dei materiali, separato dal testo: si spuntano quelli da stampare e se ne cambia il nome */}
          {!!s.materiali?.length && (
            <div className="si-materiali">
              <div className="si-mat-testa">
                <b>Materiali</b> <span className="piccolo">({s.materiali.filter((m) => m.mostra).length} di {s.materiali.length} nel preventivo)</span>
                <span style={{ flex: 1 }} />
                <button type="button" className="link" onClick={() => cambia(i, { materiali: s.materiali!.map((m) => ({ ...m, mostra: true })) })}>Tutti</button>
                <button type="button" className="link" onClick={() => cambia(i, { materiali: s.materiali!.map((m) => ({ ...m, mostra: false })) })}>Nessuno</button>
              </div>
              {s.materiali.map((m, k) => (
                <div key={k} className={`si-mat${m.mostra ? "" : " spento"}`}>
                  <input type="checkbox" checked={m.mostra} aria-label="Nel preventivo" title={m.mostra ? "Compare nel preventivo (togli la spunta per nasconderlo)" : "Non compare nel preventivo"}
                    onChange={(e) => cambia(i, { materiali: s.materiali!.map((x, j) => (j === k ? { ...x, mostra: e.target.checked } : x)) })} />
                  <input className="si-mat-nome" value={m.nome} aria-label="Nome nel preventivo"
                    onChange={(e) => cambia(i, { materiali: s.materiali!.map((x, j) => (j === k ? { ...x, nome: e.target.value } : x)) })} />
                  <button type="button" className="link" title="Sposta su" disabled={k === 0}
                    onClick={() => { const l = [...s.materiali!]; [l[k - 1], l[k]] = [l[k], l[k - 1]]; cambia(i, { materiali: l }); }}><ArrowUp size={15} /></button>
                  <button type="button" className="link" title="Sposta giù" disabled={k === s.materiali!.length - 1}
                    onClick={() => { const l = [...s.materiali!]; [l[k + 1], l[k]] = [l[k], l[k + 1]]; cambia(i, { materiali: l }); }}><ArrowDown size={15} /></button>
                </div>
              ))}
              <button type="button" className="link" onClick={() => cambia(i, { materiali: [...s.materiali!, { nome: "", mostra: true }] })}><Plus size={14} /> Aggiungi una voce</button>
            </div>
          )}
          <label className="si-totale">Totale (€, + IVA)
            <input inputMode="decimal" value={s.totale ?? ""} placeholder="es. 32095"
              onChange={(e) => { const v = e.target.value.replace(/\./g, "").replace(",", "."); cambia(i, { totale: v.trim() === "" ? null : Number(v) || null }); }} />
            <span className="piccolo">{totaleTesto(s)}</span>
          </label>
        </div>
      ))}
      <div className="barra-soluzioni">
        {/* Preventivo guidato: le soluzioni alternative si fanno nel foglio guidato (ognuna con le sue stanze e il suo totale) */}
        {guidato
          ? <span className="piccolo">Per un'altra soluzione (es. con unità esterna unica): <b>Torna al preventivo guidato</b> → <b>Aggiungi soluzione alternativa</b>, poi <b>Impagina</b>.</span>
          : <button type="button" className="btn grigio" onClick={() => { setModificato(true); setP((x) => ({ ...x, soluzioni: [...x.soluzioni, nuovaSoluzione(true)] })); }}><Plus size={15} /> Aggiungi un'altra soluzione</button>}
        {guidato && <button type="button" className="btn grigio" title="Rifà il testo con le stanze e i punti del preventivo guidato"
          onClick={() => confirm("Rifare il testo dal foglio guidato? Le modifiche fatte a mano al testo si perdono.") && (setModificato(true), setP(impaginatoDaConfigurazione(guidato.conf, oggetto, guidato.sconto)))}>
          Rifai il testo dal foglio guidato</button>}
        {conRighe && <button type="button" className="btn grigio" title="Rimette nella prima soluzione l'elenco dei materiali del preventivo (tutti spuntati) e il suo totale"
          onClick={() => confirm("Rifare l'elenco dai materiali del preventivo? I nomi cambiati a mano e le spunte dell'elenco si perdono (il testo scritto resta).") && (setModificato(true),
            setP((x) => ({ ...x, soluzioni: x.soluzioni.map((s, j) => (j === 0 ? { ...s, titolo: s.titolo || oggetto.toUpperCase(), materiali: conRighe.materiali.map((nome) => ({ nome, mostra: true })), totale: conRighe.totale || null } : s)) })))}>
          Rifai l'elenco dai materiali</button>}
      </div>

      <label className="nota-impaginato">Nota in fondo<textarea rows={2} value={p.nota} onChange={(e) => { setModificato(true); setP((x) => ({ ...x, nota: e.target.value })); }} /></label>

      {admin && (
        <details className="piede-impaginato" open={piedeAperto} onToggle={(e) => setPiedeAperto((e.target as HTMLDetailsElement).open)}>
          <summary>Piè di pagina (uguale per tutti i preventivi)</summary>
          <label>Prima riga<input value={piede.riga1} onChange={(e) => setPiede({ ...piede, riga1: e.target.value })} /></label>
          <label>Seconda riga (IBAN e partita IVA)<input value={piede.riga2} onChange={(e) => setPiede({ ...piede, riga2: e.target.value })} /></label>
          <button type="button" className="btn grigio piccolo-btn" onClick={salvaPiede}>Salva piè di pagina</button>
        </details>
      )}

      {stato && <p className={stato.startsWith("Errore") || stato.startsWith("Esegui") ? "errore" : "ok"}>{stato}
        {ripristinata && modificato && <> <button type="button" className="link" onClick={scartaBozza}>Scarta le modifiche</button></>}</p>}
      <div className="barra-impaginato">
        {/* Si torna al preventivo da cui si è partiti: il foglio guidato da modificare, oppure la scheda del preventivo */}
        <button type="button" className="btn grigio" onClick={() => (!modificato || confirm("Uscire senza salvare le modifiche?"))
          && naviga(guidato && id ? `/preventivo-guidato?id=${id}` : id ? `/s/preventivi?apri=${id}` : "/s/preventivi")}>
          {guidato ? "Torna al preventivo guidato" : "Torna al preventivo"}</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn grigio" onClick={() => finestra(false)}><Eye size={15} /> Anteprima</button>
        <button type="button" className="btn grigio" onClick={() => finestra(true)}><Printer size={15} /> Stampa / PDF</button>
        <button type="button" className="btn blu" disabled={inCorso} onClick={salva}><Save size={15} /> {inCorso ? "Salvataggio…" : "Salva"}</button>
      </div>
    </div>
    <div className="anteprima-a4">
      <div className="piccolo">Anteprima su foglio A4 (come verrà stampato)</div>
      {anteprima && <iframe title="Anteprima A4" srcDoc={anteprima} />}
    </div>
    </div>
  );
}
