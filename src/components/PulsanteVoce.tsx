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

// Posizione scelta trascinando il pulsante (in frazioni dello schermo, così regge la rotazione), ricordata su questo dispositivo
type Posizione = { x: number; y: number };
const CHIAVE = "gestionale-posizione-microfono";
const LATO = 50;
const leggiPosizione = (): Posizione | null => {
  try {
    const p = JSON.parse(localStorage.getItem(CHIAVE) ?? "null");
    return p && typeof p.x === "number" && typeof p.y === "number" ? p : null;
  } catch { return null; }
};
const salvaPosizione = (p: Posizione | null) => {
  try { if (p) localStorage.setItem(CHIAVE, JSON.stringify(p)); else localStorage.removeItem(CHIAVE); } catch { /* non disponibile */ }
};
// Angolo in alto a sinistra del pulsante, sempre tutto dentro lo schermo
const inPixel = (p: Posizione) => ({
  left: Math.round(Math.min(Math.max(4, p.x * window.innerWidth - LATO / 2), window.innerWidth - LATO - 4)),
  top: Math.round(Math.min(Math.max(4, p.y * window.innerHeight - LATO / 2), window.innerHeight - LATO - 4)),
});

export default function PulsanteVoce() {
  const Classe = (window as Finestra).SpeechRecognition ?? (window as Finestra).webkitSpeechRecognition;
  const [ascolto, setAscolto] = useState(false);
  const [messaggio, setMessaggio] = useState("");
  const rec = useRef<Riconoscitore | null>(null);
  const timer = useRef(0);
  const [posizione, setPosizione] = useState<Posizione | null>(leggiPosizione);
  const [, setDimensioni] = useState(0);
  const trascina = useRef<{ x: number; y: number; mosso: boolean; premuto: number } | null>(null);

  useEffect(() => {
    const aggiorna = () => setDimensioni((n) => n + 1);
    window.addEventListener("resize", aggiorna);
    return () => window.removeEventListener("resize", aggiorna);
  }, []);

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

  // Tocco: ascolta. Trascinamento: sposta. Tenuto fermo a lungo: propone di tornare alla posizione iniziale.
  const giu = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const premuto = window.setTimeout(() => {
      if (!trascina.current || trascina.current.mosso) return;
      trascina.current = null;
      if (posizione && confirm("Riportare il microfono nella posizione iniziale?")) { setPosizione(null); salvaPosizione(null); }
    }, 900);
    trascina.current = { x: e.clientX, y: e.clientY, mosso: false, premuto };
  };
  const muovi = (e: React.PointerEvent<HTMLButtonElement>) => {
    const t = trascina.current;
    if (!t) return;
    if (!t.mosso && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 8) return;
    t.mosso = true;
    clearTimeout(t.premuto);
    setPosizione({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
  };
  const su = () => {
    const t = trascina.current;
    trascina.current = null;
    if (!t) return;
    clearTimeout(t.premuto);
    if (t.mosso) salvaPosizione(posizione);
    else avvia();
  };

  const px = posizione ? inPixel(posizione) : null;
  const inBasso = posizione ? posizione.y > 0.5 : true;
  const aDestra = posizione ? posizione.x > 0.5 : true;
  return (
    <div className={`comando-voce${px ? " spostato" : ""}${px && !inBasso ? " messaggio-sotto" : ""}${px && aDestra ? " messaggio-a-destra" : ""}`}
      style={px ? { left: px.left, top: px.top, right: "auto", bottom: "auto", transform: "none" } : undefined}>
      {messaggio && <div className="voce-messaggio" role="status">{messaggio}</div>}
      <button type="button" className={`voce-pulsante${ascolto ? " attivo" : ""}`} aria-label={ascolto ? "Smetti di ascoltare" : "Comando vocale"}
        title="Comando vocale (trascinalo per spostarlo)"
        onPointerDown={giu} onPointerMove={muovi} onPointerUp={su} onPointerCancel={() => { if (trascina.current) clearTimeout(trascina.current.premuto); trascina.current = null; }}
        onMouseDown={(e) => e.preventDefault()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); avvia(); } }}>
        {ascolto ? <MicOff size={24} /> : <Mic size={24} />}
      </button>
    </div>
  );
}
