import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../supabase";

// Gestione di un archivio semplice (es. tipologie di pagamento), solo admin
export default function GestioneElenco({ titolo, tabella, onChiudi }: { titolo: string; tabella: string; onChiudi: () => void }) {
  const [voci, setVoci] = useState<{ nome: string; ordine: number }[]>([]);
  const [nuova, setNuova] = useState("");
  const [errore, setErrore] = useState("");

  const carica = useCallback(async () => {
    const { data } = await supabase.from(tabella).select("*").order("ordine");
    setVoci(data ?? []);
  }, [tabella]);

  useEffect(() => {
    carica();
  }, [carica]);

  const aggiungi = async (e: FormEvent) => {
    e.preventDefault();
    const ordine = Math.max(0, ...voci.map((v) => v.ordine)) + 10;
    const { error } = await supabase.from(tabella).insert({ nome: nuova.trim(), ordine });
    if (error) return setErrore(error.message);
    setNuova("");
    carica();
  };

  const elimina = async (nome: string) => {
    if (!confirm(`Eliminare "${nome}"?`)) return;
    const { error } = await supabase.from(tabella).delete().eq("nome", nome);
    if (error) return setErrore(error.message);
    carica();
  };

  return (
    <div className="velo" onMouseDown={onChiudi}>
      <form className="finestra stretta" onSubmit={aggiungi} onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">{titolo}<button type="button" className="chiudi" onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          <table className="griglia">
            <tbody>
              {voci.map((v) => (
                <tr key={v.nome}>
                  <td>{v.nome}</td>
                  <td style={{ width: 1 }}><button type="button" className="pericolo" onClick={() => elimina(v.nome)}>Elimina</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="riga-aggiungi">
            <input value={nuova} onChange={(e) => setNuova(e.target.value)} placeholder="Nuova voce" required />
            <button className="btn blu">Aggiungi</button>
          </div>
          {errore && <p className="errore">{errore}</p>}
        </div>
      </form>
    </div>
  );
}
