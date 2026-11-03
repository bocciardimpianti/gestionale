import { useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../auth";

// Obbligatoria dopo l'accesso con una password provvisoria
export default function CambioPassword() {
  const { aggiorna, esci } = useAuth();
  const [password, setPassword] = useState("");
  const [conferma, setConferma] = useState("");
  const [errore, setErrore] = useState("");
  const [attesa, setAttesa] = useState(false);

  const invia = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== conferma) return setErrore("Le due password non coincidono");
    setErrore("");
    setAttesa(true);
    const { error } = await supabase.auth.updateUser({ password, data: { password_provvisoria: false } });
    setAttesa(false);
    if (error) {
      setErrore(error.code === "same_password"
        ? "La nuova password deve essere diversa da quella provvisoria"
        : "Password non accettata: scegline una diversa e riprova");
      return;
    }
    await aggiorna();
  };

  return (
    <div className="schermo-accesso">
      <form className="riquadro" onSubmit={invia}>
        <h3>Scegli una nuova password</h3>
        <p className="sottotitolo">Stai usando una password provvisoria: sostituiscila per continuare.</p>
        <label>
          Nuova password (minimo 10 caratteri)
          <input type="password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required autoFocus />
        </label>
        <label>
          Ripeti la nuova password
          <input type="password" minLength={10} value={conferma} onChange={(e) => setConferma(e.target.value)} autoComplete="new-password" required />
        </label>
        {errore && <p className="errore">{errore}</p>}
        <button className="primario" disabled={attesa}>{attesa ? "Salvataggio…" : "Salva password"}</button>
        <button type="button" className="collegamento" onClick={esci}>Esci</button>
      </form>
    </div>
  );
}
