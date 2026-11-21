import { useRef } from "react";
import { Camera, ExternalLink, FileUp, Image as IconaGalleria, Trash2 } from "lucide-react";
import { riduci, urlFirmato } from "./CampoImmagine";

// Documento da archiviare (PDF o foto): si carica al salvataggio della scheda.
// Su telefono e tablet si può anche scattare una foto del documento o prenderla dalla galleria.
export default function CampoDocumento({ etichetta, valore, archivio, modificabile, onCambia }: {
  etichetta: string; valore: unknown; archivio: string; modificabile: boolean; onCambia: (v: Blob | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const scegli = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    onCambia(f.type.startsWith("image/") ? await riduci(f) : f);
  };
  const apri = async () => {
    const finestra = window.open("", "_blank");
    const url = await urlFirmato(archivio, String(valore));
    if (finestra) finestra.location.href = url;
  };
  return (
    <div className="cornice campo-documento">
      <label>{etichetta}</label>
      <div className="contenuto-documento">
        {valore instanceof Blob ? (
          <span className="documento-pronto">📎 {(valore as File).name || "Documento"} – verrà archiviato al salvataggio</span>
        ) : typeof valore === "string" && valore ? (
          <button type="button" className="btn grigio piccolo-btn" onClick={apri}><ExternalLink size={14} /> Apri il documento</button>
        ) : <span className="piccolo">Nessun documento caricato</span>}
        {modificabile && (
          <span className="comandi-documento">
            {touch && <button type="button" className="btn blu piccolo-btn" onClick={() => fotoRef.current?.click()}><Camera size={14} /> Scatta</button>}
            <button type="button" className="btn blu piccolo-btn" onClick={() => fileRef.current?.click()}>
              {touch ? <><IconaGalleria size={14} /> Galleria / file</> : <><FileUp size={14} /> {valore ? "Sostituisci" : "Carica PDF o foto"}</>}
            </button>
            {!!valore && <button type="button" className="btn grigio piccolo-btn" title="Togli il documento" onClick={() => confirm("Togliere il documento?") && onCambia(null)}><Trash2 size={14} /></button>}
          </span>
        )}
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={scegli} />
      <input ref={fotoRef} type="file" accept="image/*" capture="environment" hidden onChange={scegli} />
    </div>
  );
}
