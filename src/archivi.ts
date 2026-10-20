import type { Colonna } from "./components/Griglia";

export interface Campo {
  chiave: string;
  etichetta: string;
  tipo?: "testo" | "area" | "scelta";
  // Per i campi a scelta: tabella da cui leggere le opzioni (colonna "nome")
  opzioniDa?: string;
  obbligatorio?: boolean;
}

export interface Archivio {
  sezione: string;
  titolo: string;
  tabella: string;
  colonne: (Colonna & { excel: string })[];
  campi: Campo[];
  // Campo usato per riconoscere i doppioni in importazione
  chiaveImport: string;
  // Archivi collegati (menu "Archivi")
  archivi?: { titolo: string; tabella: string }[];
}

// Configurazione delle sezioni a griglia, colonne nello stesso ordine e con gli stessi titoli dell'originale
export const ARCHIVI: Record<string, Archivio> = {
  clienti: {
    sezione: "clienti",
    titolo: "Clienti",
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
      { chiave: "nome", etichetta: "Nome Cliente", obbligatorio: true },
      { chiave: "codice_fiscale", etichetta: "Codice Fiscale" },
      { chiave: "piva", etichetta: "P.IVA" },
      { chiave: "indirizzo_fatturazione", etichetta: "Indirizzo Fatturazione" },
      { chiave: "email", etichetta: "E-Mail" },
      { chiave: "nome_contatto", etichetta: "Nome contatto" },
      { chiave: "telefono", etichetta: "Telefono" },
      { chiave: "cellulare", etichetta: "Cellulare" },
      { chiave: "tipologia_pagamento", etichetta: "Tipologia Pagamento", tipo: "scelta", opzioniDa: "tipologie_pagamento" },
      { chiave: "note", etichetta: "Note", tipo: "area" },
    ],
    archivi: [{ titolo: "Tipologie Pagamento", tabella: "tipologie_pagamento" }],
  },
};
