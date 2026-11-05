import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { attivaNotifiche, disattivaNotifiche, statoNotifiche, type StatoNotifiche } from "../notifiche";

// Riquadro per attivare su questo dispositivo gli avvisi delle richieste di intervento
export default function BannerNotifiche() {
  const [stato, setStato] = useState<StatoNotifiche | null>(null);
  const [messaggio, setMessaggio] = useState("");
  const [inCorso, setInCorso] = useState(false);

  const aggiorna = () => statoNotifiche().then(setStato).catch(() => setStato("non-supportate"));
  useEffect(() => { aggiorna(); }, []);

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
        <span>Le notifiche sono bloccate per questo sito: consentile dal lucchetto accanto all'indirizzo (Impostazioni sito → Notifiche).</span>
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
