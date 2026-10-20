import { useState } from "react";

// Finestra mostrata all'uscita (admin, da PC): salva il backup completo prima di uscire.
// Con "soloBackup" serve anche per fare un backup in qualsiasi momento, senza uscire.
export default function UscitaBackup({ soloBackup, onEsci, onAnnulla }: {
  soloBackup?: boolean;
  onEsci: () => void;
  onAnnulla: () => void;
}) {
  const [stato, setStato] = useState("");
  const [inCorso, setInCorso] = useState(false);
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
    // Modulo caricato solo quando serve (contiene le librerie zip ed Excel)
    const { creaBackup, nomeBackup, scegliDestinazione } = await import("../backup");
    const nome = nomeBackup();
    const destinazione = await scegliDestinazione(nome);
    if (!destinazione) return; // salvataggio annullato
    setInCorso(true);
    try {
      const zip = await creaBackup(setStato, { fotoMateriali });
      setStato("Salvataggio del file…");
      await destinazione.scrivi(zip);
      setStato(`Backup salvato: ${nome}`);
      if (soloBackup) setInCorso(false);
      else setTimeout(onEsci, 800);
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
          <label className="interruttore opzione-backup">
            <input type="checkbox" checked={fotoMateriali} disabled={inCorso} onChange={(e) => cambiaFotoMateriali(e.target.checked)} />
            Includi le foto dei materiali <span className="piccolo">(backup più grande e più lento)</span>
          </label>
          {stato && <p className={stato.startsWith("Errore") ? "errore" : "ok"}>{stato}</p>}
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" disabled={inCorso} onClick={onAnnulla}>Annulla</button>
          <span style={{ flex: 1 }} />
          {!soloBackup && <button type="button" className="btn grigio" disabled={inCorso} onClick={onEsci}>Esci senza backup</button>}
          <button type="button" className="btn blu" disabled={inCorso} onClick={salva}>
            {inCorso ? "Backup in corso…" : soloBackup ? "Salva backup" : "Salva backup ed esci"}
          </button>
        </div>
      </div>
    </div>
  );
}
