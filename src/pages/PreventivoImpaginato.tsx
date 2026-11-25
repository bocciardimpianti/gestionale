import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Eye, FileText, Plus, Printer, Save, Trash2 } from "lucide-react";
import { dataIso, leggiTutto, registra, supabase } from "../supabase";
import { useAuth } from "../auth";
import Autocompleta from "../components/Autocompleta";
import MicDettatura from "../components/MicDettatura";
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
  const [inCorso, setInCorso] = useState(false);
  // Anteprima A4 accanto al testo, aggiornata mentre si scrive
  const [anteprima, setAnteprima] = useState("");

  useEffect(() => {
    leggiTutto("clienti", "id, nome", true).then((c) => setClienti(c as { id: number; nome: string }[])).catch(() => {});
    supabase.from("impostazioni").select("valore").eq("chiave", "preventivo_piede").maybeSingle().then(({ data }) => {
      if (data?.valore) setPiede({ ...PIEDE_PREDEFINITO, ...(data.valore as PiedePreventivo) });
    });
    if (!id) return;
    supabase.from("preventivi").select("id, data, numero, impaginato, cliente:clienti(nome)").eq("id", id).maybeSingle().then(({ data: r, error }) => {
      if (error) return setStato(/impaginato/.test(error.message) ? "Esegui su Supabase lo script 0058_preventivo_impaginato.sql" : "Errore: " + error.message);
      if (!r) return setStato("Preventivo non trovato");
      setData(String(r.data ?? dataIso(new Date())));
      setOggetto(String(r.numero ?? ""));
      setTestoCliente(String((r.cliente as unknown as { nome: string } | null)?.nome ?? ""));
      const imp = r.impaginato as Impaginato | null;
      if (imp?.soluzioni?.length) setP({ soluzioni: imp.soluzioni, nota: imp.nota ?? NOTA });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      imponibile: totale, prezzo_scontato: totale, totale, sconto: 0, sconto_totale: 0, iva: 0, iva_totale: 0,
    };
    const r = id
      ? await supabase.from("preventivi").update(record).eq("id", id).select("id").single()
      : await supabase.from("preventivi").insert({ ...record, stato: "Aperto" }).select("id").single();
    setInCorso(false);
    if (r.error) return setStato("Errore: " + (/impaginato/.test(r.error.message) ? "esegui su Supabase lo script 0058_preventivo_impaginato.sql" : r.error.message));
    if (!id) { setId(r.data.id); naviga(`/preventivo-impaginato?id=${r.data.id}`, { replace: true }); }
    setOggetto(ogg);
    setModificato(false);
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
        <label className="largo">Oggetto (per l'elenco dei preventivi)<input value={oggetto} placeholder="se vuoto: il titolo della prima soluzione" onChange={(e) => { setOggetto(e.target.value); setModificato(true); }} /></label>
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
          <label className="si-totale">Totale (€, + IVA)
            <input inputMode="decimal" value={s.totale ?? ""} placeholder="es. 32095"
              onChange={(e) => { const v = e.target.value.replace(/\./g, "").replace(",", "."); cambia(i, { totale: v.trim() === "" ? null : Number(v) || null }); }} />
            <span className="piccolo">{totaleTesto(s)}</span>
          </label>
        </div>
      ))}
      <button type="button" className="btn grigio" onClick={() => { setModificato(true); setP((x) => ({ ...x, soluzioni: [...x.soluzioni, nuovaSoluzione(true)] })); }}><Plus size={15} /> Aggiungi un'altra soluzione</button>

      <label className="nota-impaginato">Nota in fondo<textarea rows={2} value={p.nota} onChange={(e) => { setModificato(true); setP((x) => ({ ...x, nota: e.target.value })); }} /></label>

      {admin && (
        <details className="piede-impaginato" open={piedeAperto} onToggle={(e) => setPiedeAperto((e.target as HTMLDetailsElement).open)}>
          <summary>Piè di pagina (uguale per tutti i preventivi)</summary>
          <label>Prima riga<input value={piede.riga1} onChange={(e) => setPiede({ ...piede, riga1: e.target.value })} /></label>
          <label>Seconda riga (IBAN e partita IVA)<input value={piede.riga2} onChange={(e) => setPiede({ ...piede, riga2: e.target.value })} /></label>
          <button type="button" className="btn grigio piccolo-btn" onClick={salvaPiede}>Salva piè di pagina</button>
        </details>
      )}

      {stato && <p className={stato.startsWith("Errore") || stato.startsWith("Esegui") ? "errore" : "ok"}>{stato}</p>}
      <div className="barra-impaginato">
        <button type="button" className="btn grigio" onClick={() => (!modificato || confirm("Uscire senza salvare le modifiche?")) && naviga("/s/preventivi")}>Torna ai preventivi</button>
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
