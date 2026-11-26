// Rapportino diviso: ogni materiale (riga) e ogni servizio (diritto di chiamata, tariffa fissa, ore, km) può essere
// "da fatturare" oppure finire nei "Preventivi non approvati" del rapportino.
// Riguarda solo il rapportino: le righe restano nel rapportino (magazzino, giacenze e materiali non cambiano),
// cambia solo cosa entra nell'imponibile da fatturare e cosa va nel totale dei preventivi non approvati.
//  - righe_rapporto.non_approvato (true = preventivo non approvato)
//  - rapporti.servizi_non_approvati: chiavi dei servizi non approvati separate da virgola (es. "ore,km")
//  - rapporti.totale_non_approvato: totale dei preventivi non approvati (per l'elenco dei rapportini)

const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

export const SERVIZI_RAPPORTO = [
  { chiave: "diritto_chiamata", nome: "Diritto di chiamata" },
  { chiave: "tariffa_fissa", nome: "Tariffa fissa" },
  { chiave: "ore", nome: "Manodopera (ore × tariffa oraria)" },
  { chiave: "km", nome: "Trasferta (km × tariffa km)" },
] as const;
export type ChiaveServizio = (typeof SERVIZI_RAPPORTO)[number]["chiave"];

export const serviziNonApprovati = (dati: Record<string, unknown>) =>
  new Set(String(dati.servizi_non_approvati ?? "").split(",").map((s) => s.trim()).filter(Boolean) as ChiaveServizio[]);

/** Importo e descrizione di ogni servizio del rapportino (solo quelli con un importo) */
export function serviziRapporto(dati: Record<string, unknown>) {
  const ore = r2(n(dati.totale_ore) * n(dati.tariffa_oraria));
  const km = r2(n(dati.km_percorsi) * n(dati.tariffa_km));
  const importi: Record<ChiaveServizio, number> = { diritto_chiamata: n(dati.diritto_chiamata), tariffa_fissa: n(dati.tariffa_fissa), ore, km };
  const dettagli: Record<ChiaveServizio, string> = {
    diritto_chiamata: "", tariffa_fissa: "",
    ore: ore ? `${n(dati.totale_ore).toLocaleString("it-IT")} ore × ${n(dati.tariffa_oraria).toLocaleString("it-IT", { minimumFractionDigits: 2 })} €` : "",
    km: km ? `${n(dati.km_percorsi).toLocaleString("it-IT")} km × ${n(dati.tariffa_km).toLocaleString("it-IT", { minimumFractionDigits: 2 })} €` : "",
  };
  const no = serviziNonApprovati(dati);
  return SERVIZI_RAPPORTO.map((s) => ({ ...s, importo: importi[s.chiave], dettaglio: dettagli[s.chiave], nonApprovato: no.has(s.chiave) }))
    .filter((s) => s.importo);
}

/** Totali del rapportino diviso */
export function totaliDivisi(dati: Record<string, unknown>, righe: Record<string, unknown>[]) {
  const servizi = serviziRapporto(dati);
  const materiali = r2(righe.filter((r) => !r.non_approvato).reduce((t, r) => t + n(r.totale), 0));
  const materialiNo = r2(righe.filter((r) => r.non_approvato).reduce((t, r) => t + n(r.totale), 0));
  const serviziSi = r2(servizi.filter((s) => !s.nonApprovato).reduce((t, s) => t + s.importo, 0));
  const serviziNo = r2(servizi.filter((s) => s.nonApprovato).reduce((t, s) => t + s.importo, 0));
  return { materiali, serviziSi, daFatturare: r2(materiali + serviziSi), nonApprovato: r2(materialiNo + serviziNo), diviso: materialiNo + serviziNo > 0 || righe.some((r) => r.non_approvato) };
}
