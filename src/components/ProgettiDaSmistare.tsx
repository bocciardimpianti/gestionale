import { useEffect, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { leggiTutto, supabase } from "../supabase";
import { controllaDrive } from "../ddtAutomatici";
import { apriProgetto, EVENTO_PROGETTI, iconaCategoria, smistaProgetti, type ProgettoFile } from "../progettiClienti";
import { NOMI_CATEGORIE } from "./ProgettiCliente";
import Autocompleta from "./Autocompleta";

// Sezione Clienti: file della cartella Drive "Progetti clienti" di cui non si è capito il cliente (o con errori).
// Si sceglie il cliente (e se serve la cartella) e il file va nella linguetta "Progetti e schede" di quel cliente.

export default function ProgettiDaSmistare({ puoModificare }: { puoModificare: boolean }) {
  const [file, setFile] = useState<ProgettoFile[] | null>(null);
  const [clienti, setClienti] = useState<{ id: number; nome: string }[]>([]);
  const [scelte, setScelte] = useState<Record<number, { cliente: string; categoria: string }>>({});
  const [stato, setStato] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [aperto, setAperto] = useState(true);
  const [smistatiOggi, setSmistatiOggi] = useState(0);

  const carica = async () => {
    const { data, error } = await supabase.from("progetti_file").select("*").in("stato", ["da_smistare", "errore", "da_leggere", "in_lettura"]).order("id", { ascending: false }).limit(100);
    if (error) return setFile(null); // script 0059 non eseguito: il riquadro non si mostra
    setFile(data as ProgettoFile[]);
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    const { count } = await supabase.from("progetti_file").select("id", { count: "exact", head: true }).eq("stato", "smistato").gte("aggiornato_il", oggi.toISOString());
    setSmistatiOggi(count ?? 0);
  };
  useEffect(() => {
    carica();
    leggiTutto("clienti", "id, nome", true).then((c) => setClienti(c as unknown as { id: number; nome: string }[])).catch(() => {});
    window.addEventListener(EVENTO_PROGETTI, carica);
    return () => window.removeEventListener(EVENTO_PROGETTI, carica);
  }, []);

  const controlla = async () => {
    setInCorso(true);
    try {
      setStato("Controllo di Drive…");
      // Cosa ha visto la funzione su Drive: così un problema (cartella non condivisa, funzione vecchia) si vede subito
      let drive = "";
      try {
        const d = await controllaDrive() as { progetti?: { nuovi?: number; errore?: string; errori?: string[] } };
        if (!d.progetti) drive = "La funzione ddt-drive su Supabase non è aggiornata: incolla il codice nuovo e pubblicala.";
        else if (d.progetti.errore) drive = "Drive: " + d.progetti.errore;
        else drive = `Drive: ${d.progetti.nuovi ?? 0} file nuovi${d.progetti.errori?.length ? ` · problemi: ${d.progetti.errori.join("; ")}` : ""}`;
      } catch (e) { drive = "Drive non raggiungibile: " + (e as Error).message; }
      const e = await smistaProgetti(setStato);
      setStato([drive, e.smistati ? `${e.smistati} file smistati` : "", e.daSmistare ? `${e.daSmistare} da smistare a mano` : "", e.errori ? `${e.errori} con errori` : ""].filter(Boolean).join(" · "));
    } catch (e) { setStato("Errore: " + (e as Error).message); }
    await carica();
    setInCorso(false);
  };

  const assegna = async (x: ProgettoFile) => {
    const s = scelte[x.id];
    const c = clienti.find((k) => k.nome.trim().toLowerCase() === (s?.cliente ?? "").trim().toLowerCase());
    if (!c) return setStato("Scegli il cliente dall'elenco");
    const { error } = await supabase.from("progetti_file").update({ cliente_id: c.id, categoria: s?.categoria || x.categoria, stato: "smistato", a_mano: true, motivo: "assegnato a mano", aggiornato_il: new Date().toISOString() }).eq("id", x.id);
    if (error) return setStato("Errore: " + error.message);
    setStato(`"${x.nome_file}" → ${c.nome}`);
    carica();
  };
  const scarta = async (x: ProgettoFile) => {
    if (!confirm(`Scartare "${x.nome_file}"? Non verrà messo in nessun cliente (resta su Drive).`)) return;
    await supabase.from("progetti_file").update({ stato: "scartato", aggiornato_il: new Date().toISOString() }).eq("id", x.id);
    carica();
  };

  if (!file) return null;
  const daFare = file.filter((x) => x.stato === "da_smistare" || x.stato === "errore");
  const inLettura = file.length - daFare.length;
  if (!daFare.length && !inLettura && !stato) return (
    <div className="progetti-smistare vuoto"><FolderOpen size={16} /> <span className="piccolo">Progetti clienti: tutto smistato{smistatiOggi ? ` (${smistatiOggi} oggi)` : ""}.</span>
      {puoModificare && <button type="button" className="link" disabled={inCorso} onClick={controlla}>Controlla Drive</button>}</div>
  );
  return (
    <div className="progetti-smistare">
      <div className="dia-testa">
        <FolderOpen size={18} /> <b>Progetti e schede da smistare</b>
        <span className="piccolo">{daFare.length} da assegnare{inLettura ? ` · ${inLettura} in lettura` : ""}{smistatiOggi ? ` · ${smistatiOggi} smistati oggi` : ""}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="link" onClick={() => setAperto(!aperto)}>{aperto ? "Nascondi" : "Mostra"}</button>
        {puoModificare && <button type="button" className="btn grigio piccolo-btn" disabled={inCorso} onClick={controlla}><RefreshCw size={14} /> Controlla adesso</button>}
      </div>
      {stato && <p className={/non è aggiornata|non leggibile|non raggiungibile|Errore/.test(stato) ? "errore" : "piccolo"}>{stato}</p>}
      {aperto && daFare.map((x) => (
        <div key={x.id} className="ps-riga">
          <span className="dia-testi">
            <button type="button" className="link pc-nome" onClick={() => apriProgetto(x)}>{iconaCategoria(x.categoria)} {x.nome_file}</button>
            <span className="piccolo">{x.cartella ? `Drive: ${x.cartella} · ` : ""}{x.stato === "errore" ? "Errore: " : ""}{x.motivo}</span>
          </span>
          {puoModificare && <>
            <span className="ps-cliente"><Autocompleta id={`ps-${x.id}`} valore={scelte[x.id]?.cliente ?? ""} opzioni={clienti.map((c) => c.nome)} placeholder="Cliente…"
              onCambia={(t) => setScelte((s) => ({ ...s, [x.id]: { categoria: s[x.id]?.categoria ?? x.categoria ?? "", cliente: t } }))} /></span>
            <select value={scelte[x.id]?.categoria ?? x.categoria ?? ""} onChange={(e) => setScelte((s) => ({ ...s, [x.id]: { cliente: s[x.id]?.cliente ?? "", categoria: e.target.value } }))}>
              {NOMI_CATEGORIE.map((n) => <option key={n} value={n}>{iconaCategoria(n)} {n}</option>)}
            </select>
            <button type="button" className="btn blu piccolo-btn" onClick={() => assegna(x)}>Assegna</button>
            <button type="button" className="btn grigio piccolo-btn" onClick={() => scarta(x)}>Scarta</button>
          </>}
        </div>
      ))}
    </div>
  );
}
