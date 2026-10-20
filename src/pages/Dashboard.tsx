import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../auth";

// Formato compatto come nell'originale: 17920 -> 17.92K
export function compatto(n: number | null) {
  if (n === null) return "0";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2).replace(/\.00$/, "");
}

const inizioMese = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
};

function Ingranaggio() {
  return <button className="ingranaggio" title="Impostazioni riquadro"><Settings size={18} strokeWidth={1.3} /></button>;
}

function Indicatore({ titolo, valore, colore }: { titolo: string; valore: number | null; colore: string }) {
  return (
    <div className="riquadro-dash indicatore" style={{ background: colore }}>
      <div className="intestazione">
        <div>
          <div className="titolo">{titolo}</div>
          <div className="data">{inizioMese()}</div>
        </div>
        <Ingranaggio />
      </div>
      <div className="valore">{compatto(valore)}</div>
    </div>
  );
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
  // I valori verranno calcolati dai dati importati (DDT di acquisto, scadenziario, rapporti)
  const [valori] = useState<{ spesa: number | null; pagamento: number | null; redditivita: number | null }>({
    spesa: null, pagamento: null, redditivita: null,
  });

  return (
    <div className="dashboard">
      <div className="cella">
        <div className="intestazione-chiara"><span>Tabella</span><Ingranaggio /></div>
        <div className="riquadro-dash bianco" />
      </div>
      <Note />
      <div className="cella"><Indicatore titolo="Spesa mensile" valore={valori.spesa} colore="#00ff00" /></div>

      <div className="cella"><Indicatore titolo="Pagamento mensile" valore={valori.pagamento} colore="#ff0000" /></div>
      <div className="cella"><Indicatore titolo="Redditività mensile" valore={valori.redditivita} colore="#f08080" /></div>
      <div className="cella vuota"><Ingranaggio /></div>

      <div className="cella vuota"><Ingranaggio /></div>
      <div className="cella vuota"><Ingranaggio /></div>
      <div className="cella vuota"><Ingranaggio /></div>
    </div>
  );
}
