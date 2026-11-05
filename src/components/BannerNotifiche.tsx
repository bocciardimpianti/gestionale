import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { attivaNotifiche, disattivaNotifiche, statoNotifiche, type StatoNotifiche } from "../notifiche";

const android = /android/i.test(navigator.userAgent);
const iphone = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const app = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

// Come sbloccare le notifiche, a seconda di dove si usa il gestionale
function istruzioniSblocco() {
  if (android && app) return (
    <>Le notifiche sono bloccate sul telefono. Apri <b>Impostazioni</b> del telefono → <b>App</b> → <b>Gestionale</b> (oppure tieni premuta l'icona del gestionale → <b>Info app</b>) → <b>Notifiche</b> → attivale. Poi torna qui.</>
  );
  if (android) return (
    <>Le notifiche sono bloccate per questo sito. In Chrome tocca <b>⋮</b> → <b>Impostazioni</b> → <b>Impostazioni sito</b> → <b>Notifiche</b> → scegli <b>bocciardimpianti.github.io</b> → <b>Consenti</b>. Poi torna qui.</>
  );
  if (iphone) return (
    <>Le notifiche sono bloccate. Apri <b>Impostazioni</b> dell'iPhone → <b>Notifiche</b> → <b>Gestionale</b> → <b>Consenti notifiche</b>. Poi torna qui.</>
  );
  return <>Le notifiche sono bloccate per questo sito: clicca sul lucchetto accanto all'indirizzo → <b>Notifiche</b> → <b>Consenti</b>, poi ricarica la pagina.</>;
}

// Riquadro per attivare su questo dispositivo gli avvisi delle richieste di intervento
export default function BannerNotifiche() {
  const [stato, setStato] = useState<StatoNotifiche | null>(null);
  const [messaggio, setMessaggio] = useState("");
  const [inCorso, setInCorso] = useState(false);

  const aggiorna = () => statoNotifiche().then(setStato).catch(() => setStato("non-supportate"));
  // Tornando dalle impostazioni del telefono lo stato viene ricontrollato da solo
  useEffect(() => {
    aggiorna();
    const torna = () => { if (document.visibilityState === "visible") aggiorna(); };
    document.addEventListener("visibilitychange", torna);
    return () => document.removeEventListener("visibilitychange", torna);
  }, []);

  if (!stato || stato === "non-supportate") return null;

  const attiva = async () => {
    setInCorso(true);
    setMessaggio("");
    try {
      await attivaNotifiche();
      setMessaggio("Notifiche attivate: ti è arrivata una notifica di prova.");
    } catch (e) {
      setMessaggio((e as Error).message);
    }
    setInCorso(false);
    aggiorna();
  };

  if (stato === "attive")
    return (
      <div className="banner-notifiche attive">
        <Bell size={18} /> <span>Su questo dispositivo ricevi gli avvisi delle nuove richieste.</span>
        <button type="button" className="link" onClick={async () => { await disattivaNotifiche(); setMessaggio("Notifiche disattivate su questo dispositivo."); aggiorna(); }}>Disattiva</button>
        {messaggio && <span className="piccolo">{messaggio}</span>}
      </div>
    );

  return (
    <div className="banner-notifiche">
      <BellOff size={18} />
      {stato === "iphone-da-installare" ? (
        <span>Per ricevere gli avvisi su iPhone aggiungi il gestionale alla schermata Home (tasto <b>Condividi</b> → <b>Aggiungi a Home</b>), aprilo da lì e torna qui.</span>
      ) : stato === "bloccate" ? (
        <span className="istruzioni-notifiche">{istruzioniSblocco()}</span>
      ) : (
        <>
          <span>Vuoi essere avvisato sul telefono quando arriva una richiesta?</span>
          <button type="button" className="btn blu" disabled={inCorso} onClick={attiva}>{inCorso ? "Attivazione…" : "Attiva notifiche"}</button>
        </>
      )}
      {messaggio && <span className="piccolo">{messaggio}</span>}
    </div>
  );
}
