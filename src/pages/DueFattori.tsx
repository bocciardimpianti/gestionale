import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../auth";

// Attivazione (primo accesso) o verifica del codice 2FA da app Authenticator
export default function DueFattori({ attivazione }: { attivazione: boolean }) {
  const { aggiorna, esci } = useAuth();
  const [fattoreId, setFattoreId] = useState("");
  const [qr, setQr] = useState("");
  const [segreto, setSegreto] = useState("");
  const [codice, setCodice] = useState("");
  const [errore, setErrore] = useState("");
  const [attesa, setAttesa] = useState(false);

  useEffect(() => {
    (async () => {
      if (attivazione) {
        // Rimuove eventuali attivazioni lasciate a metà, poi ne crea una nuova
        const { data: elenco } = await supabase.auth.mfa.listFactors();
        for (const f of elenco?.all ?? []) {
          if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator" });
        if (error) return setErrore(error.message);
        if (data.type !== "totp") return;
        setFattoreId(data.id);
        setQr(data.totp.qr_code);
        setSegreto(data.totp.secret);
      } else {
        const { data } = await supabase.auth.mfa.listFactors();
        setFattoreId(data?.totp[0]?.id ?? "");
      }
    })();
  }, [attivazione]);

  const verifica = async (e: FormEvent) => {
    e.preventDefault();
    setErrore("");
    setAttesa(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fattoreId, code: codice.trim() });
    setAttesa(false);
    if (error) {
      setErrore("Codice non valido, riprova");
      setCodice("");
      return;
    }
    await aggiorna();
  };

  return (
    <div className="schermo-accesso">
      <form className="riquadro" onSubmit={verifica}>
        <h1>Verifica in due passaggi</h1>
        {attivazione ? (
          <>
            <p>
              Al primo accesso devi attivare la verifica in due passaggi. Inquadra il codice con un'app
              Authenticator (Google Authenticator, Microsoft Authenticator, Authy…).
            </p>
            {qr && <img className="qr" src={qr} alt="Codice QR per l'app Authenticator" />}
            {segreto && (
              <p className="piccolo">
                Oppure inserisci a mano la chiave: <code>{segreto}</code>
              </p>
            )}
          </>
        ) : (
          <p>Inserisci il codice a 6 cifre mostrato dalla tua app Authenticator.</p>
        )}
        <label>
          Codice
          <input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={codice}
            onChange={(e) => setCodice(e.target.value.replace(/\D/g, ""))}
            autoComplete="one-time-code"
            required
            autoFocus
          />
        </label>
        {errore && <p className="errore">{errore}</p>}
        <button className="primario" disabled={attesa || !fattoreId}>{attesa ? "Verifica…" : "Conferma"}</button>
        <button type="button" className="collegamento" onClick={esci}>Esci</button>
      </form>
    </div>
  );
}
