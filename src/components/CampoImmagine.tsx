import { useEffect, useRef, useState } from "react";
import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import { supabase } from "../supabase";

export const ARCHIVIO_FILE = "rapporti";

// Restituisce l'indirizzo da mostrare: anteprima locale (file non ancora salvato) o link temporaneo firmato
export function useUrlImmagine(valore: unknown) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (valore instanceof Blob) {
      const u = URL.createObjectURL(valore);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    if (typeof valore === "string" && valore) {
      supabase.storage.from(ARCHIVIO_FILE).createSignedUrl(valore, 3600).then(({ data }) => setUrl(data?.signedUrl ?? ""));
    } else setUrl("");
  }, [valore]);
  return url;
}

// Riquadro immagine come nella linguetta Dettaglio: Foto (apri/elimina) o Firma (disegna)
export default function CampoImmagine({ etichetta, valore, firma, modificabile, onCambia }: {
  etichetta: string;
  valore: unknown;
  firma?: boolean;
  modificabile: boolean;
  onCambia: (v: Blob | null) => void;
}) {
  const url = useUrlImmagine(valore);
  const fileRef = useRef<HTMLInputElement>(null);
  const [disegna, setDisegna] = useState(false);

  return (
    <div className="cornice cornice-immagine">
      <label>{etichetta}</label>
      <div className="contenuto-immagine">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" title="Apri a grandezza intera"><img src={url} alt={etichetta} /></a>
        ) : null}
        {modificabile && (
          <span className="comandi-immagine">
            {!firma && (
              <button type="button" title="Scegli foto o scatta" onClick={() => fileRef.current?.click()}><FolderOpen size={14} /></button>
            )}
            {!!valore && <button type="button" title="Elimina" onClick={() => confirm(`Eliminare ${etichetta.toLowerCase()}?`) && onCambia(null)}><Trash2 size={14} /></button>}
            {firma && <button type="button" title="Firma" onClick={() => setDisegna(true)}><Pencil size={14} /></button>}
          </span>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) onCambia(await riduci(f));
      }} />
      {disegna && <PadFirma onChiudi={() => setDisegna(false)} onConferma={(b) => { onCambia(b); setDisegna(false); }} />}
    </div>
  );
}

// Riduce le foto del telefono (spesso 4-8 MB) a max 1600 px, in JPEG
async function riduci(file: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(file);
    const scala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scala);
    canvas.height = Math.round(img.height * scala);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((ok) => canvas.toBlob((b) => ok(b ?? file), "image/jpeg", 0.82));
  } catch {
    return file;
  }
}

// Riquadro per firmare con dito, penna o mouse
function PadFirma({ onChiudi, onConferma }: { onChiudi: () => void; onConferma: (b: Blob) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const disegnando = useRef(false);
  const [vuota, setVuota] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1a237e";
  }, []);

  const punto = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.current!.width / r.width), (e.clientY - r.top) * (canvas.current!.height / r.height)];
  };

  const cancella = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setVuota(true);
  };

  return (
    <div className="velo" onMouseDown={(e) => { e.stopPropagation(); onChiudi(); }}>
      <div className="finestra" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Firma cliente<button type="button" className="chiudi" onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          <canvas
            ref={canvas}
            width={900}
            height={300}
            className="pad-firma"
            onPointerDown={(e) => {
              disegnando.current = true;
              (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
              const ctx = canvas.current!.getContext("2d")!;
              const [x, y] = punto(e);
              ctx.beginPath();
              ctx.moveTo(x, y);
            }}
            onPointerMove={(e) => {
              if (!disegnando.current) return;
              const ctx = canvas.current!.getContext("2d")!;
              const [x, y] = punto(e);
              ctx.lineTo(x, y);
              ctx.stroke();
              setVuota(false);
            }}
            onPointerUp={() => (disegnando.current = false)}
          />
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" onClick={cancella}>Cancella</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn grigio" onClick={onChiudi}>Annulla</button>
          <button type="button" className="btn blu" disabled={vuota}
            onClick={() => canvas.current!.toBlob((b) => b && onConferma(b), "image/png")}>Conferma</button>
        </div>
      </div>
    </div>
  );
}
