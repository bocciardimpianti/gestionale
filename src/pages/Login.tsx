import { useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { Logo } from "../Layout";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState("");
  const [attesa, setAttesa] = useState(false);

  const invia = async (e: FormEvent) => {
    e.preventDefault();
    setErrore("");
    setAttesa(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setAttesa(false);
    if (error) setErrore("Email o password non corretti");
  };

  return (
    <div className="schermo-accesso">
      <form className="riquadro" onSubmit={invia}>
        <img src="logo.png" alt="Bocciardi Impianti" className="logo-azienda" />
        <div className="logo-accesso"><Logo /></div>
        <p className="sottotitolo">Bocciardi Impianti · Accesso riservato</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {errore && <p className="errore">{errore}</p>}
        <button className="primario" disabled={attesa}>{attesa ? "Accesso…" : "Accedi"}</button>
      </form>
    </div>
  );
}
