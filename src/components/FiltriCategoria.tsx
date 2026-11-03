import { CATEGORIE, coloreCategoria } from "../categorie";

// Pulsanti rapidi delle categorie, ciascuna con il suo colore
export default function FiltriCategoria({ valore, onCambia, conteggi }: {
  valore: string;
  onCambia: (categoria: string) => void;
  conteggi?: Map<string, number>;
}) {
  return (
    <div className="filtri-categoria" role="group" aria-label="Categoria">
      <button type="button" className={valore ? "" : "attiva"} aria-pressed={!valore} onClick={() => onCambia("")}>Tutte</button>
      {CATEGORIE.map((c) => {
        const attiva = valore === c;
        const colore = coloreCategoria(c);
        return (
          <button type="button" key={c} className={attiva ? "attiva" : ""} aria-pressed={attiva} onClick={() => onCambia(attiva ? "" : c)}
            style={attiva ? { background: colore, borderColor: colore, color: "#fff" } : { borderColor: colore }}>
            {!attiva && <span className="pallino-categoria" style={{ background: colore }} />}
            {c}
            {conteggi && <span className="conteggio-categoria">{(conteggi.get(c) ?? 0).toLocaleString("it-IT")}</span>}
          </button>
        );
      })}
    </div>
  );
}
