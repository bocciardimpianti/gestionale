// Stato dei backup su questo PC (modulo leggero: le librerie del backup si caricano solo quando serve)
// Date degli ultimi backup riusciti su questo PC (il completo va fatto almeno una volta a settimana)
const CHIAVE_ULTIMO = "backup-ultimo";
const CHIAVE_ULTIMO_COMPLETO = "backup-ultimo-completo";
const leggi = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };
export const GIORNI_COMPLETO = 7;
export function situazioneBackup() {
  const ultimo = leggi(CHIAVE_ULTIMO);
  const completo = leggi(CHIAVE_ULTIMO_COMPLETO);
  const giorni = completo ? (Date.now() - Date.parse(completo)) / 86_400_000 : Infinity;
  return { ultimo, completo, serveCompleto: !completo || !ultimo || giorni >= GIORNI_COMPLETO };
}
export function segnaBackup(inizio: string, incrementale: boolean) {
  try {
    localStorage.setItem(CHIAVE_ULTIMO, inizio);
    if (!incrementale) localStorage.setItem(CHIAVE_ULTIMO_COMPLETO, inizio);
  } catch { /* non disponibile */ }
}

// Crea il backup completo: un file Excel con un foglio per tabella, i dati in formato JSON e tutte le foto/firme
