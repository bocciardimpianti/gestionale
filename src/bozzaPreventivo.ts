import type { Alternativa } from "./impaginaGuidato";

// Preventivo guidato "aperto": quello che si sta facendo resta salvato su questo dispositivo anche andando
// in un'altra sezione (o chiudendo la pagina); si riprende da dove si era rimasti finché non si esce con "Esci".
export type BozzaPreventivo = {
  id: number | null; soluzioni: Alternativa[]; attiva: number; oggetto: string; cliente: string; data: string;
  sconto: string; iva: string; modificato: boolean; salvata_il: string;
};
const CHIAVE = "bozza-preventivo-guidato";
export const EVENTO_BOZZA = "bozza-preventivo";

export function leggiBozza(): BozzaPreventivo | null {
  try { const v = localStorage.getItem(CHIAVE); return v ? JSON.parse(v) as BozzaPreventivo : null; } catch { return null; }
}
export function salvaBozza(b: Omit<BozzaPreventivo, "salvata_il">) {
  try { localStorage.setItem(CHIAVE, JSON.stringify({ ...b, salvata_il: new Date().toISOString() })); } catch { /* spazio pieno o privato */ }
}
export function cancellaBozza() {
  try { localStorage.removeItem(CHIAVE); } catch { /* niente */ }
  window.dispatchEvent(new Event(EVENTO_BOZZA));
}
