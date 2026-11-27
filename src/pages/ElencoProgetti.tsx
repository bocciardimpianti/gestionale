import { useEffect, useMemo, useState } from "react";
import { FileStack, FolderOpen, RefreshCw, Search } from "lucide-react";
import { leggiTutto, supabase } from "../supabase";
import { useAuth } from "../auth";
import { apriProgetto, EVENTO_PROGETTI, iconaCategoria, PREVENTIVI_FORNITORI, smistaProgetti, type ProgettoFile } from "../progettiClienti";
import { NOMI_CATEGORIE } from "../components/ProgettiCliente";
import Autocompleta from "../components/Autocompleta";
import MailProgetto from "../components/MailProgetto";

// Sezioni del menu (DOCUMENTI):
//  - "Preventivi fornitori": i preventivi e le offerte mandati per mail dai fornitori, raggruppati per fornitore;
//  - "Progetti e documenti": progetti, schede, brochure… (cartella Drive "Progetti clienti"), raggruppati per argomento.
// Sono gli stessi file della linguetta della scheda cliente: qui si vedono tutti insieme, si cercano e si assegnano.

type Riga = ProgettoFile & { cliente?: { nome: string } | null };
type Filtro = "tutti" | "da_smistare" | "assegnati";

const FORNITORI_NOTI: Record<string, string> = { "palagini.it": "PALAGINI", "cllatspa.it": "CLLAT", "mefsrl.it": "MEF" };
// Fornitore del preventivo: il nome messo davanti al file dallo script di Gmail ("PALAGINI - …"), o il dominio della mail
const fornitoreDi = (x: Riga) => {
  const davanti = /^([A-ZÀ-Ü0-9&.' ]{2,30}) - /.exec(x.nome_file)?.[1]?.trim();
  if (davanti) return davanti;
  const dominio = /@([\w.-]+)/.exec(x.mail?.da ?? "")?.[1]?.toLowerCase() ?? "";
  return Object.entries(FORNITORI_NOTI).find(([d]) => dominio.endsWith(d))?.[1] ?? (dominio || "Altri");
};
const titoloSenzaFornitore = (x: Riga) => x.nome_file.replace(/^[A-ZÀ-Ü0-9&.' ]{2,30} - /, "");

export default function ElencoProgetti({ preventivi }: { preventivi: boolean }) {
  const { puo } = useAuth();
  const puoModificare = puo("clienti", "modificare");
  const [righe, setRighe] = useState<Riga[] | null>(null);
  const [errore, setErrore] = useState("");
  const [stato, setStato] = useState("");
  const [cerca, setCerca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("tutti");
  const [clienti, setClienti] = useState<{ id: number; nome: string }[]>([]);
  const [scelte, setScelte] = useState<Record<number, string>>({});
  const [inCorso, setInCorso] = useState(false);

  const carica = async () => {
    const { data, error } = await supabase.from("progetti_file").select("*, cliente:clienti(nome)").neq("stato", "scartato").order("creato_il", { ascending: false }).limit(2000);
    if (error) return setErrore(/progetti_file/.test(error.message) ? "Esegui su Supabase lo script 0059_progetti_clienti.sql" : error.message);
    setRighe(((data ?? []) as Riga[]).filter((x) => (x.categoria === PREVENTIVI_FORNITORI.nome) === preventivi));
  };
  useEffect(() => {
    setRighe(null);
    carica();
    leggiTutto("clienti", "id, nome", true).then((c) => setClienti(c as unknown as { id: number; nome: string }[])).catch(() => {});
    window.addEventListener(EVENTO_PROGETTI, carica);
    return () => window.removeEventListener(EVENTO_PROGETTI, carica);
  }, [preventivi]); // eslint-disable-line react-hooks/exhaustive-deps

  const assegnato = (x: Riga) => x.stato === "smistato" && !!x.cliente_id;
  const visibili = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return (righe ?? []).filter((x) => (filtro === "tutti" || (filtro === "assegnati") === assegnato(x))
      && (!q || [x.nome_file, x.cliente?.nome, x.mail?.oggetto, x.mail?.da, x.cartella].some((t) => String(t ?? "").toLowerCase().includes(q))));
  }, [righe, cerca, filtro]);
  // Gruppi: per fornitore (preventivi) o per argomento (progetti)
  const gruppi = useMemo(() => {
    const m = new Map<string, Riga[]>();
    for (const x of visibili) {
      const g = preventivi ? fornitoreDi(x) : x.categoria || "Altro";
      m.set(g, [...(m.get(g) ?? []), x]);
    }
    return [...m.entries()].sort((a, b) => (preventivi ? a[0].localeCompare(b[0]) : NOMI_CATEGORIE.indexOf(a[0]) - NOMI_CATEGORIE.indexOf(b[0])));
  }, [visibili, preventivi]);

  const assegna = async (x: Riga) => {
    const c = clienti.find((k) => k.nome.trim().toLowerCase() === (scelte[x.id] ?? "").trim().toLowerCase());
    if (!c) return setStato("Scegli il cliente dall'elenco");
    const { error } = await supabase.from("progetti_file").update({ cliente_id: c.id, stato: "smistato", a_mano: true, motivo: "assegnato a mano", aggiornato_il: new Date().toISOString() }).eq("id", x.id);
    if (error) return setStato("Errore: " + error.message);
    setStato(`"${x.nome_file}" → ${c.nome}`);
    carica();
  };
  const cambia = async (x: Riga, v: Partial<ProgettoFile>, messaggio: string) => {
    const { error } = await supabase.from("progetti_file").update({ ...v, a_mano: true, aggiornato_il: new Date().toISOString() }).eq("id", x.id);
    if (error) return setStato("Errore: " + error.message);
    setStato(messaggio);
    carica();
  };
  const aggiorna = async () => {
    setInCorso(true);
    const e = await smistaProgetti(setStato).catch(() => null);
    setStato(e && (e.smistati || e.daSmistare) ? `${e.smistati} smistati · ${e.daSmistare} da smistare` : "Niente di nuovo.");
    await carica();
    setInCorso(false);
  };

  const quanti = (f: Filtro) => (righe ?? []).filter((x) => f === "tutti" || (f === "assegnati") === assegnato(x)).length;
  return (
    <div className="pagina-progetti">
      <div className="testata">
        <h1><span className="icona-titolo">{preventivi ? <FileStack size={20} /> : <FolderOpen size={20} />}</span>{preventivi ? "Preventivi fornitori" : "Progetti e documenti"}</h1>
        <div className="ricerca">
          <label><Search size={16} /><input type="search" placeholder={preventivi ? "Cerca fornitore, cliente, offerta…" : "Cerca file, cliente, mail…"} value={cerca} onChange={(e) => setCerca(e.target.value)} /></label>
        </div>
        <div className="pulsanti">
          <button className="btn grigio" disabled={inCorso} onClick={aggiorna} title="Smista i file nuovi e aggiorna"><RefreshCw size={16} /></button>
        </div>
      </div>
      <p className="piccolo">{preventivi
        ? "Le offerte e i preventivi mandati per mail dai fornitori (Palagini, CLLAT, MEF…), raggruppati per fornitore. Quelli con il cliente riconosciuto sono anche nella sua scheda → \"Preventivi da fornitori\"."
        : "Progetti, schede tecniche, brochure e documenti (cartella Drive \"Progetti clienti\" e mail), raggruppati per argomento. Quelli assegnati sono anche nella scheda del cliente → \"Progetti e schede\"."}</p>
      <div className="sc-rapidi">
        {(["tutti", "da_smistare", "assegnati"] as Filtro[]).map((f) => (
          <button key={f} className={`sc-filtro${filtro === f ? " attivo" : ""}`} onClick={() => setFiltro(f)}>
            {{ tutti: "Tutti", da_smistare: "Senza cliente", assegnati: "Con cliente" }[f]} ({quanti(f)})
          </button>
        ))}
      </div>
      {errore && <p className="errore">{errore}</p>}
      {stato && <p className={stato.startsWith("Errore") ? "errore" : "ok"}>{stato}</p>}
      {!righe && !errore && <p className="piccolo">Caricamento…</p>}
      {righe && !visibili.length && <p className="vuoto-linguetta">Nessun file{cerca ? " trovato" : ""}.</p>}
      {gruppi.map(([g, lista]) => (
        <div key={g} className="pc-cartella ep-gruppo">
          <div className="pc-testa ep-testa"><span className="pc-icona">{preventivi ? "🏷️" : iconaCategoria(g)}</span> <b>{g}</b> <span className="piccolo">({lista.length})</span></div>
          {lista.map((x) => (
            <div key={x.id} className={`ep-file${assegnato(x) ? "" : " senza-cliente"}`}>
              {/* Riga 1: nome del file a sinistra, cliente sempre allineato a destra */}
              <div className="ep-riga1">
                <span className="ep-nome">
                  <button type="button" className="link pc-nome" title="Apri il file" onClick={() => apriProgetto(x)}>{preventivi ? titoloSenzaFornitore(x) : x.nome_file}</button>
                  <span className="piccolo">{new Date(x.creato_il).toLocaleDateString("it-IT")}{x.mail?.oggetto && !preventivi ? ` · mail: ${x.mail.oggetto}` : ""}</span>
                </span>
                <span className={`ep-cliente${assegnato(x) ? "" : " nessuno"}`}>{assegnato(x) ? `👤 ${x.cliente?.nome}` : "senza cliente"}</span>
              </div>
              {/* Riga 2: i pulsanti */}
              <div className="ep-riga2">
                <MailProgetto mail={x.mail} />
                {puoModificare && <>
                  {!assegnato(x) && <span className="ep-assegna"><Autocompleta id={`ep-${x.id}`} valore={scelte[x.id] ?? ""} opzioni={clienti.map((c) => c.nome)} placeholder="Scegli il cliente…"
                    onCambia={(t) => setScelte((s) => ({ ...s, [x.id]: t }))} />
                    <button type="button" className="btn blu piccolo-btn" onClick={() => assegna(x)}>Assegna</button></span>}
                  {!preventivi && <select value={x.categoria ?? "Altro"} title="Sposta in un'altra cartella" onChange={(e) => cambia(x, { categoria: e.target.value }, `"${x.nome_file}" → ${e.target.value}`)}>
                    {NOMI_CATEGORIE.map((n) => <option key={n} value={n}>{iconaCategoria(n)} {n}</option>)}
                  </select>}
                  {assegnato(x) && <button type="button" className="btn grigio piccolo-btn" title="Non è di questo cliente"
                    onClick={() => confirm(`Togliere "${x.nome_file}" da ${x.cliente?.nome}?`) && cambia(x, { cliente_id: null, stato: "da_smistare" }, "Tolto dal cliente")}>Non è suo</button>}
                  <button type="button" className="btn grigio piccolo-btn" onClick={() => confirm(`Scartare "${x.nome_file}"? Non comparirà più (resta su Drive).`) && cambia(x, { stato: "scartato" }, "Scartato")}>Scarta</button>
                </>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
