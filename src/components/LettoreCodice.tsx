import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

// Lettura del codice a barre con la fotocamera del telefono.
// Usa il lettore integrato del browser quando c'è (Android/Chrome), altrimenti la libreria ZXing (anche iPhone).
// Al primo codice letto chiama onLetto e si chiude; si può sempre scrivere il codice a mano.

type Rilevatore = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type CostruttoreRilevatore = new (o: { formats: string[] }) => Rilevatore;

const FORMATI = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code", "data_matrix"];

export default function LettoreCodice({ onLetto, onChiudi }: { onLetto: (codice: string) => void; onChiudi: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [errore, setErrore] = useState("");
  const [manuale, setManuale] = useState("");
  const letto = useRef(false);

  useEffect(() => {
    let attivo = true;
    let flusso: MediaStream | null = null;
    let fermaZxing: (() => void) | null = null;
    let timer = 0;

    const trovato = (codice: string) => {
      if (letto.current || !codice.trim()) return;
      letto.current = true;
      navigator.vibrate?.(80);
      onLetto(codice.trim());
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrore("Questo browser non permette di usare la fotocamera: scrivi il codice qui sotto.");
        return;
      }
      const Nativo = (window as unknown as { BarcodeDetector?: CostruttoreRilevatore }).BarcodeDetector;
      try {
        if (Nativo) {
          flusso = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
          if (!attivo || !video.current) return;
          video.current.srcObject = flusso;
          await video.current.play();
          const rilevatore = new Nativo({ formats: FORMATI });
          const cerca = async () => {
            if (!attivo || letto.current || !video.current) return;
            try {
              const risultati = await rilevatore.detect(video.current);
              if (risultati[0]?.rawValue) return trovato(risultati[0].rawValue);
            } catch { /* fotogramma non leggibile */ }
            timer = window.setTimeout(cerca, 150);
          };
          cerca();
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const lettore = new BrowserMultiFormatReader();
          const controlli = await lettore.decodeFromConstraints(
            { video: { facingMode: { ideal: "environment" } }, audio: false },
            video.current ?? undefined,
            (risultato) => { if (risultato) trovato(risultato.getText()); },
          );
          fermaZxing = () => controlli.stop();
          if (!attivo) fermaZxing();
        }
      } catch (e) {
        const nome = (e as Error).name;
        setErrore(
          nome === "NotAllowedError" ? "Permesso per la fotocamera negato: consentilo nelle impostazioni del browser, oppure scrivi il codice qui sotto."
          : nome === "NotFoundError" ? "Nessuna fotocamera trovata: scrivi il codice qui sotto."
          : "Impossibile avviare la fotocamera: scrivi il codice qui sotto.",
        );
      }
    })();

    return () => {
      attivo = false;
      window.clearTimeout(timer);
      fermaZxing?.();
      flusso?.getTracks().forEach((t) => t.stop());
    };
  }, [onLetto]);

  return (
    <div className="lettore-codice" onMouseDown={(e) => e.stopPropagation()}>
      <div className="lettore-titolo">
        Inquadra il codice a barre
        <button type="button" aria-label="Chiudi" onClick={onChiudi}><X size={22} /></button>
      </div>
      <div className="lettore-video">
        <video ref={video} muted playsInline autoPlay />
        <div className="mirino" />
      </div>
      {errore && <p className="errore lettore-errore">{errore}</p>}
      <form className="lettore-manuale" onSubmit={(e) => { e.preventDefault(); if (manuale.trim()) { letto.current = true; onLetto(manuale.trim()); } }}>
        <input value={manuale} onChange={(e) => setManuale(e.target.value)} placeholder="…oppure scrivi il codice" inputMode="text" enterKeyHint="done" />
        <button type="submit" className="btn blu">Aggiungi</button>
      </form>
    </div>
  );
}
