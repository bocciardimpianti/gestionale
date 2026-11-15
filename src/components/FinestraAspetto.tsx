import { useState } from "react";
import { Check } from "lucide-react";
import { PRESET_ASPETTO, aspettoScelto, scegliAspetto } from "../aspetto";
import { useIndietroChiude } from "../telefono";

// Impostazioni di aspetto di questo dispositivo: grandezza di testo, righe e colonne.
// La scelta si vede subito e resta salvata su questo telefono/PC.
export default function FinestraAspetto({ onChiudi }: { onChiudi: () => void }) {
  const [scelto, setScelto] = useState(aspettoScelto());
  useIndietroChiude(true, onChiudi);
  return (
    <div className="velo" onMouseDown={onChiudi}>
      <div className="finestra finestra-aspetto" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Aspetto e dimensioni<button type="button" className="chiudi" onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          <p className="piccolo">Grandezza di testo, righe e colonne su <b>questo dispositivo</b>. Sugli schermi piccoli "Compatto" o "Ridotto" mostrano più righe alla volta.</p>
          <div className="preset-aspetto">
            {PRESET_ASPETTO.map((p) => (
              <button type="button" key={p.chiave} className={p.chiave === scelto ? "attivo" : ""}
                onClick={() => { setScelto(p.chiave); scegliAspetto(p.chiave); }}>
                <span className="anteprima-aspetto" style={{ fontSize: `${Math.round(15 * p.zoom)}px` }}>Aa</span>
                <span className="testi-aspetto">
                  <b>{p.nome} <span className="piccolo">({Math.round(p.zoom * 100)}%)</span></b>
                  <span>{p.descrizione}</span>
                </span>
                {p.chiave === scelto && <Check size={20} />}
              </button>
            ))}
          </div>
        </div>
        <div className="finestra-piede">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn blu" onClick={onChiudi}>Fatto</button>
        </div>
      </div>
    </div>
  );
}
