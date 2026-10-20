import type { Colonna } from "./components/Griglia";
import { dataIso, supabase } from "./supabase";
import { stampaRapporto } from "./stampe";

export interface Campo {
  chiave: string;
  etichetta: string;
  tipo?: "testo" | "area" | "scelta" | "telefono" | "titolo" | "data" | "riferimento" | "ora" | "numero" | "euro" | "booleano" | "foto" | "firma";
  // Campi a scelta: scegliendo un'opzione copia questi valori dalla sua riga (es. importi della tariffa)
  copiaDaOpzione?: string[];
  // Campi numerici aggiuntivi nella finestra di gestione delle opzioni
  colonneOpzioni?: { chiave: string; etichetta: string }[];
  // Linguetta in cui mostrare il campo (default: Principale)
  linguetta?: string;
  // Campo non modificabile (es. numero automatico, totali calcolati)
  solaLettura?: boolean;
  segnaposto?: string;
  // Opzioni fisse per i campi a scelta (es. Si / No)
  opzioniFisse?: string[];
  // Suggerimenti presi da record collegati: scegliendone uno vengono copiati alcuni campi
  suggerisciDa?: {
    tabella: string;
    filtro: { colonna: string; campo: string };
    etichetta: (r: Record<string, unknown>) => string;
    copia: string[];
    salvaId: string;
  };
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
  figli?: { linguetta: string; tabella: string; campo: string; colonne: Colonna[]; ordine?: string }[];
  // Ordinamento iniziale della griglia
  ordineIniziale?: { chiave: string; su: boolean };
  // Valori proposti per un nuovo record
  valoriNuovo?: (ctx: { utenteId: string; admin: boolean }) => Promise<Record<string, unknown>>;
  // Titolo della scheda di un record esistente
  titoloScheda?: (valori: Record<string, unknown>) => string;
  // Righe di dettaglio modificabili (es. materiali del rapporto)
  righe?: {
    tabella: string;
    campo: string;
    colonne: { chiave: string; titolo: string; larghezza: number; tipo?: "testo" | "numero" | "euro"; solaLettura?: boolean }[];
    ricalcola: (riga: Record<string, unknown>) => Record<string, unknown>;
  };
  // Campi sotto le righe (caselle e totali)
  piede?: Campo[];
  // Campi calcolati al salvataggio e mostrati nel piede (es. imponibile e totale)
  calcolaTotali?: (dati: Record<string, unknown>, righe: Record<string, unknown>[]) => Record<string, number>;
  // Documento da stampare dalla scheda (HTML)
  stampa?: (dati: Record<string, unknown>, righe: Record<string, unknown>[]) => string;
}

// Mesi di ogni periodicità, per proporre la data del prossimo intervento
const MESI_PERIODO: Record<string, number> = {
  Mensile: 1, Trimestrale: 3, Quadrimestrale: 4, Semestrale: 6, Annuale: 12, Biennale: 24, Triennale: 36,
};

// Colonne della linguetta Storico (rapporti di intervento collegati)
const COLONNE_STORICO: Colonna[] = [
  { chiave: "data", titolo: "Data", larghezza: 90, tipo: "data" },
  { chiave: "numero", titolo: "Numero", larghezza: 70 },
  { chiave: "attivita", titolo: "Attività svolte", larghezza: 300 },
  { chiave: "stato", titolo: "Stato", larghezza: 90 },
  { chiave: "imponibile", titolo: "Imponibile", larghezza: 90, tipo: "euro" },
];

const n = (v: unknown) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? 0 : Number(v));

// Totale ore = ora fine - ora inizio - pausa
function oreRapporto(dati: Record<string, unknown>, chiave: string) {
  if (!["ora_inizio", "ora_fine", "ore_pausa"].includes(chiave)) return null;
  const minuti = (t: unknown) => {
    const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const inizio = minuti(dati.ora_inizio);
  const fine = minuti(dati.ora_fine);
  if (inizio === null || fine === null) return null;
  const ore = Math.max(0, (fine - inizio) / 60 - n(dati.ore_pausa));
  return { totale_ore: Math.round(ore * 100) / 100 };
}

// Imponibile = materiali + diritto di chiamata + tariffa fissa + ore × tariffa oraria + km × tariffa km
function totaliRapporto(dati: Record<string, unknown>, righe: Record<string, unknown>[]) {
  const materiali = righe.reduce((t, r) => t + n(r.totale), 0);
  const prezzoOre = Math.round(n(dati.totale_ore) * n(dati.tariffa_oraria) * 100) / 100;
  const prezzoKm = Math.round(n(dati.km_percorsi) * n(dati.tariffa_km) * 100) / 100;
  const tariffe = n(dati.diritto_chiamata) + n(dati.tariffa_fissa) + prezzoOre + prezzoKm;
  // I rapporti importati non hanno righe né tariffe: si conserva l'imponibile originale
  const calcolato = righe.length || tariffe ? Math.round((materiali + tariffe) * 100) / 100 : n(dati.imponibile);
  const imponibile = dati.azzera_imponibile ? 0 : calcolato;
  return {
    imponibile,
    _totale: dati.considera_totale_preventivo ? n(dati.totale_preventivo) : imponibile,
    _prezzo_ore: prezzoOre,
    _prezzo_km: prezzoKm,
    _totale_servizi: Math.round(tariffe * 100) / 100,
  };
}

const oraAttuale = () => new Date().toTimeString().slice(0, 5);

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
      linguetta: "Storico",
      tabella: "rapporti",
      campo: "cliente_id",
      ordine: "data",
      colonne: COLONNE_STORICO,
    }, {
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
    figli: [{ linguetta: "Storico", tabella: "rapporti", campo: "impianto_id", ordine: "data", colonne: COLONNE_STORICO }],
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
  rapporti: {
    sezione: "rapporti",
    titolo: "Rapporti di intervento",
    titoloNuovo: "Nuovo intervento tecnico",
    titoloScheda: (v) => `Intervento tecnico N. ${v.numero ?? ""} - ${v.cliente ?? ""}`,
    linguette: ["Dettaglio", "Tariffe", "Storico", "Log Cloud"],
    tabella: "rapporti",
    select: "*, cliente:clienti(nome), tecnico:tecnici(nome)",
    chiaveImport: "numero",
    ordineIniziale: { chiave: "data", su: false },
    quandoCambia: oreRapporto,
    calcolaTotali: totaliRapporto,
    stampa: stampaRapporto,
    valoriNuovo: async ({ utenteId, admin }) => {
      // Tecnico proposto: quello collegato all'utente, oppure "Amministrazione" per l'admin
      let { data: tecnico } = await supabase.from("tecnici").select("id, nome").eq("utente_id", utenteId).is("eliminato_il", null).limit(1).maybeSingle();
      if (!tecnico && admin) {
        ({ data: tecnico } = await supabase.from("tecnici").select("id, nome").ilike("nome", "amministrazione").limit(1).maybeSingle());
      }
      const ora = oraAttuale();
      return {
        data: dataIso(new Date()), ora_inizio: ora, ora_fine: ora, ore_pausa: 0, totale_ore: 0,
        tecnico_id: tecnico?.id ?? null, tecnico: tecnico?.nome ?? "",
      };
    },
    colonne: [
      { chiave: "data", titolo: "Data", excel: "Data", larghezza: 82, tipo: "data" },
      { chiave: "pagamento_contanti", titolo: "Pagamento in contanti", excel: "Pagamento in contanti", larghezza: 60, tipo: "booleano" },
      { chiave: "considera_totale_preventivo", titolo: "Considera totale preventivo", excel: "Considera totale preventivo", larghezza: 40, tipo: "booleano" },
      { chiave: "numero", titolo: "Numero", excel: "Numero", larghezza: 44 },
      { chiave: "cliente", titolo: "Nome cliente", excel: "Nome cliente", larghezza: 177, riferimento: { campo: "cliente_id", tabella: "clienti" } },
      { chiave: "stato", titolo: "Stato documento", excel: "Stato documento", larghezza: 41 },
      { chiave: "tecnico", titolo: "Tecnico", excel: "Tecnico", larghezza: 131, riferimento: { campo: "tecnico_id", tabella: "tecnici" } },
      { chiave: "tecnico_vecchio", titolo: "Tecnico Vecchio", excel: "Tecnico Vecchio", larghezza: 70 },
      { chiave: "attivita", titolo: "Attività svolte", excel: "Attività svolte", larghezza: 202 },
      { chiave: "imponibile", titolo: "Imponibile", excel: "Imponibile", larghezza: 74, tipo: "euro" },
      { chiave: "azzera_imponibile", titolo: "Azzera Imponibile", excel: "Azzera Imponibile", larghezza: 45, tipo: "booleano" },
      { chiave: "fatto_conto", titolo: "Fatto conto", excel: "Fatto conto", larghezza: 45 },
      { chiave: "pagata", titolo: "Pagata", excel: "Pagata", larghezza: 49, tipo: "booleano" },
      { chiave: "data_pagamento", titolo: "Data Pagamento", excel: "Data Pagamento", larghezza: 77, tipo: "data" },
      { chiave: "rif_preventivo", titolo: "Rif. Preventivo", excel: "Rif. Preventivo", larghezza: 149 },
      { chiave: "totale_preventivo", titolo: "Totale Preventivo", excel: "Totale Preventivo", larghezza: 66, tipo: "euro" },
      { chiave: "note", titolo: "Note", excel: "Note", larghezza: 48 },
      { chiave: "foto1", titolo: "Foto", excel: "Foto", larghezza: 22, tipo: "immagine" },
      { chiave: "foto2", titolo: "Foto 2", excel: "Foto 2", larghezza: 22, tipo: "immagine" },
      { chiave: "foto3", titolo: "Foto 3", excel: "Foto 3", larghezza: 22, tipo: "immagine" },
      { chiave: "foto4", titolo: "Foto 4", excel: "Foto 4", larghezza: 22, tipo: "immagine" },
      { chiave: "gimpianto", titolo: "gimpianto", excel: "gimpianto", larghezza: 136 },
    ],
    campi: [
      { chiave: "numero", etichetta: "Numero", larghezza: 1, solaLettura: true, segnaposto: "Auto compilato" },
      { chiave: "data", etichetta: "Data", tipo: "data", larghezza: 1, obbligatorio: true },
      { chiave: "tecnico_id", etichetta: "Tecnico", tipo: "riferimento", riferimentoA: "tecnici", larghezza: 2 },
      { chiave: "ora_inizio", etichetta: "Ora inizio", tipo: "ora", larghezza: 1 },
      { chiave: "ora_fine", etichetta: "Ora fine", tipo: "ora", larghezza: 1 },
      { chiave: "ore_pausa", etichetta: "Ore Pausa", tipo: "numero", larghezza: 1 },
      { chiave: "totale_ore", etichetta: "Totale ore", tipo: "numero", larghezza: 1, solaLettura: true },
      { chiave: "cliente_id", etichetta: "Nome cliente", tipo: "riferimento", riferimentoA: "clienti", larghezza: 2 },
      {
        chiave: "tipo_impianto", etichetta: "Tipo impianto", larghezza: 2,
        suggerisciDa: {
          tabella: "impianti",
          filtro: { colonna: "cliente_id", campo: "cliente_id" },
          etichetta: (r) => [r.tipo_impianto, r.impianto, r.marca, r.modello].filter(Boolean).join(" - ") || "Impianto senza nome",
          copia: ["tipo_impianto", "impianto", "marca", "modello", "matricola"],
          salvaId: "impianto_id",
        },
      },
      { chiave: "impianto", etichetta: "Impianto", larghezza: 2 },
      { chiave: "marca", etichetta: "Marca", larghezza: 2 },
      { chiave: "modello", etichetta: "Modello", larghezza: 1 },
      { chiave: "matricola", etichetta: "Matricola", larghezza: 1 },
      { chiave: "rif_preventivo", etichetta: "Rif. Preventivo", larghezza: 2 },
      { chiave: "fatto_conto", etichetta: "Fatto conto", tipo: "scelta", opzioniFisse: ["Si", "No"], larghezza: 1 },
      { chiave: "stato", etichetta: "Stato", tipo: "scelta", opzioniDa: "stati_documento", titoloOpzioni: "Stati documento", larghezza: 1 },
      { chiave: "pagata", etichetta: "Pagata", tipo: "booleano", larghezza: 0.5 },
      { chiave: "data_pagamento", etichetta: "Data Pagamento", tipo: "data", larghezza: 1, finisciRiga: true },
      { chiave: "attivita", etichetta: "Attività svolte", tipo: "area", larghezza: 4 },
      { chiave: "note", etichetta: "Note", tipo: "area", larghezza: 4 },
      { chiave: "firma", etichetta: "Firma", tipo: "firma", larghezza: 2, linguetta: "Dettaglio" },
      { chiave: "foto1", etichetta: "Foto", tipo: "foto", larghezza: 2, linguetta: "Dettaglio" },
      { chiave: "foto2", etichetta: "Foto 2", tipo: "foto", larghezza: 2, linguetta: "Dettaglio" },
      { chiave: "foto3", etichetta: "Foto 3", tipo: "foto", larghezza: 2, linguetta: "Dettaglio" },
      { chiave: "foto4", etichetta: "Foto 4", tipo: "foto", larghezza: 2, linguetta: "Dettaglio" },
      {
        chiave: "tariffa", etichetta: "Tariffa", tipo: "scelta", opzioniDa: "tariffe", titoloOpzioni: "Tariffe", larghezza: 1, linguetta: "Tariffe",
        copiaDaOpzione: ["diritto_chiamata", "tariffa_fissa", "tariffa_oraria", "tariffa_km"],
        colonneOpzioni: [
          { chiave: "diritto_chiamata", etichetta: "Diritto chiamata" },
          { chiave: "tariffa_fissa", etichetta: "Tariffa fissa" },
          { chiave: "tariffa_oraria", etichetta: "Tariffa oraria" },
          { chiave: "tariffa_km", etichetta: "Tariffa KM" },
        ],
      },
      { chiave: "diritto_chiamata", etichetta: "Diritto chiamata", tipo: "euro", larghezza: 1, linguetta: "Tariffe" },
      { chiave: "tariffa_fissa", etichetta: "Tariffa fissa", tipo: "euro", larghezza: 1, linguetta: "Tariffe" },
      { chiave: "tariffa_oraria", etichetta: "Tariffa oraria", tipo: "euro", larghezza: 1, linguetta: "Tariffe" },
      { chiave: "tariffa_km", etichetta: "Tariffa KM", tipo: "euro", larghezza: 1, linguetta: "Tariffe" },
      { chiave: "_prezzo_km", etichetta: "Totale prezzo KM", tipo: "euro", solaLettura: true, larghezza: 1, linguetta: "Tariffe" },
      { chiave: "_prezzo_ore", etichetta: "Totale prezzo oraria", tipo: "euro", solaLettura: true, larghezza: 1, linguetta: "Tariffe" },
      { chiave: "_totale_servizi", etichetta: "Totale servizi", tipo: "euro", solaLettura: true, larghezza: 1, linguetta: "Tariffe" },
      { chiave: "km_percorsi", etichetta: "KM percorsi", tipo: "numero", larghezza: 1, linguetta: "Tariffe" },
    ],
    righe: {
      tabella: "righe_rapporto",
      campo: "rapporto_id",
      colonne: [
        { chiave: "codice_barre", titolo: "Codice a barre", larghezza: 70 },
        { chiave: "descrizione", titolo: "Descrizione", larghezza: 330 },
        { chiave: "codice_articolo", titolo: "Cod. Art", larghezza: 60 },
        { chiave: "unita_misura", titolo: "U.m.", larghezza: 40 },
        { chiave: "quantita", titolo: "Quantità", larghezza: 60, tipo: "numero" },
        { chiave: "prezzo", titolo: "Prezzo", larghezza: 65, tipo: "numero" },
        { chiave: "ricarico", titolo: "Ricarico %", larghezza: 55, tipo: "numero" },
        { chiave: "prezzo_finale", titolo: "(Prezzo)", larghezza: 65, tipo: "euro", solaLettura: true },
        { chiave: "totale", titolo: "Totale", larghezza: 70, tipo: "euro", solaLettura: true },
        { chiave: "nome_articolo", titolo: "Nome Articolo", larghezza: 110 },
      ],
      ricalcola: (r) => {
        const prezzoFinale = Math.round(n(r.prezzo) * (1 + n(r.ricarico) / 100) * 10000) / 10000;
        return { ...r, prezzo_finale: prezzoFinale, totale: Math.round(n(r.quantita) * prezzoFinale * 100) / 100 };
      },
    },
    piede: [
      { chiave: "pagamento_contanti", etichetta: "Pagamento in contanti", tipo: "booleano" },
      { chiave: "azzera_imponibile", etichetta: "Azzera Imponibile", tipo: "booleano" },
      { chiave: "considera_totale_preventivo", etichetta: "Considera totale preventivo", tipo: "booleano" },
      { chiave: "totale_preventivo", etichetta: "Totale Preventivo", tipo: "euro" },
      { chiave: "_totale", etichetta: "Totale", tipo: "euro", solaLettura: true },
    ],
  },
};
