import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, FolderOpen, Image as IconaGalleria, Pencil, Search, Sparkles, Trash2 } from "lucide-react";
import PropostaFoto, { proponiSubito } from "./PropostaFoto";
import { supabase } from "../supabase";

// Miniatura per la griglia: avvicinando il mouse o il pennino compare un'anteprima grande
export function Miniatura({ percorso, archivio }: { percorso: string; archivio: string }) {
  const url = useUrlImmagine(percorso, archivio);
  // Senza i bordi bianchi: il soggetto riempie la miniatura
  const ritagliata = useRitagliata(url, `${archivio}/${percorso}`);
  const anteprima = useAnteprima(ritagliata || url);
  return url ? <><img src={ritagliata || url} alt="" className="miniatura" loading="lazy" {...anteprima.eventi} />{anteprima.finestra}</> : null;
}

// Foto senza i bordi bianchi (o trasparenti) intorno al soggetto: si calcola una volta per foto e si ricorda.
// Se la foto non si può leggere (es. permessi del server) resta quella originale.
const ritagli = new Map<string, Promise<string>>();
const LATO_RITAGLIO = 320;
function ritaglia(url: string): Promise<string> {
  return new Promise((ok) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => ok("");
    img.onload = () => {
      try {
        const scala = Math.min(1, LATO_RITAGLIO * 2 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scala)), h = Math.max(1, Math.round(img.naturalHeight * scala));
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return ok("");
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        // "Vuoto": quasi bianco o trasparente
        const vuoto = (i: number) => d[i + 3] < 20 || (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235);
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (vuoto((y * w + x) * 4)) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 < 0) return ok("");
        // Un filo di margine; se i bordi sono già minimi non si tocca
        const m = Math.round(Math.max(w, h) * 0.02);
        x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
        if (cw * ch > w * h * 0.9) return ok("");
        const out = document.createElement("canvas");
        const s2 = Math.min(1, LATO_RITAGLIO / Math.max(cw, ch));
        out.width = Math.round(cw * s2); out.height = Math.round(ch * s2);
        out.getContext("2d")!.drawImage(c, x0, y0, cw, ch, 0, 0, out.width, out.height);
        out.toBlob((b) => ok(b ? URL.createObjectURL(b) : ""), "image/webp", 0.9);
      } catch { ok(""); }
    };
    img.src = url;
  });
}
export function useRitagliata(url: string, chiave: string) {
  const [r, setR] = useState("");
  useEffect(() => {
    setR("");
    if (!url || url.startsWith("blob:")) return;
    let attivo = true;
    let p = ritagli.get(chiave);
    if (!p) { p = ritaglia(url); ritagli.set(chiave, p); }
    p.then((u) => { if (attivo) setR(u); });
    return () => { attivo = false; };
  }, [url, chiave]);
  return r;
}

// Anteprima grande di una foto piccola, accanto al punto in cui si trova (mouse o pennino; non col dito, che tocca e basta)
const LATO = 320;
export function useAnteprima(url: string) {
  const [pos, setPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!pos) return;
    const chiudi = () => setPos(null);
    window.addEventListener("scroll", chiudi, true);
    window.addEventListener("pointerdown", chiudi, true);
    return () => { window.removeEventListener("scroll", chiudi, true); window.removeEventListener("pointerdown", chiudi, true); };
  }, [pos]);
  const eventi = {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "touch" || !url) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (r.height >= 110) return; // già grande (es. galleria)
      setPos({ x: r.left, y: r.top, w: r.width, h: r.height });
    },
    onPointerLeave: () => setPos(null),
  };
  let finestra: React.ReactNode = null;
  if (pos && url) {
    const vw = window.innerWidth, vh = window.innerHeight;
    // A destra della foto se c'è spazio, altrimenti a sinistra; in verticale dentro lo schermo
    const x = pos.x + pos.w + 12 + LATO <= vw ? pos.x + pos.w + 12 : Math.max(8, pos.x - LATO - 12);
    const y = Math.min(Math.max(8, pos.y + pos.h / 2 - LATO / 2), vh - LATO - 8);
    finestra = createPortal(<div className="anteprima-foto" style={{ left: x, top: y, width: LATO, height: LATO }}><img src={url} alt="" /></div>, document.body);
  }
  return { eventi, finestra };
}

// Link temporanei già ottenuti, per non richiederli di nuovo (es. miniature della griglia)
const cache = new Map<string, { url: string; scade: number }>();

export async function urlFirmato(archivio: string, percorso: string) {
  const chiave = `${archivio}/${percorso}`;
  const c = cache.get(chiave);
  if (c && c.scade > Date.now()) return c.url;
  const { data } = await supabase.storage.from(archivio).createSignedUrl(percorso, 3600);
  const url = data?.signedUrl ?? "";
  if (url) cache.set(chiave, { url, scade: Date.now() + 50 * 60 * 1000 });
  return url;
}

// Restituisce l'indirizzo da mostrare: anteprima locale (file non ancora salvato) o link temporaneo firmato.
// "archivio" è l'archivio file della sezione (es. "rapporti", "materiali").
export function useUrlImmagine(valore: unknown, archivio: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (valore instanceof Blob) {
      const u = URL.createObjectURL(valore);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    if (typeof valore === "string" && valore) {
      let attivo = true;
      urlFirmato(archivio, valore).then((u) => attivo && setUrl(u));
      return () => {
        attivo = false;
      };
    }
    setUrl("");
  }, [valore, archivio]);
  return url;
}

// Riquadro immagine come nella linguetta Dettaglio: Foto (apri/elimina) o Firma (disegna)
export default function CampoImmagine({ etichetta, valore, firma, modificabile, onCambia, archivio, cerca, fotoVeloce }: {
  etichetta: string;
  // Testo per la ricerca dell'immagine su Google Immagini (es. codice fornitore + descrizione)
  cerca?: string;
  archivio: string;
  valore: unknown;
  firma?: boolean;
  modificabile: boolean;
  onCambia: (v: Blob | null) => void;
  // Vista "Senza foto": la proposta automatica può aprirsi da sola a ogni materiale
  fotoVeloce?: boolean;
}) {
  const url = useUrlImmagine(valore, archivio);
  const anteprima = useAnteprima(url);
  const fileRef = useRef<HTMLInputElement>(null);
  // Telefono e tablet: "Scatta" apre la fotocamera, "Galleria" le foto già salvate sul dispositivo
  const fotocameraRef = useRef<HTMLInputElement>(null);
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const [disegna, setDisegna] = useState(false);
  const [sopra, setSopra] = useState(false);
  const [avviso, setAvviso] = useState("");
  const [proposta, setProposta] = useState(false);
  // Foto veloce con "proponi anche al successivo": la proposta si apre da sola sui materiali senza foto
  useEffect(() => {
    if (fotoVeloce && modificabile && !firma && cerca && !valore && proponiSubito()) setProposta(true);
  }, [cerca]); // eslint-disable-line react-hooks/exhaustive-deps

  // Immagine incollata (Ctrl+V) o trascinata nel riquadro
  const daTrasferimento = async (dt: DataTransfer | null) => {
    if (!dt || !modificabile || firma) return;
    const b = await immagineDa(dt);
    if (b) { setAvviso(""); onCambia(b); return; }
    setAvviso("Immagine non leggibile: sull'immagine fai clic destro → \"Copia immagine\", poi clicca qui e premi Ctrl+V");
  };

  return (
    <div
      className={`cornice cornice-immagine${sopra ? " trascina" : ""}`}
      tabIndex={modificabile && !firma ? 0 : undefined}
      onPaste={(e) => {
        if ([...e.clipboardData.items].some((i) => i.type.startsWith("image/")) || e.clipboardData.getData("text/plain").startsWith("http")) {
          e.preventDefault();
          daTrasferimento(e.clipboardData);
        }
      }}
      onDragOver={(e) => { if (modificabile && !firma) { e.preventDefault(); setSopra(true); } }}
      onDragLeave={() => setSopra(false)}
      onDrop={(e) => { e.preventDefault(); setSopra(false); daTrasferimento(e.dataTransfer); }}
    >
      <label>{etichetta}</label>
      <div className="contenuto-immagine">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" title="Apri a grandezza intera"><img src={url} alt={etichetta} {...anteprima.eventi} /></a>
        ) : null}
        {modificabile && (
          <span className="comandi-immagine">
            {!firma && touch && (
              <>
                <button type="button" className="con-testo" title="Scatta una foto" onClick={() => fotocameraRef.current?.click()}><Camera size={15} /> Scatta</button>
                <button type="button" className="con-testo" title="Scegli dalla galleria" onClick={() => fileRef.current?.click()}><IconaGalleria size={15} /> Galleria</button>
              </>
            )}
            {!firma && !touch && (
              <button type="button" title="Scegli una foto dal computer" onClick={() => fileRef.current?.click()}><FolderOpen size={14} /></button>
            )}
            {!!valore && <button type="button" title="Elimina" onClick={() => confirm(`Eliminare ${etichetta.toLowerCase()}?`) && onCambia(null)}><Trash2 size={14} /></button>}
            {firma && <button type="button" title="Firma" onClick={() => setDisegna(true)}><Pencil size={14} /></button>}
          </span>
        )}
        {modificabile && !firma && cerca && (
          <button type="button" className="cerca-foto" title="Apre Google Immagini in una nuova scheda"
            onClick={() => window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(cerca)}`, "_blank", "noopener")}>
            <Search size={13} /> Cerca foto
          </button>
        )}
        {modificabile && !firma && cerca && (
          <button type="button" className="cerca-foto proponi-foto" title="Cerco io la foto su internet e te la propongo"
            onClick={() => setProposta(true)}>
            <Sparkles size={13} /> Proponi foto
          </button>
        )}
        {modificabile && !firma && !url && (
          <span className="suggerimento-foto">{avviso || (touch ? "Scatta una foto o sceglila dalla galleria" : "Clicca qui e premi Ctrl+V per incollare un'immagine, oppure trascinala dentro")}</span>
        )}
        {avviso && url && <span className="suggerimento-foto errore">{avviso}</span>}
      </div>
      {/* Senza "capture": su Android e iPhone permette di scegliere dalla galleria (o dai file) */}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) onCambia(await riduci(f));
      }} />
      <input ref={fotocameraRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) onCambia(await riduci(f));
      }} />
      {proposta && cerca && <PropostaFoto testo={cerca} fotoVeloce={fotoVeloce} onChiudi={() => setProposta(false)}
        onScelta={(b) => { setProposta(false); setAvviso(""); onCambia(b); }} />}
      {!firma && anteprima.finestra}
      {disegna && <PadFirma onChiudi={() => setDisegna(false)} onConferma={(b) => { onCambia(b); setDisegna(false); }} />}
    </div>
  );
}

// Riduce le foto del telefono (spesso 4-8 MB) a max 1600 px, in JPEG
/** Immagine da appunti o trascinamento (file, oppure indirizzo da scaricare), già ridotta; null se non leggibile */
export async function immagineDa(dt: DataTransfer): Promise<Blob | null> {
  const file = [...dt.files].find((f) => f.type.startsWith("image/"))
    ?? [...dt.items].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
  if (file) return riduci(file);
  // Dal browser a volte arriva solo l'indirizzo dell'immagine: proviamo a scaricarla
  const indirizzo = dt.getData("text/uri-list") || dt.getData("text/plain");
  if (/^(https?:|data:image)/.test(indirizzo)) {
    try {
      const r = await fetch(indirizzo);
      const b = await r.blob();
      if (b.type.startsWith("image/")) return riduci(new File([b], "foto", { type: b.type }));
    } catch {
      /* il sito non permette di scaricare l'immagine */
    }
  }
  return null;
}

export async function riduci(file: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(file);
    const scala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scala);
    canvas.height = Math.round(img.height * scala);
    const ctx = canvas.getContext("2d")!;
    // Sfondo bianco: le immagini trasparenti (PNG) in JPEG diventerebbero nere
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
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
