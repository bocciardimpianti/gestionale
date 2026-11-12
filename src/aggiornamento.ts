// Nuova versione del gestionale pubblicata mentre la pagina era aperta:
// i "pezzi" caricati a richiesta della versione vecchia non esistono più e il caricamento fallisce.
// In quel caso si ricarica la pagina (al massimo una volta al minuto, per non entrare in un ciclo).

export const eVersioneVecchia = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i
    .test(String((e as Error)?.message ?? e));

export function ricaricaPerAggiornamento() {
  try {
    const ultima = Number(sessionStorage.getItem("gestionale-ricaricato") ?? 0);
    if (Date.now() - ultima < 60_000) return false;
    sessionStorage.setItem("gestionale-ricaricato", String(Date.now()));
  } catch {
    /* archiviazione non disponibile: si ricarica comunque */
  }
  window.location.reload();
  return true;
}

export function controllaAggiornamenti() {
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    ricaricaPerAggiornamento();
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (eVersioneVecchia(e.reason)) ricaricaPerAggiornamento();
  });
  // Il modulo del backup si carica subito (in sottofondo): all'uscita è già pronto anche se nel frattempo
  // è stata pubblicata una nuova versione
  setTimeout(() => { import("./backup").catch(() => {}); }, 5000);
}
