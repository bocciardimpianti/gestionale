import type { Colonna } from "./components/Griglia";

export interface Campo {
  chiave: string;
  etichetta: string;
  tipo?: "testo" | "area" | "scelta" | "telefono" | "titolo";
  // Colonne occupate su 4 (come nella scheda originale); 0.5 = mezza colonna
  larghezza?: 0.5 | 1 | 2 | 4;
  // Per i titoli di sezione: fascia grigia (default) o blu
  stile?: "grigio" | "blu";
  // Lascia vuoto il resto della riga dopo questo campo
  finisciRiga?: boolean;
  // Per i campi a scelta: tabella da cui leggere le opzioni (colonna "nome")
  opzioniDa?: string;
  // In alternativa: funzione del database che restituisce { id, nome } (es. elenco utenti)
  opzioniRpc?: string;
  // Titolo della finestra di gestione delle opzioni (solo admin)
  titoloOpzioni?: string;
  obbligatorio?: boolean;
}

export interface Archivio {
  sezione: string;
  titolo: string;
  // Titolo della scheda per un nuovo record (es. "Nuovo cliente")
  titoloNuovo: string;
  // Linguette aggiuntive della scheda, dopo "Principale"
  linguette?: string[];
  tabella: string;
  colonne: (Colonna & { excel: string })[];
  campi: Campo[];
  // Campo usato per riconoscere i doppioni in importazione
  chiaveImport: string;
}

// Configurazione delle sezioni a griglia, colonne nello stesso ordine e con gli stessi titoli dell'originale
export const ARCHIVI: Record<string, Archivio> = {
  clienti: {
    sezione: "clienti",
    titolo: "Clienti",
    titoloNuovo: "Nuovo cliente",
    linguette: ["Impianti", "Storico", "Log Cloud"],
    tabella: "clienti",
    chiaveImport: "nome",
    colonne: [
      { chiave: "nome", titolo: "Nome Cliente", excel: "Nome Cliente", larghezza: 345 },
      { chiave: "codice_fiscale", titolo: "CODICE FISCALE", excel: "CODICE FISCALE", larghezza: 121 },
      { chiave: "email", titolo: "E-Mail", excel: "E-Mail", larghezza: 130 },
      { chiave: "indirizzo_fatturazione", titolo: "Indirizzo Fatturazione", excel: "Indirizzo Fatturazione", larghezza: 248 },
      { chiave: "nome_contatto", titolo: "Nome contatto", excel: "Nome contatto", larghezza: 95 },
      { chiave: "telefono", titolo: "Telefono", excel: "Telefono", larghezza: 79 },
      { chiave: "cellulare", titolo: "Cellulare", excel: "Cellulare", larghezza: 117 },
      { chiave: "piva", titolo: "P.IVA", excel: "P.IVA", larghezza: 91 },
      { chiave: "note", titolo: "Note", excel: "Note", larghezza: 200 },
      { chiave: "tipologia_pagamento", titolo: "Tipologia Pagamento", excel: "Tipologia Pagamento", larghezza: 178 },
    ],
    campi: [
      { chiave: "nome", etichetta: "Nome Cliente", obbligatorio: true, larghezza: 2 },
      { chiave: "email", etichetta: "E-Mail", larghezza: 2 },
      { chiave: "indirizzo_fatturazione", etichetta: "Indirizzo Fatturazione", larghezza: 2, finisciRiga: true },
      { chiave: "_dati_contatto", etichetta: "Dati contatto", tipo: "titolo" },
      { chiave: "nome_contatto", etichetta: "Nome contatto", larghezza: 2 },
      { chiave: "telefono", etichetta: "Telefono", tipo: "telefono", larghezza: 1 },
      { chiave: "cellulare", etichetta: "Cellulare", tipo: "telefono", larghezza: 1 },
      { chiave: "piva", etichetta: "P.IVA", larghezza: 2, finisciRiga: true },
      { chiave: "note", etichetta: "Note", tipo: "area", larghezza: 4 },
      { chiave: "codice_fiscale", etichetta: "CODICE FISCALE", larghezza: 2 },
      { chiave: "tipologia_pagamento", etichetta: "Tipologia Pagamento", tipo: "scelta", opzioniDa: "tipologie_pagamento", titoloOpzioni: "Tipologie Pagamento", larghezza: 2 },
    ],
  },
  fornitori: {
    sezione: "fornitori",
    titolo: "Fornitori",
    titoloNuovo: "Nuovo Fornitore",
    linguette: ["Storico", "Log Cloud"],
    tabella: "fornitori",
    chiaveImport: "nome",
    colonne: [
      { chiave: "nome", titolo: "Nome Fornitore", excel: "Nome Fornitore", larghezza: 151 },
      { chiave: "cap", titolo: "Cap", excel: "Cap", larghezza: 52 },
      { chiave: "comune", titolo: "Comune", excel: "Comune", larghezza: 148 },
      { chiave: "provincia", titolo: "Provincia", excel: "Provincia", larghezza: 51 },
      { chiave: "telefono", titolo: "Telefono", excel: "Telefono", larghezza: 156 },
      { chiave: "fax", titolo: "Fax 1", excel: "Fax 1", larghezza: 156 },
      { chiave: "email", titolo: "E-Mail", excel: "E-Mail", larghezza: 211 },
      { chiave: "indirizzo", titolo: "Indirizzo", excel: "Indirizzo", larghezza: 135 },
      { chiave: "civico", titolo: "Civico", excel: "Civico", larghezza: 83 },
      { chiave: "cellulare", titolo: "Cellulare", excel: "Cellulare", larghezza: 183 },
      { chiave: "piva", titolo: "P.IVA", excel: "P.IVA", larghezza: 278 },
    ],
    campi: [
      { chiave: "_anagrafica", etichetta: "ANAGRAFICA", tipo: "titolo", stile: "blu" },
      { chiave: "nome", etichetta: "Nome Fornitore", obbligatorio: true, larghezza: 2 },
      { chiave: "codice_fiscale", etichetta: "Codice fiscale", larghezza: 1 },
      { chiave: "piva", etichetta: "P.IVA", larghezza: 1 },
      { chiave: "indirizzo", etichetta: "Indirizzo", larghezza: 2 },
      { chiave: "civico", etichetta: "Civico", larghezza: 0.5 },
      { chiave: "cap", etichetta: "Cap", larghezza: 1, finisciRiga: true },
      { chiave: "comune", etichetta: "Comune", larghezza: 1 },
      { chiave: "provincia", etichetta: "Provincia", tipo: "scelta", opzioniDa: "province", titoloOpzioni: "Province", larghezza: 1 },
      { chiave: "nazione", etichetta: "Nazione", tipo: "scelta", opzioniDa: "nazioni", titoloOpzioni: "Nazioni", larghezza: 1 },
      { chiave: "cellulare", etichetta: "Cellulare", tipo: "telefono", larghezza: 1 },
      { chiave: "fax", etichetta: "Fax 1", tipo: "telefono", larghezza: 1 },
      { chiave: "telefono", etichetta: "Telefono", tipo: "telefono", larghezza: 1 },
      { chiave: "email", etichetta: "E-Mail", larghezza: 1, finisciRiga: true },
      { chiave: "_pagamenti", etichetta: "PAGAMENTI", tipo: "titolo", stile: "blu" },
      { chiave: "modalita_pagamento", etichetta: "Modalità pagamento", tipo: "scelta", opzioniDa: "modalita_pagamento", titoloOpzioni: "Modalità pagamento", larghezza: 1 },
      { chiave: "tipologia_pagamento", etichetta: "Tipologia Pagamento", tipo: "scelta", opzioniDa: "tipologie_pagamento", titoloOpzioni: "Tipologie Pagamento", larghezza: 1 },
      { chiave: "conto_corrente", etichetta: "Conto corrente", larghezza: 1 },
      { chiave: "iban", etichetta: "Iban", larghezza: 1 },
      { chiave: "banca", etichetta: "Banca", tipo: "scelta", opzioniDa: "banche", titoloOpzioni: "Banche", larghezza: 1 },
      { chiave: "filiale", etichetta: "Filiale", larghezza: 1, finisciRiga: true },
    ],
  },
  tecnici: {
    sezione: "tecnici",
    titolo: "Tecnici",
    titoloNuovo: "Nuovo tecnici",
    linguette: ["Storico", "Log Cloud"],
    tabella: "tecnici",
    chiaveImport: "nome",
    colonne: [
      { chiave: "nome", titolo: "Tecnico", excel: "Tecnico", larghezza: 810 },
      { chiave: "id_tecnico", titolo: "ID Tecnico", excel: "ID Tecnico", larghezza: 812 },
    ],
    campi: [
      { chiave: "nome", etichetta: "tecnici", obbligatorio: true, larghezza: 2 },
      { chiave: "utente_id", etichetta: "Tecnico (utente del gestionale)", tipo: "scelta", opzioniRpc: "elenco_utenti", larghezza: 2 },
      { chiave: "id_tecnico", etichetta: "ID Tecnico", larghezza: 2 },
    ],
  },
};
