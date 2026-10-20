import { useEffect, useState, type FormEvent } from "react";
import { CreditCard, Maximize2, Minimize2, Minus, Phone, X } from "lucide-react";
import { registra, supabase, vuoto } from "../supabase";
import { useAuth } from "../auth";
import type { Archivio, Campo } from "../archivi";
import type { Cartella } from "../pages/PaginaArchivio";
import GestioneElenco from "./GestioneElenco";

interface Props {
  cfg: Archivio;
  valori: Record<string, unknown>;
  onChiudi: () => void;
  onSalvato: (id: number) => void;
  onElimina: () => void;
  cartelle: Cartella[];
  nelCestino: boolean;
  onSposta: (archivio: Cartella | null) => void;
}

// Finestra di dettaglio come nel programma originale: linguette, campi incorniciati, piede con Salva/Azioni/Chiudi
export default function Scheda({ cfg, valori, onChiudi, onSalvato, onElimina, cartelle, nelCestino, onSposta }: Props) {
  const { puo, profilo } = useAuth();
  const nuovo = valori.id === undefined;
  const modificabile = !nelCestino && (nuovo ? puo(cfg.sezione, "creare") : puo(cfg.sezione, "modificare"));
  const [gestione, setGestione] = useState<Campo | null>(null);
  const [versioneOpzioni, setVersioneOpzioni] = useState(0);
  const [dati, setDati] = useState<Record<string, unknown>>(valori);
  const [opzioni, setOpzioni] = useState<Record<string, { valore: string; etichetta: string }[]>>({});
  const [linguetta, setLinguetta] = useState("Principale");
  const [stato, setStato] = useState("Pronto");
  const [ingrandita, setIngrandita] = useState(false);
  const [ridotta, setRidotta] = useState(false);
  const [menuAzioni, setMenuAzioni] = useState(false);

  useEffect(() => {
    for (const c of cfg.campi.filter((c) => c.opzioniDa)) {
      supabase.from(c.opzioniDa!).select("nome").order("ordine").then(({ data }) =>
        setOpzioni((o) => ({ ...o, [c.chiave]: (data ?? []).map((r) => ({ valore: r.nome, etichetta: r.nome })) })),
      );
    }
    for (const c of cfg.campi.filter((c) => c.opzioniRpc)) {
      supabase.rpc(c.opzioniRpc!).then(({ data }) =>
        setOpzioni((o) => ({ ...o, [c.chiave]: ((data ?? []) as { id: string; nome: string }[]).map((r) => ({ valore: r.id, etichetta: r.nome })) })),
      );
    }
  }, [cfg.campi, versioneOpzioni]);

  const salva = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!modificabile) return;
    const record: Record<string, unknown> = {};
    for (const c of cfg.campi.filter((c) => c.tipo !== "titolo")) {
      record[c.chiave] = vuoto(dati[c.chiave]) ? null : String(dati[c.chiave]).trim();
    }
    if (nuovo && valori.archivio_id) record.archivio_id = valori.archivio_id;
    const obbligatorio = cfg.campi.find((c) => c.obbligatorio && vuoto(record[c.chiave]));
    if (obbligatorio) return setStato(`Compilare il campo "${obbligatorio.etichetta}"`);
    setStato("Salvataggio…");
    const risposta = nuovo
      ? await supabase.from(cfg.tabella).insert(record).select("id").single()
      : await supabase.from(cfg.tabella).update(record).eq("id", valori.id).select("id").single();
    if (risposta.error) return setStato("Errore: " + risposta.error.message);
    await registra(`${cfg.sezione}_${nuovo ? "creato" : "modificato"}`, { id: risposta.data.id, nome: record[cfg.colonne[0].chiave] });
    onSalvato(risposta.data.id);
  };

  const campo = (c: Campo, aCapo: boolean) => {
    if (c.tipo === "titolo") return <div key={c.chiave} className={`sezione-scheda ${c.stile ?? "grigio"}`}>{c.etichetta}</div>;
    const valore = String(dati[c.chiave] ?? "");
    const props = {
      id: `campo-${c.chiave}`,
      value: valore,
      readOnly: !modificabile,
      onChange: (e: { target: { value: string } }) => setDati({ ...dati, [c.chiave]: e.target.value }),
    };
    let controllo;
    if (c.tipo === "area") controllo = <textarea rows={2} {...props} />;
    else if (c.tipo === "scelta")
      controllo = (
        <span className="scelta">
          <select {...props} disabled={!modificabile}>
            <option value="" />
            {(opzioni[c.chiave] ?? []).map((o) => <option key={o.valore} value={o.valore}>{o.etichetta}</option>)}
          </select>
          {profilo?.ruolo === "admin" && c.titoloOpzioni && (
            <button type="button" title={`Gestisci ${c.titoloOpzioni}`} onClick={() => setGestione(c)}>…</button>
          )}
        </span>
      );
    else controllo = <input {...props} />;

    return (
      <div key={c.chiave} className={`cornice${c.finisciRiga ? " fine-riga" : ""}`}
        style={{ gridColumn: c.larghezza === 4 ? "1 / -1" : `${aCapo ? "1 / " : ""}span ${(c.larghezza ?? 2) * 2}` }}>
        <label htmlFor={props.id}>{c.etichetta}</label>
        {controllo}
        {c.tipo === "telefono" && (
          <a className="chiama" href={valore ? `tel:${valore.replace(/\s/g, "")}` : undefined} title="Chiama">
            <Phone size={13} strokeWidth={2} />
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="velo" onMouseDown={onChiudi}>
      <form
        className={`finestra-scheda${ingrandita ? " ingrandita" : ""}`}
        onSubmit={salva}
        onMouseDown={(e) => { e.stopPropagation(); setMenuAzioni(false); }}
      >
        <div className="scheda-titolo">
          <span><CreditCard size={14} /> {nuovo ? cfg.titoloNuovo : String(valori[cfg.colonne[0].chiave] ?? "")}</span>
          <span className="comandi">
            <button type="button" title="Riduci" onClick={() => setRidotta(!ridotta)}><Minus size={16} strokeWidth={3} /></button>
            <button type="button" title="Ingrandisci" onClick={() => setIngrandita(!ingrandita)}>
              {ingrandita ? <Minimize2 size={13} strokeWidth={3} /> : <Maximize2 size={13} strokeWidth={3} />}
            </button>
            <button type="button" title="Chiudi" onClick={onChiudi}><X size={17} strokeWidth={3} /></button>
          </span>
        </div>

        {!ridotta && (
          <>
            <div className="scheda-corpo">
              <div className="linguette">
                {["Principale", ...(cfg.linguette ?? [])].map((l) => (
                  <button type="button" key={l} className={l === linguetta ? "attiva" : ""} onClick={() => setLinguetta(l)}>{l}</button>
                ))}
              </div>
              <div className="pannello-linguetta">
                {linguetta === "Principale" ? (
                  <div className="griglia-campi">{cfg.campi.map((c, i) => campo(c, !!cfg.campi[i - 1]?.finisciRiga))}</div>
                ) : linguetta === "Log Cloud" ? (
                  <LogRecord sezione={cfg.sezione} id={valori.id as number | undefined} />
                ) : (
                  <p className="vuoto-linguetta">Questa linguetta verrà completata quando ricreiamo la sezione collegata.</p>
                )}
              </div>
            </div>

            <div className="scheda-piede">
              <span className={stato.startsWith("Errore") || stato.startsWith("Compilare") ? "errore" : ""}>{stato}</span>
              <span className="utente-scheda" title="Utente collegato: le modifiche vengono registrate a suo nome">
                {profilo?.ruolo === "admin" ? "Amministrazione" : profilo?.nome || profilo?.email}
              </span>
              <span className="comandi-piede">
                {modificabile && <button type="submit" className="link blu">Salva</button>}
                {!nuovo && (
                  <span className="tendina-piede">
                    <button type="button" className="link verde" onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenuAzioni(!menuAzioni)}>Azioni</button>
                    {menuAzioni && (
                      <div className="voci" onMouseDown={(e) => e.stopPropagation()}>
                        {!nelCestino && puo(cfg.sezione, "modificare") && (
                          <>
                            {cartelle.filter((a) => a.id !== valori.archivio_id).map((a) => (
                              <button type="button" key={a.id} onClick={() => onSposta(a)}>Sposta in "{a.nome}"</button>
                            ))}
                            {!!valori.archivio_id && <button type="button" onClick={() => onSposta(null)}>Togli dall'archivio</button>}
                          </>
                        )}
                        {!nelCestino && puo(cfg.sezione, "eliminare") && <button type="button" onClick={onElimina}>Elimina</button>}
                        {dati.email ? <a href={`mailto:${dati.email}`}>Invia e-mail</a> : null}
                      </div>
                    )}
                  </span>
                )}
                <button type="button" className="link rosso" onClick={onChiudi}>Chiudi</button>
              </span>
            </div>
          </>
        )}
      </form>
      {gestione && (
        <div onMouseDown={(e) => e.stopPropagation()}>
          <GestioneElenco
          titolo={gestione.titoloOpzioni!}
          tabella={gestione.opzioniDa!}
            onChiudi={() => { setGestione(null); setVersioneOpzioni((v) => v + 1); }}
          />
        </div>
      )}
    </div>
  );
}

// Storico delle modifiche del record (dal registro attività, visibile all'admin)
function LogRecord({ sezione, id }: { sezione: string; id?: number }) {
  const [voci, setVoci] = useState<{ id: number; azione: string; il: string; profili: { email: string } | null }[] | null>(null);

  useEffect(() => {
    if (id === undefined) return setVoci([]);
    supabase
      .from("registro")
      .select("id, azione, il, profili(email)")
      .like("azione", `${sezione}_%`)
      .eq("dettagli->>id", String(id))
      .order("il", { ascending: false })
      .then(({ data }) => setVoci((data as never) ?? []));
  }, [sezione, id]);

  if (!voci) return <p className="vuoto-linguetta">Caricamento…</p>;
  if (!voci.length) return <p className="vuoto-linguetta">Nessuna modifica registrata.</p>;
  return (
    <table className="griglia">
      <thead><tr><th>Data e ora</th><th>Utente</th><th>Operazione</th></tr></thead>
      <tbody>
        {voci.map((v) => (
          <tr key={v.id}>
            <td>{new Date(v.il).toLocaleString("it-IT")}</td>
            <td>{v.profili?.email ?? "—"}</td>
            <td>{v.azione.replace(`${sezione}_`, "")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
