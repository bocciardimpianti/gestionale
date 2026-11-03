import { useEffect, useMemo, useState } from "react";
import { leggiTutto } from "../supabase";
import { calcolaConsigli, parolaChiave, type RigaStorico } from "../consigli";
import { euro } from "./Griglia";

type Materiale = Record<string, unknown> & { id: number };
type Dati = { storico: RigaStorico[]; materiali: Materiale[] };

// Voci che non sono materiali da proporre
const NON_MATERIALE = /^(ore |foro |manutenzione|imprevist|perdit|material[ei] vari|ferramenta)/i;

// Finestra del tasto "Consigliati" nel rapportino: propone i materiali usati di solito insieme a quelli già inseriti
export default function MaterialiConsigliati({ righe, onAggiungi, onChiudi }: {
  righe: Record<string, unknown>[];
  onAggiungi: (scelti: { materiale: Materiale; quantita: number }[]) => void;
  onChiudi: () => void;
}) {
  const [dati, setDati] = useState<Dati | null>(null);
  const [errore, setErrore] = useState("");
  const [tolti, setTolti] = useState<Set<number>>(new Set());

  // Si rilegge a ogni apertura: così contano anche i rapportini appena salvati
  useEffect(() => {
    Promise.all([
      leggiTutto("righe_rapporto", "id, rapporto_id, materiale_id, quantita, rapporto:rapporti(eliminato_il)"),
      leggiTutto("materiali", "id, codice_interno, descrizione, nome_articolo, codice_barre, unita_misura, prezzo_base, ricarico, prezzo_ricaricato, giacenza", true),
    ])
      .then(([storico, materiali]) => setDati({
        storico: storico.filter((r) => !(r.rapporto as { eliminato_il?: unknown } | null)?.eliminato_il) as unknown as RigaStorico[],
        materiali: materiali as Materiale[],
      }))
      .catch((e) => setErrore("Errore nel caricamento: " + (e as Error).message));
  }, []);

  const inseriti = useMemo(() => righe.map((r) => Number(r.materiale_id)).filter(Boolean), [righe]);

  const { consigli, perId, daSimili } = useMemo(() => {
    const perId = new Map((dati?.materiali ?? []).map((m) => [m.id, m]));
    if (!dati) return { consigli: [], perId, daSimili: false };
    const validi = (lista: ReturnType<typeof calcolaConsigli>) =>
      lista.filter((c) => perId.has(c.materialeId) && !NON_MATERIALE.test(String(perId.get(c.materialeId)!.descrizione ?? "")));
    const diretti = validi(calcolaConsigli(dati.storico, inseriti));
    if (diretti.length >= 3) return { consigli: diretti, perId, daSimili: false };
    // Materiale poco usato: si guardano anche quelli dello stesso tipo (es. un altro modello di caldaia)
    const chiavi = new Set(inseriti.map((id) => parolaChiave(perId.get(id)?.descrizione)).filter(Boolean));
    const semi = dati.materiali.filter((m) => chiavi.has(parolaChiave(m.descrizione))).map((m) => m.id);
    const conSimili = validi(calcolaConsigli(dati.storico, semi, inseriti));
    return conSimili.length > diretti.length ? { consigli: conSimili, perId, daSimili: true } : { consigli: diretti, perId, daSimili: false };
  }, [dati, inseriti]);

  const scelti = consigli.filter((c) => !tolti.has(c.materialeId));
  const cambia = (id: number) => setTolti((t) => {
    const n = new Set(t);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <div className="velo" onMouseDown={onChiudi}>
      <div className="finestra finestra-consigli" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Materiali consigliati<button type="button" className="chiudi" aria-label="Chiudi" onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo elenco-consigli">
          {errore && <p className="errore">{errore}</p>}
          {!dati && !errore && <p>Sto guardando i rapportini precedenti…</p>}
          {dati && !inseriti.length && <p>Aggiungi prima almeno un materiale dal magazzino, per esempio la caldaia: i consigli partono da lì.</p>}
          {dati && !!inseriti.length && !consigli.length && (
            <p>Non ci sono ancora abbastanza rapportini con questo materiale. I consigli compariranno man mano che ne salverete altri.</p>
          )}
          {!!consigli.length && (
            <p className="piccolo">
              {daSimili ? "Questo materiale è stato usato poco: i consigli vengono da materiali dello stesso tipo." : "In base ai rapportini con gli stessi materiali."} Togli la spunta a ciò che non serve.
            </p>
          )}
          {consigli.map((c) => {
            const m = perId.get(c.materialeId)!;
            return (
              <label key={c.materialeId} className="consiglio">
                <input type="checkbox" checked={!tolti.has(c.materialeId)} onChange={() => cambia(c.materialeId)} />
                <span className="consiglio-testi">
                  <b>{String(m.descrizione ?? "")}</b>
                  <span className="piccolo">Usato in {c.volte} rapportini su {c.su}, di solito {c.quantita.toLocaleString("it-IT")} {String(m.unita_misura ?? "")}</span>
                </span>
                <span className="consiglio-prezzo">{euro(m.prezzo_ricaricato)}</span>
              </label>
            );
          })}
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" onClick={onChiudi}>Annulla</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn blu" disabled={!scelti.length}
            onClick={() => { onAggiungi(scelti.map((c) => ({ materiale: perId.get(c.materialeId)!, quantita: c.quantita }))); onChiudi(); }}>
            {scelti.length === 1 ? "Aggiungi 1 materiale" : `Aggiungi ${scelti.length} materiali`}
          </button>
        </div>
      </div>
    </div>
  );
}
