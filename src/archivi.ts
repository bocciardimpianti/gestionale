import type { Colonna } from "./components/Griglia";

export interface Campo {
  chiave: string;
  etichetta: string;
  tipo?: "testo" | "area" | "scelta" | "telefono" | "titolo";
  // Colonne occupate su 4 (come nella scheda originale)
  larghezza?: 1 | 2 | 4;
  // Lascia vuoto il resto della riga dopo questo campo
  finisciRiga?: boolean;
  // Per i campi a scelta: tabella da cui leggere le opzioni (colonna "nome")
  opzioniDa?: string;
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
};
