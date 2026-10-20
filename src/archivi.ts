import type { Colonna } from "./components/Griglia";
import { dataIso } from "./supabase";

export interface Campo {
  chiave: string;
  etichetta: string;
  tipo?: "testo" | "area" | "scelta" | "telefono" | "titolo" | "data" | "riferimento";
  // Per i campi "riferimento": tabella collegata (si sceglie per nome, si salva l'id)
  riferimentoA?: string;
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
  colonne: (Colonna & {
    excel: string;
    // Colonna che mostra il nome di un record collegato: in importazione il nome diventa l'id
    riferimento?: { campo: string; tabella: string };
  })[];
  campi: Campo[];
  // Campo (o campi) usati per riconoscere i doppioni in importazione
  chiaveImport: string | string[];
  // Colonne da leggere, con eventuali tabelle collegate (default "*")
  select?: string;
  // Ricalcola altri campi quando uno cambia (es. data prossimo intervento)
  quandoCambia?: (dati: Record<string, unknown>, chiave: string) => Record<string, unknown> | null;
  // Linguette della scheda che mostrano i record collegati (es. gli impianti di un cliente)
  figli?: { linguetta: string; tabella: string; campo: string; colonne: Colonna[] }[];
}

// Mesi di ogni periodicità, per proporre la data del prossimo intervento
const MESI_PERIODO: Record<string, number> = {
  Mensile: 1, Trimestrale: 3, Quadrimestrale: 4, Semestrale: 6, Annuale: 12, Biennale: 24, Triennale: 36,
};

function prossimoIntervento(dati: Record<string, unknown>, chiave: string) {
  if (chiave !== "periodo" && chiave !== "data_ultimo") return null;
  const mesi = MESI_PERIODO[String(dati.periodo ?? "")];
  const ultimo = dataIso(dati.data_ultimo);
  if (!mesi || !ultimo) return null;
  const [a, m, g] = ultimo.split("-").map(Number);
  const d = new Date(a, m - 1 + mesi, g);
  return { data_prossimo: dataIso(d) };
}

// Configurazione delle sezioni a griglia, colonne nello stesso ordine e con gli stessi titoli dell'originale
export const ARCHIVI: Record<string, Archivio> = {
  clienti: {
    sezione: "clienti",
    titolo: "Clienti",
    titoloNuovo: "Nuovo cliente",
    linguette: ["Impianti", "Storico", "Log Cloud"],
    tabella: "clienti",
    figli: [{
      linguetta: "Impianti",
      tabella: "impianti",
      campo: "cliente_id",
      colonne: [
        { chiave: "impianto", titolo: "Impianto", larghezza: 200 },
        { chiave: "tipo_impianto", titolo: "Tipo impianto", larghezza: 150 },
        { chiave: "marca", titolo: "Marca", larghezza: 130 },
        { chiave: "modello", titolo: "Modello", larghezza: 130 },
        { chiave: "periodo", titolo: "Periodo", larghezza: 100 },
        { chiave: "data_prossimo", titolo: "Data prossimo intervento", larghezza: 160, tipo: "data" },
      ],
    }],
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
  impianti: {
    sezione: "impianti",
    titolo: "Impianti",
    titoloNuovo: "Nuovo impianto",
    linguette: ["Materiali", "Storico", "Log Cloud"],
    tabella: "impianti",
    select: "*, cliente:clienti(nome)",
    chiaveImport: ["cliente", "impianto", "tipo_impianto", "marca", "modello", "matricola"],
    quandoCambia: prossimoIntervento,
    colonne: [
      { chiave: "cliente", titolo: "Cliente", excel: "Cliente", larghezza: 290, riferimento: { campo: "cliente_id", tabella: "clienti" } },
      { chiave: "periodo", titolo: "Periodo", excel: "Periodo", larghezza: 129 },
      { chiave: "tipo_impianto", titolo: "Tipo impianto", excel: "Tipo impianto", larghezza: 132 },
      { chiave: "impianto", titolo: "Impianto", excel: "Impianto", larghezza: 108 },
      { chiave: "marca", titolo: "Marca", excel: "Marca", larghezza: 126 },
      { chiave: "modello", titolo: "Modello", excel: "Modello", larghezza: 107 },
      { chiave: "matricola", titolo: "Matricola", excel: "Matricola", larghezza: 108 },
      { chiave: "anno", titolo: "Anno", excel: "Anno", larghezza: 97 },
      { chiave: "note", titolo: "Note", excel: "Note", larghezza: 97 },
      { chiave: "materiali", titolo: "materiali", excel: "materiali", larghezza: 117 },
      { chiave: "data_prossimo", titolo: "Data prossimo intervento", excel: "Data prossimo intervento", larghezza: 159, tipo: "data" },
      { chiave: "data_ultimo", titolo: "Data Ultimo Intervento", excel: "Data Ultimo Intervento", larghezza: 152, tipo: "data" },
    ],
    campi: [
      { chiave: "periodo", etichetta: "Periodo", tipo: "scelta", opzioniDa: "periodi", titoloOpzioni: "Periodi", larghezza: 1 },
      { chiave: "data_prossimo", etichetta: "Data prossimo intervento", tipo: "data", larghezza: 1 },
      { chiave: "tipo_impianto", etichetta: "Tipo impianto", larghezza: 2 },
      { chiave: "impianto", etichetta: "Impianto", larghezza: 2 },
      { chiave: "marca", etichetta: "Marca", larghezza: 2 },
      { chiave: "modello", etichetta: "Modello", larghezza: 2 },
      { chiave: "matricola", etichetta: "Matricola", larghezza: 1 },
      { chiave: "anno", etichetta: "Anno", larghezza: 1 },
      { chiave: "note", etichetta: "Note", tipo: "area", larghezza: 4 },
      { chiave: "materiali", etichetta: "materiali", larghezza: 2 },
      { chiave: "data_ultimo", etichetta: "Data Ultimo Intervento", tipo: "data", larghezza: 1, finisciRiga: true },
      { chiave: "cliente_id", etichetta: "Cliente", tipo: "riferimento", riferimentoA: "clienti", larghezza: 2, finisciRiga: true },
    ],
  },
};
