import { useEffect, useRef, useState } from "react";

// Schermi da telefono: elenchi a righe grandi, schede e ricerche a tutto schermo.
// Anche il telefono girato in orizzontale (schermo basso e tattile) resta in modalità telefono.
export const QUERY = "(max-width: 760px), (max-height: 500px) and (pointer: coarse)";

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
  // Altezza piena dello schermo: serve a capire quando la tastiera è aperta (si azzera ruotando il telefono)
  let massima = 0;
  let larghezza = 0;
  const aggiorna = () => {
    const altezza = vv?.height ?? window.innerHeight;
    if (window.innerWidth !== larghezza) {
      larghezza = window.innerWidth;
      massima = 0;
    }
    massima = Math.max(massima, altezza);
    radice.classList.toggle("tastiera-aperta", altezza < massima * 0.75);
    radice.style.setProperty("--altezza-visibile", `${Math.round(altezza)}px`);
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

// Tasto "indietro" del telefono (o del browser): con una scheda/finestra aperta la chiude invece di cambiare pagina.
// All'apertura si aggiunge un passo nella cronologia; chiudendo con i pulsanti il passo viene tolto.
// Se chiudi() restituisce false la finestra resta aperta (es. c'è da chiedere se salvare) e Indietro continua a funzionare
export function useIndietroChiude(attivo: boolean, chiudi: () => void | boolean) {
  const rif = useRef(chiudi);
  rif.current = chiudi;
  useEffect(() => {
    if (!attivo) return;
    const id = Math.random().toString(36).slice(2);
    // Nella cronologia si tiene la pila delle finestre aperte (una sopra l'altra)
    const aperte = () => ((history.state as { finestre?: string[] } | null)?.finestre ?? []);
    history.pushState({ ...(history.state ?? {}), finestre: [...aperte(), id] }, "");
    let chiusaDaIndietro = false;
    const indietro = () => {
      // Ancora nella pila: è stata tolta una finestra sopra questa
      if (aperte().includes(id) || chiusaDaIndietro) return;
      if (rif.current() === false) {
        history.pushState({ ...(history.state ?? {}), finestre: [...aperte(), id] }, "");
        return;
      }
      chiusaDaIndietro = true;
      window.removeEventListener("popstate", indietro);
    };
    window.addEventListener("popstate", indietro);
    return () => {
      window.removeEventListener("popstate", indietro);
      // Chiusa con un pulsante: si toglie il passo aggiunto, solo se subito dopo è ancora in cima
      // (non dopo un cambio pagina, né se nel frattempo si è aperta un'altra finestra)
      if (!chiusaDaIndietro) setTimeout(() => {
        const pila = aperte();
        if (pila[pila.length - 1] === id) history.back();
      }, 0);
    };
  }, [attivo]);
}
