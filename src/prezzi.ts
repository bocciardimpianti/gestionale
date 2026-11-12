// Prezzi e importi: chi non ha il permesso "Prezzi" (in Utenti, permessi e tecnici) non li vede da nessuna parte.
// Sono nascosti i campi e le colonne il cui nome indica un prezzo, un costo, un ricarico, uno sconto, una tariffa o un totale in euro
// (non "Totale ore").
const PREZZO = /^_?(prezz|ricaric|cost|scont|imponibil|import|totale(?!_ore)|tariff|iva|diritto_chiamata|pagamento_contanti|azzera_imponibile|considera_totale)/;

export const èPrezzo = (chiave: string) => PREZZO.test(chiave);

/** Toglie da un elenco (colonne, campi) quelli con prezzi, se l'utente non può vederli */
export const senzaPrezzi = <T extends { chiave: string }>(elenco: T[], vedePrezzi: boolean): T[] =>
  vedePrezzi ? elenco : elenco.filter((c) => !èPrezzo(c.chiave));
