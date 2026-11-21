import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../auth";
import GraficoTecnici from "../components/GraficoTecnici";
import ClientiSquadre from "../components/ClientiSquadre";
import SpeseRicavi from "../components/SpeseRicavi";

// Formato compatto come nell'originale: 17920 -> 17.92K
export function compatto(n: number | null) {
  if (n === null) return "0";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2).replace(/\.00$/, "");
}

function Ingranaggio() {
  return <button className="ingranaggio" title="Impostazioni riquadro"><Settings size={18} strokeWidth={1.3} /></button>;
}

function Note() {
  const { puo } = useAuth();
  const [testo, setTesto] = useState("");
  const [stato, setStato] = useState("");
  const timer = useRef<number>();

  useEffect(() => {
    supabase.from("note_dashboard").select("testo").eq("id", 1).single().then(({ data }) => setTesto(data?.testo ?? ""));
  }, []);

  // Salvataggio automatico un secondo dopo l'ultima modifica
  const cambia = (valore: string) => {
    setTesto(valore);
    setStato("");
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("note_dashboard")
        .update({ testo: valore, modificato_da: user?.id, modificato_il: new Date().toISOString() })
        .eq("id", 1);
      setStato(error ? "Errore nel salvataggio" : "Salvato");
    }, 1000);
  };

  return (
    <div className="cella">
      <div className="intestazione-chiara"><span>Note</span>{stato && <small>{stato}</small>}<Ingranaggio /></div>
      <textarea className="riquadro-dash note" value={testo} onChange={(e) => cambia(e.target.value)} readOnly={!puo("home", "modificare")} />
    </div>
  );
}

export default function Dashboard() {
  const { profilo } = useAuth();
  // Grafici dei tecnici e delle squadre: solo per Michael Gronchi (profilo amministratore con quel nome)
  const nomeOrdinato = String(profilo?.nome ?? "").toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
  const soloMichael = profilo?.ruolo === "admin" && nomeOrdinato === "gronchi michael";
  return (
    <div className="dashboard">
      {profilo?.ruolo === "admin" && <div className="cella cella-larga"><SpeseRicavi /></div>}
      {soloMichael && <div className="cella cella-larga"><GraficoTecnici /></div>}
      {soloMichael && <div className="cella cella-larga"><ClientiSquadre /></div>}
      <div className="cella">
        <div className="intestazione-chiara"><span>Tabella</span><Ingranaggio /></div>
        <div className="riquadro-dash bianco" />
      </div>
      <Note />
    </div>
  );
}
