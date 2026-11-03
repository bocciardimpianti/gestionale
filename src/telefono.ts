import { useEffect, useState } from "react";

// Schermi da telefono: elenchi a righe grandi, schede e ricerche a tutto schermo
const QUERY = "(max-width: 760px)";

export function useTelefono() {
  const [telefono, setTelefono] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const aggiorna = () => setTelefono(mq.matches);
    aggiorna();
    mq.addEventListener("change", aggiorna);
    return () => mq.removeEventListener("change", aggiorna);
  }, []);
  return telefono;
}

// La tastiera a video riduce lo spazio visibile: le finestre a tutto schermo seguono queste due misure.
// Il campo su cui si scrive viene portato al centro dello spazio rimasto.
export function seguiTastiera() {
  const radice = document.documentElement;
  const vv = window.visualViewport;
  const aggiorna = () => {
    radice.style.setProperty("--altezza-visibile", `${Math.round(vv?.height ?? window.innerHeight)}px`);
    radice.style.setProperty("--scarto-visibile", `${Math.round(vv?.offsetTop ?? 0)}px`);
  };
  aggiorna();
  vv?.addEventListener("resize", aggiorna);
  vv?.addEventListener("scroll", aggiorna);
  window.addEventListener("resize", aggiorna);
  document.addEventListener("focusin", (e) => {
    const el = e.target as HTMLElement;
    if (!window.matchMedia(QUERY).matches || !el.matches("input, textarea, select")) return;
    if (el.closest(".ricerca-telefono, .finestra-materiali")) return;
    setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
  });
}
