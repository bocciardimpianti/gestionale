import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../supabase";

type Voce = Record<string, unknown> & { nome: string; ordine: number };

// Gestione di un archivio semplice (es. tipologie di pagamento), solo admin.
// "colonne" aggiunge campi numerici oltre al nome (es. importi di una tariffa).
export default function GestioneElenco({ titolo, tabella, colonne = [], onChiudi }: {
  titolo: string;
  tabella: string;
  colonne?: { chiave: string; etichetta: string }[];
  onChiudi: () => void;
}) {
  const [voci, setVoci] = useState<Voce[]>([]);
  const [nuova, setNuova] = useState<Record<string, string>>({});
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
    const record: Record<string, unknown> = { nome: (nuova.nome ?? "").trim(), ordine };
    for (const c of colonne) record[c.chiave] = nuova[c.chiave] ? Number(nuova[c.chiave]) : null;
    const { error } = await supabase.from(tabella).insert(record);
    if (error) return setErrore(error.message);
    setNuova({});
    carica();
  };

  const elimina = async (nome: string) => {
    if (!confirm(`Eliminare "${nome}"?`)) return;
    const { error } = await supabase.from(tabella).delete().eq("nome", nome);
    if (error) return setErrore(error.message);
    carica();
  };

  const formato = (v: unknown) => (v === null || v === undefined ? "" : Number(v).toLocaleString("it-IT", { minimumFractionDigits: 2 }));

  return (
    <div className="velo" onMouseDown={onChiudi}>
      <form className={`finestra ${colonne.length ? "" : "stretta"}`} onSubmit={aggiungi} onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">{titolo}<button type="button" className="chiudi" onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          <table className="griglia">
            {colonne.length > 0 && (
              <thead><tr><th>Nome</th>{colonne.map((c) => <th key={c.chiave}>{c.etichetta}</th>)}<th /></tr></thead>
            )}
            <tbody>
              {voci.map((v) => (
                <tr key={v.nome}>
                  <td>{v.nome}</td>
                  {colonne.map((c) => <td key={c.chiave} className="destra">{formato(v[c.chiave])}</td>)}
                  <td style={{ width: 1 }}><button type="button" className="pericolo" onClick={() => elimina(v.nome)}>Elimina</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="riga-aggiungi">
            <input value={nuova.nome ?? ""} onChange={(e) => setNuova({ ...nuova, nome: e.target.value })} placeholder="Nuova voce" required />
            {colonne.map((c) => (
              <input key={c.chiave} type="number" step="0.01" style={{ width: 110, flex: "none" }} placeholder={c.etichetta}
                value={nuova[c.chiave] ?? ""} onChange={(e) => setNuova({ ...nuova, [c.chiave]: e.target.value })} />
            ))}
            <button className="btn blu">Aggiungi</button>
          </div>
          {errore && <p className="errore">{errore}</p>}
        </div>
      </form>
    </div>
  );
}
