// Aspetto del gestionale su questo dispositivo: grandezza di testo, righe e colonne (zoom di tutta la pagina).
// Ogni telefono/PC ricorda la sua scelta.

export const PRESET_ASPETTO = [
  { chiave: "compatto", nome: "Compatto", zoom: 0.82, descrizione: "Testo piccolo: il massimo di righe sullo schermo" },
  { chiave: "ridotto", nome: "Ridotto", zoom: 0.9, descrizione: "Un po' più piccolo del normale" },
  { chiave: "normale", nome: "Normale", zoom: 1, descrizione: "Grandezza standard" },
  { chiave: "grande", nome: "Grande", zoom: 1.12, descrizione: "Testo più grande, più facile da leggere" },
] as const;

const CHIAVE = "gestionale-aspetto";

export function aspettoScelto(): string {
  try {
    const v = localStorage.getItem(CHIAVE);
    if (v && PRESET_ASPETTO.some((p) => p.chiave === v)) return v;
  } catch {
    /* archiviazione non disponibile */
  }
  return "normale";
}

export function applicaAspetto(chiave = aspettoScelto()) {
  const p = PRESET_ASPETTO.find((x) => x.chiave === chiave) ?? PRESET_ASPETTO[2];
  const radice = document.documentElement;
  radice.style.setProperty("zoom", p.zoom === 1 ? "" : String(p.zoom));
  radice.style.setProperty("--zoom", String(p.zoom));
  // Le altezze "a tutto schermo" calcolate dal telefono vanno ricalcolate con il nuovo zoom
  window.dispatchEvent(new Event("resize"));
}

export function scegliAspetto(chiave: string) {
  try {
    localStorage.setItem(CHIAVE, chiave);
  } catch {
    /* resta valido solo fino alla chiusura */
  }
  applicaAspetto(chiave);
}

/** Zoom in uso (per convertire le misure dello schermo in quelle della pagina) */
export const zoomPagina = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--zoom")) || 1;
