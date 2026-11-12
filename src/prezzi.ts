// Totali e importi: chi non ha il permesso "Totali" (in Utenti, permessi e tecnici) non li vede da nessuna parte.
// I prezzi dei singoli materiali (prezzo, ricarico, costo, totale della riga) restano visibili a tutti;
// sono nascosti totali dei documenti, imponibili, IVA, sconti in euro, importi e i conteggi di ore e km in euro.
const TOTALE = /^_?(totale(?!_ore)|imponibil|import|iva_totale|sconto_totale|prezzo_scontato|prezzo_ore|prezzo_km|pagamento_contanti|azzera_imponibile|considera_totale)/;

export const èTotale = (chiave: string) => TOTALE.test(chiave);

/** Toglie da un elenco (colonne, campi) i totali, se l'utente non può vederli */
export const senzaPrezzi = <T extends { chiave: string }>(elenco: T[], vedePrezzi: boolean): T[] =>
  vedePrezzi ? elenco : elenco.filter((c) => !èTotale(c.chiave));
