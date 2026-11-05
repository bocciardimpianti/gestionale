// Testo cercato pulito dalla punteggiatura che la dettatura del telefono aggiunge alla fine delle parole
// ("cavo fs 17." → "cavo fs 17"); i segni dentro le parole restano (2,5 mm, 1/2", 0130.100006).
export const pulisciRicerca = (s: string) => s.replace(/[.,;:!?…]+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
