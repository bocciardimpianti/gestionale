import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

// Microfono fisso accanto a una barra di ricerca: quello che si dice viene scritto nella ricerca
// (senza la punteggiatura che la dettatura aggiunge, es. il punto finale).

type Riconoscitore = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void;
};
type Finestra = Window & { SpeechRecognition?: new () => Riconoscitore; webkitSpeechRecognition?: new () => Riconoscitore };

const pulisci = (s: string) => s.replace(/[.,;:!?…]+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();

export default function MicDettatura({ onTesto, className = "" }: { onTesto: (testo: string) => void; className?: string }) {
  const Classe = (window as Finestra).SpeechRecognition ?? (window as Finestra).webkitSpeechRecognition;
  const [ascolto, setAscolto] = useState(false);
  const [errore, setErrore] = useState("");
  const rec = useRef<Riconoscitore | null>(null);

  useEffect(() => () => rec.current?.stop(), []);
  if (!Classe) return null;

  const avvia = () => {
    if (ascolto) return rec.current?.stop();
    setErrore("");
    const r = new Classe();
    r.lang = "it-IT";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      const risultato = e.results[e.results.length - 1];
      onTesto(pulisci(risultato[0].transcript));
    };
    r.onerror = (e) => setErrore(e.error === "not-allowed" || e.error === "service-not-allowed"
      ? "Microfono bloccato: consentilo nelle impostazioni del browser" : e.error === "no-speech" ? "Non ho sentito nulla" : "");
    r.onend = () => setAscolto(false);
    rec.current = r;
    try {
      r.start();
      setAscolto(true);
    } catch {
      setAscolto(false);
    }
  };

  return (
    <button type="button" className={`mic-dettatura${ascolto ? " attivo" : ""} ${className}`}
      aria-label={ascolto ? "Smetti di ascoltare" : "Detta la ricerca"} title={errore || (ascolto ? "Ti ascolto… tocca per fermare" : "Detta la ricerca")}
      onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={avvia}>
      {ascolto ? <MicOff size={20} /> : <Mic size={20} />}
    </button>
  );
}
