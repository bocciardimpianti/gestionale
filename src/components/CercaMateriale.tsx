import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { euro } from "./Griglia";

type Materiale = Record<string, unknown> & { id: number };

// Ricerca di un materiale di magazzino da aggiungere alle righe (per descrizione, codice o codice a barre)
export default function CercaMateriale({ onChiudi, onScegli }: { onChiudi: () => void; onScegli: (m: Materiale) => void }) {
  const [testo, setTesto] = useState("");
  const [risultati, setRisultati] = useState<Materiale[]>([]);
  const [aggiunti, setAggiunti] = useState(0);

  useEffect(() => {
    const parole = testo.trim().split(/\s+/).filter((p) => p.length > 1);
    if (!parole.length) return setRisultati([]);
    const attesa = setTimeout(async () => {
      // Ogni parola deve comparire in descrizione, nome articolo, codice interno o codice a barre
      let q = supabase.from("materiali").select("*").is("eliminato_il", null);
      for (const p of parole) {
        const t = p.replace(/[%,()]/g, "");
        q = q.or(`descrizione.ilike.%${t}%,nome_articolo.ilike.%${t}%,codice_interno.ilike.%${t}%,codice_barre.ilike.%${t}%`);
      }
      const { data } = await q.order("descrizione").limit(60);
      setRisultati((data as Materiale[]) ?? []);
    }, 250);
    return () => clearTimeout(attesa);
  }, [testo]);

  return (
    <div className="velo" onMouseDown={onChiudi}>
      <div className="finestra" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Cerca nei materiali<button type="button" className="chiudi" onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo cerca-materiale">
          <input autoFocus placeholder="Scrivi descrizione, codice o codice a barre…" value={testo} onChange={(e) => setTesto(e.target.value)} />
          <div className="risultati">
            <table className="griglia">
              <thead><tr><th>Codice</th><th>Descrizione</th><th>UM</th><th className="destra">Prezzo</th><th className="destra">Giacenza</th></tr></thead>
              <tbody>
                {risultati.map((m) => (
                  <tr key={m.id} onClick={() => { onScegli(m); setAggiunti((n) => n + 1); }} title="Clicca per aggiungere">
                    <td>{String(m.codice_interno ?? "")}</td>
                    <td>{String(m.descrizione ?? "")}</td>
                    <td>{String(m.unita_misura ?? "")}</td>
                    <td className="destra">{euro(m.prezzo_ricaricato)}</td>
                    <td className="destra">{Number(m.giacenza ?? 0).toLocaleString("it-IT")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {testo.trim() && !risultati.length && <p className="vuoto-linguetta">Nessun materiale trovato.</p>}
          </div>
        </div>
        <div className="finestra-piede">
          <span className="ok">{aggiunti ? `${aggiunti} righe aggiunte` : "Clicca su un materiale per aggiungerlo"}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn blu" onClick={onChiudi}>Fine</button>
        </div>
      </div>
    </div>
  );
}
