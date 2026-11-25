import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Upload } from "lucide-react";
import { registra, supabase } from "../supabase";
import { apriProgetto, ALTRO, CATEGORIE_PROGETTO, categoriaDi, EVENTO_PROGETTI, FOTO, iconaCategoria, type ProgettoFile } from "../progettiClienti";
import { scritteDaPdf } from "../ddtPdf";

// Scheda del cliente → "Progetti e schede": i suoi file divisi in cartelle per argomento (Bagni, Caldaia, Clima…).
// Ogni file si apre, si sposta in un'altra cartella o si toglie dal cliente (torna "da smistare").

export const NOMI_CATEGORIE = [...CATEGORIE_PROGETTO.map((c) => c.nome), FOTO.nome, ALTRO.nome];
const dimensione = (b: number | null) => (!b ? "" : b > 1048576 ? `${(b / 1048576).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB` : `${Math.ceil(b / 1024)} kB`);

export default function ProgettiCliente({ clienteId, modificabile }: { clienteId?: number; modificabile: boolean }) {
  const [file, setFile] = useState<ProgettoFile[] | null>(null);
  const [errore, setErrore] = useState("");
  const [chiuse, setChiuse] = useState<Set<string>>(new Set());
  const [stato, setStato] = useState("");
  const scegli = useRef<HTMLInputElement>(null);

  const carica = async () => {
    if (!clienteId) return;
    const { data, error } = await supabase.from("progetti_file").select("*").eq("cliente_id", clienteId).neq("stato", "scartato").order("creato_il", { ascending: false });
    if (error) return setErrore(/progetti_file/.test(error.message) ? "Esegui su Supabase lo script 0059_progetti_clienti.sql" : error.message);
    setFile(data as ProgettoFile[]);
  };
  useEffect(() => {
    carica();
    window.addEventListener(EVENTO_PROGETTI, carica);
    return () => window.removeEventListener(EVENTO_PROGETTI, carica);
  }, [clienteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const cambia = async (x: ProgettoFile, v: Partial<ProgettoFile>) => {
    const { error } = await supabase.from("progetti_file").update({ ...v, a_mano: true, aggiornato_il: new Date().toISOString() }).eq("id", x.id);
    if (error) return setErrore(error.message);
    carica();
  };

  // File caricati da qui (es. foto o schede dal tablet): vanno al cliente e nella cartella del loro argomento
  const carica_file = async (elenco: File[]) => {
    if (!clienteId) return;
    for (const f of elenco) {
      setStato(`Caricamento di ${f.name}…`);
      const est = f.name.includes(".") ? f.name.slice(f.name.lastIndexOf(".")).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
      const percorso = `cliente-${clienteId}/${Date.now()}${est}`;
      const up = await supabase.storage.from("progetti").upload(percorso, f, { contentType: f.type || undefined });
      if (up.error) { setErrore(`${f.name}: ${up.error.message}`); continue; }
      const testo = f.type.includes("pdf") ? await scritteDaPdf(f).then((s) => s.map((y) => y.s).join(" ")).catch(() => "") : "";
      const { categoria } = categoriaDi(f.name, "", testo, f.type);
      const { error } = await supabase.from("progetti_file").insert({ nome_file: f.name, percorso, tipo: f.type || null, dimensione: f.size, stato: "smistato", cliente_id: clienteId, categoria, motivo: "caricato dalla scheda del cliente", a_mano: true });
      if (error) setErrore(`${f.name}: ${error.message}`);
    }
    await registra("progetti_caricati", { cliente_id: clienteId, file: elenco.length });
    setStato(`${elenco.length} file caricati.`);
    carica();
  };

  if (!clienteId) return <p className="vuoto-linguetta">Salva prima il cliente.</p>;
  if (errore) return <p className="errore">{errore}</p>;
  if (!file) return <p className="piccolo">Caricamento…</p>;
  const cartelle = [...new Set(file.map((x) => x.categoria || ALTRO.nome))].sort((a, b) => NOMI_CATEGORIE.indexOf(a) - NOMI_CATEGORIE.indexOf(b));
  return (
    <div className="progetti-cliente">
      <div className="pc-barra">
        <span className="piccolo">{file.length ? `${file.length} file in ${cartelle.length} ${cartelle.length === 1 ? "cartella" : "cartelle"}` : "Nessun file."} I file messi in Drive → <b>Progetti clienti</b> arrivano qui da soli.</span>
        <span style={{ flex: 1 }} />
        {modificabile && <button type="button" className="btn grigio piccolo-btn" onClick={() => scegli.current?.click()}><Upload size={14} /> Aggiungi file</button>}
        <input ref={scegli} type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) carica_file(f); }} />
      </div>
      {stato && <p className="piccolo">{stato}</p>}
      {cartelle.map((c) => {
        const dentro = file.filter((x) => (x.categoria || ALTRO.nome) === c);
        const aperta = !chiuse.has(c);
        return (
          <div key={c} className="pc-cartella">
            <button type="button" className="pc-testa" onClick={() => setChiuse((s) => { const n = new Set(s); if (aperta) n.add(c); else n.delete(c); return n; })}>
              {aperta ? <ChevronDown size={16} /> : <ChevronRight size={16} />} <span className="pc-icona">{iconaCategoria(c)}</span> <b>{c}</b> <span className="piccolo">({dentro.length})</span>
            </button>
            {aperta && dentro.map((x) => (
              <div key={x.id} className="pc-file">
                <button type="button" className="link pc-nome" title="Apri il file" onClick={() => apriProgetto(x)}>{x.nome_file}</button>
                <span className="piccolo">{new Date(x.creato_il).toLocaleDateString("it-IT")}{x.dimensione ? ` · ${dimensione(x.dimensione)}` : ""}{x.cartella ? ` · Drive: ${x.cartella}` : ""}</span>
                {modificabile && <>
                  <select value={x.categoria ?? ALTRO.nome} title="Sposta in un'altra cartella" onChange={(e) => cambia(x, { categoria: e.target.value })}>
                    {NOMI_CATEGORIE.map((n) => <option key={n} value={n}>{iconaCategoria(n)} {n}</option>)}
                  </select>
                  <button type="button" className="btn grigio piccolo-btn" title="Non è di questo cliente: torna tra i file da smistare" onClick={() => confirm(`"${x.nome_file}" non è di questo cliente? Torna tra i file da smistare (sezione Clienti).`) && cambia(x, { cliente_id: null, stato: "da_smistare" })}>Non è suo</button>
                </>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
