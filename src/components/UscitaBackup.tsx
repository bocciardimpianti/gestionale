import { useState } from "react";
import { GIORNI_COMPLETO, segnaBackup, situazioneBackup } from "../backupStato";

// Finestra mostrata all'uscita (admin, da PC): salva il backup completo prima di uscire.
// Con "soloBackup" serve anche per fare un backup in qualsiasi momento, senza uscire.
export default function UscitaBackup({ soloBackup, onEsci, onAnnulla }: {
  soloBackup?: boolean;
  onEsci: () => void;
  onAnnulla: () => void;
}) {
  const [stato, setStato] = useState("");
  const [inCorso, setInCorso] = useState(false);
  // Backup salvato: restano solo i pulsanti per chiudere la finestra (o uscire)
  const [fatto, setFatto] = useState(false);
  // Incrementale (solo le modifiche dall'ultimo backup) oppure completo, dovuto almeno una volta a settimana
  const situazione = situazioneBackup();
  const [completo, setCompleto] = useState(situazione.serveCompleto);
  // Le foto dei materiali sono molte e cambiano poco: si possono escludere (scelta ricordata su questo PC)
  const [fotoMateriali, setFotoMateriali] = useState(() => {
    try {
      return localStorage.getItem("backup-foto-materiali") !== "no";
    } catch {
      return true;
    }
  });
  const cambiaFotoMateriali = (v: boolean) => {
    setFotoMateriali(v);
    try {
      localStorage.setItem("backup-foto-materiali", v ? "si" : "no");
    } catch {
      /* archiviazione locale non disponibile */
    }
  };

  const salva = async () => {
    setStato("");
    try {
      // Modulo caricato solo quando serve (contiene le librerie zip ed Excel)
      const { creaBackup, nomeBackup, scegliDestinazione } = await import("../backup");
      const incrementale = !completo && !!situazione.ultimo;
      const nome = nomeBackup(incrementale);
      const inizio = new Date().toISOString();
      const destinazione = await scegliDestinazione(nome);
      if (!destinazione) return; // salvataggio annullato
      setInCorso(true);
      const zip = await creaBackup(setStato, { fotoMateriali, dal: incrementale ? situazione.ultimo : undefined });
      setStato("Salvataggio del file…");
      await destinazione.scrivi(zip);
      segnaBackup(inizio, incrementale);
      setStato(`Backup salvato: ${nome}`);
      setInCorso(false);
      setFatto(true);
      // All'uscita si esce da soli dopo un attimo; il pulsante "Esci" resta comunque disponibile
      if (!soloBackup) setTimeout(onEsci, 1500);
    } catch (e) {
      setInCorso(false);
      setStato("Errore durante il backup: " + (e as Error).message);
    }
  };

  return (
    <div className="velo" onMouseDown={() => !inCorso && onAnnulla()}>
      <div className="finestra finestra-backup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">{soloBackup ? "Backup completo" : "Uscita"}</div>
        <div className="finestra-corpo">
          <p style={{ marginTop: 0 }}>
            {soloBackup ? "Salva sul computer" : "Prima di uscire vuoi salvare sul computer"} un backup completo del gestionale?
          </p>
          <p className="piccolo">
            Contiene tutti i dati in Excel (un foglio per sezione), una copia completa per il ripristino e le foto e firme dei rapporti.
            Ti verrà chiesto dove salvarlo: è proposta la cartella Documenti.
          </p>
          <div className="tipo-backup">
            {situazione.serveCompleto ? (
              <p><b>Backup completo</b>: {situazione.completo
                ? `l'ultimo completo su questo PC è del ${new Date(situazione.completo).toLocaleDateString("it-IT")}, va rifatto almeno ogni ${GIORNI_COMPLETO} giorni.`
                : "su questo PC non ne è ancora stato fatto uno."}</p>
            ) : (
              <>
                <p><b>{completo ? "Backup completo" : "Backup incrementale"}</b>: {completo
                  ? "tutti i dati, le foto e i PDF."
                  : `solo quello che è stato creato o modificato dal ${new Date(situazione.ultimo).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })} (ultimo backup su questo PC). Più piccolo e veloce.`}</p>
                <label className="interruttore opzione-backup">
                  <input type="checkbox" checked={completo} disabled={inCorso || fatto} onChange={(e) => setCompleto(e.target.checked)} />
                  Fai comunque un backup completo <span className="piccolo">(ultimo completo: {new Date(situazione.completo).toLocaleDateString("it-IT")})</span>
                </label>
              </>
            )}
          </div>
          <label className="interruttore opzione-backup">
            <input type="checkbox" checked={fotoMateriali} disabled={inCorso} onChange={(e) => cambiaFotoMateriali(e.target.checked)} />
            Includi le foto dei materiali <span className="piccolo">(backup più grande e più lento)</span>
          </label>
          {stato && <p className={stato.startsWith("Errore") ? "errore" : "ok"}>{stato}</p>}
        </div>
        {fatto ? (
          <div className="finestra-piede">
            <span style={{ flex: 1 }} />
            {soloBackup
              ? <button type="button" className="btn blu" autoFocus onClick={onAnnulla}>Chiudi</button>
              : <button type="button" className="btn blu" autoFocus onClick={onEsci}>Esci</button>}
          </div>
        ) : (
        <div className="finestra-piede">
          <button type="button" className="btn grigio" disabled={inCorso} onClick={onAnnulla}>Annulla</button>
          <span style={{ flex: 1 }} />
          {!soloBackup && <button type="button" className="btn grigio" disabled={inCorso} onClick={onEsci}>Esci senza backup</button>}
          <button type="button" className="btn blu" disabled={inCorso} onClick={salva}>
            {inCorso ? "Backup in corso…" : soloBackup ? "Salva backup" : "Salva backup ed esci"}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
