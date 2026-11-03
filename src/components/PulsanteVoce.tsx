import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { esegui, interpreta } from "../voce";

// Riconoscimento vocale del browser: non è ancora negli schemi di TypeScript
type Riconoscitore = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void;
};
type Finestra = Window & { SpeechRecognition?: new () => Riconoscitore; webkitSpeechRecognition?: new () => Riconoscitore };

const ERRORI: Record<string, string> = {
  "not-allowed": "Microfono bloccato: consentilo dal lucchetto accanto all'indirizzo.",
  "service-not-allowed": "Microfono bloccato: consentilo dal lucchetto accanto all'indirizzo.",
  "no-speech": "Non ho sentito nulla.",
  "audio-capture": "Nessun microfono trovato.",
  network: "Serve la connessione a Internet per i comandi vocali.",
};

export default function PulsanteVoce() {
  const Classe = (window as Finestra).SpeechRecognition ?? (window as Finestra).webkitSpeechRecognition;
  const [ascolto, setAscolto] = useState(false);
  const [messaggio, setMessaggio] = useState("");
  const rec = useRef<Riconoscitore | null>(null);
  const timer = useRef(0);

  const mostra = (m: string, durata = 5000) => {
    setMessaggio(m);
    clearTimeout(timer.current);
    if (durata) timer.current = window.setTimeout(() => setMessaggio(""), durata);
  };

  useEffect(() => () => { rec.current?.stop(); clearTimeout(timer.current); }, []);

  if (!Classe) return null;

  const avvia = () => {
    if (ascolto) return rec.current?.stop();
    const r = new Classe();
    r.lang = "it-IT";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      const risultato = e.results[e.results.length - 1];
      const testo = risultato[0].transcript;
      if (!risultato.isFinal) return mostra(testo, 0);
      esegui(interpreta(testo))
        .then((esito) => mostra(`"${testo}": ${esito}`, 7000))
        .catch((err) => mostra("Errore: " + (err as Error).message, 7000));
    };
    r.onerror = (e) => mostra(ERRORI[e.error] ?? "Riconoscimento vocale non riuscito: riprova.", 6000);
    r.onend = () => setAscolto(false);
    rec.current = r;
    try {
      r.start();
      setAscolto(true);
      mostra("Ti ascolto…", 0);
    } catch {
      mostra("Riconoscimento vocale non disponibile: riprova.", 5000);
    }
  };

  return (
    <div className="comando-voce">
      {messaggio && <div className="voce-messaggio" role="status">{messaggio}</div>}
      <button type="button" className={`voce-pulsante${ascolto ? " attivo" : ""}`} aria-label={ascolto ? "Smetti di ascoltare" : "Comando vocale"} title="Comando vocale"
        onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={avvia}>
        {ascolto ? <MicOff size={24} /> : <Mic size={24} />}
      </button>
    </div>
  );
}
