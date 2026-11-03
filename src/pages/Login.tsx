import { useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { Logo } from "../Layout";

// Distingue le credenziali errate dai problemi del servizio (es. progetto Supabase in pausa)
function messaggioErrore(stato?: number) {
  if (stato === 400) return "Email o password non corretti";
  if (stato === 429) return "Troppi tentativi di accesso: riprova tra qualche minuto";
  return "Servizio di accesso non raggiungibile: controlla la connessione e che il progetto Supabase sia attivo";
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState("");
  const [attesa, setAttesa] = useState(false);
  const [recupero, setRecupero] = useState(false);
  const [avviso, setAvviso] = useState("");

  const invia = async (e: FormEvent) => {
    e.preventDefault();
    setErrore("");
    setAttesa(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setAttesa(false);
    if (error) setErrore(messaggioErrore(error.status));
  };

  const recupera = async (e: FormEvent) => {
    e.preventDefault();
    setErrore("");
    setAvviso("");
    setAttesa(true);
    const { error } = await supabase.functions.invoke("recupera-password", { body: { email } });
    setAttesa(false);
    if (error) setErrore("Richiesta non riuscita: riprova più tardi o contatta l'amministratore");
    else setAvviso("Se l'email è registrata, l'amministratore riceverà una password provvisoria e te la comunicherà.");
  };

  const cambiaModo = (attivo: boolean) => {
    setRecupero(attivo);
    setErrore("");
    setAvviso("");
  };

  return (
    <div className="schermo-accesso">
      <form className="riquadro" onSubmit={recupero ? recupera : invia}>
        <img src="logo.png" alt="Bocciardi Impianti" className="logo-azienda" />
        <div className="logo-accesso"><Logo /></div>
        <p className="sottotitolo">Bocciardi Impianti · Accesso riservato</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
        </label>
        {!recupero && (
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
        )}
        {errore && <p className="errore">{errore}</p>}
        {avviso && <p>{avviso}</p>}
        <button className="primario" disabled={attesa}>
          {recupero ? (attesa ? "Invio…" : "Richiedi nuova password") : (attesa ? "Accesso…" : "Accedi")}
        </button>
        <button type="button" className="collegamento" onClick={() => cambiaModo(!recupero)}>
          {recupero ? "Torna all'accesso" : "Password dimenticata?"}
        </button>
      </form>
    </div>
  );
}
