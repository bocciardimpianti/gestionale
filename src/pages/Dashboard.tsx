import { useAuth } from "../auth";
import GraficoTecnici from "../components/GraficoTecnici";
import ClientiSquadre from "../components/ClientiSquadre";
import SpeseRicavi from "../components/SpeseRicavi";
import GraficoFornitori from "../components/GraficoFornitori";

// Formato compatto come nell'originale: 17920 -> 17.92K
export function compatto(n: number | null) {
  if (n === null) return "0";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2).replace(/\.00$/, "");
}

export default function Dashboard() {
  const { profilo } = useAuth();
  // Grafici dei tecnici e delle squadre: solo per Michael Gronchi (profilo amministratore con quel nome)
  const nomeOrdinato = String(profilo?.nome ?? "").toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
  const soloMichael = profilo?.ruolo === "admin" && nomeOrdinato === "gronchi michael";
  return (
    <div className="dashboard">
      {profilo?.ruolo === "admin" && <div className="cella cella-larga"><SpeseRicavi /></div>}
      {profilo?.ruolo === "admin" && <div className="cella cella-larga"><GraficoFornitori /></div>}
      {soloMichael && <div className="cella cella-larga"><GraficoTecnici /></div>}
      {soloMichael && <div className="cella cella-larga"><ClientiSquadre /></div>}
    </div>
  );
}
