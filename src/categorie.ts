// Macro categorie dei materiali. L'assegnazione automatica legge la descrizione:
// vale il primo materiale nominato (in "CURVA PER WC" è una curva), poi la marca se non si trova nulla.

export const DA_CONTROLLARE = "Da controllare";

const REGOLE: [string, string[]][] = [
  ["Lavori e servizi", ["MANUTENZIONE", "ORE", "MANODOPERA", "LAVORO", "INTERVENTO", "TRASFERTA", "SOPRALLUOGO", "SMONTAGGIO", "MATERIALE VARIO", "MATERIALI VARI", "FERRAMENTA", "FORO ", "INSTALLAZIONE"]],
  ["Sicurezza, TV e automazioni", ["TELECAMERA", "DVR", "NVR", "ALLARME", "SIRENA", "ANTENNA", "PRESA TV", "AMPLIFICATORE", "DERIVATORE", "VIDEOCITOFONO", "CITOFONO", "AUTOMAZIONE", "MOTORE", "CANCELLO", "CREMAGLIERA", "FOTOCELLULA", "RILEVATORE", "SENSORE", "SWITCH", "RJ45", "BASCULANTE", "TELECOMANDO", "DOMOTICO", "SCHEDA", "WALLBOX", "COLONNINA"]],
  ["Illuminazione", ["LAMPADA", "LAMPADINA", "PLAFONIERA", "FARETTO", "PROIETTORE", "STRISCIA LED", "ALIMENTATORE", "DRIVER", "APPLIQUE", "PALETTO", "SEGNAPASSO", "NEON", "PANNELLO LED", "CONNETTORE STRISCIA", "PROFILO", "CORNICE"]],
  ["Quadri e interruttori", ["MAGNETOTERMICO", "DIFFERENZIALE", "INTERRUTTORE", "CENTRALINO", "RELE", "RELE'", "QUADRO", "SEZIONATORE", "CONTATTORE", "TELERUTTORE", "FUSIBILE", "PORTAFUSIBILE", "SCARICATORE", "CREPUSCOLARE", "TRASFORMATORE", "INVERTER", "BATTERIA KWH"]],
  ["Serie civili", ["PLACCA", "PRESA", "PULSANTE", "DEVIATORE", "INVERTITORE", "COPRIFORO", "CRONOTERMOSTATO", "SPINA", "COVER", "SUPPORTO", "ADATTATORE PLACCA"]],
  ["Cavi e canaline", ["CONNETTORE", "CAVO", "CORDA", "CANALINA", "CANALETTA", "CANALE", "PASSERELLA", "GUAINA", "CORRUGATO", "TUBO CORRUGATO", "SCATOLA", "MORSETTO", "MORSETTIERA", "CAPICORDA", "CABLOFIL", "FASCETTA", "PORTACAVI", "PRESSACAVO", "TUBETTO", "TORRETTA", "POZZETTO"]],
  ["Clima e ventilazione", ["CLIMATIZZATORE", "CONDIZIONATORE", "MONOSPLIT", "SPLIT", "UNITA' INTERNA", "UNITA' ESTERNA", "UNITA' TERMINALE", "BOMBOLA", "RECUPERATORE", "GAS REFRIGERANTE", "REFRIGERANTE", "VENTILATORE", "ASPIRATORE", "GRIGLIA", "BOCCHETTA", "PLENUM", "DEUMIDIFICATORE", "POMPA DI CALORE", "ESTRATTORE", "MODULO IDRONICO", "VENTILCONVETTORE"]],
  ["Riscaldamento e fumi", ["CALDAIA", "RADIATORE", "TERMOSIFONE", "VASO ESPANSIONE", "TERMOSTATO", "TESTA TERMOSTATICA", "CANNA FUMARIA", "FUMARIA", "FUMI", "BOLLITORE", "SCALDABAGNO", "SCALDACQUA", "CIRCOLATORE", "ANTIGELO", "PANNELLO SOLARE", "SCALDASALVIETTE", "SONDA"]],
  ["Sanitari e rubinetteria", ["DOCCIA", "DOCCETTA", "MISCELATORE", "LAVABO", "BIDET", "VASO", "WC", "RUBINETTO", "CASSETTA", "PIATTO", "SOFFIONE", "SALISCENDI", "PILETTA", "LAVELLO", "SEDILE", "ORINATOIO", "CANNELLA", "FLESSIBILE", "SIFONE", "ROSONE", "GALLEGGIANTE", "MIX"]],
  ["Valvole, pompe e filtri", ["VALVOLA", "ELETTROVALVOLA", "COLLETTORE", "POMPA", "ELETTROPOMPA", "FILTRO", "CARTUCCIA", "RIDUTTORE", "SARACINESCA", "DEFANGATORE", "ADDOLCITORE", "CONTATORE", "MANOMETRO", "FLUSSOSTATO", "DISCONNETTORE", "AUTOCLAVE", "PROGRAMMATORE", "IRRIGATORE", "DOSATORE"]],
  ["Tubi", ["TUBO", "TUBI", "MULTISTRATO", "ROTOLO"]],
  ["Raccordi", ["BRAGA", "AUMENTO", "CURVA", "RACCORDO", "MANICOTTO", "GOMITO", "NIPLES", "RIDUZIONE", "TEE", "TAPPO", "TRONCHETTO", "BARILOTTO", "ADATTATORE", "PORTAGOMMA", "CANOTTO", "BOCCHETTONE", "BOCCHETTO", "LIRA", "GIUNTO", "PROLUNGA", "ATTACCO", "TERMINALE"]],
  ["Fissaggio e consumabili", ["VITE", "VITI", "TASSELLO", "COLLARE", "FERMATUBI", "NASTRO", "GUARNIZIONE", "O-RING", "SILICONE", "SIGILLANTE", "SCHIUMA", "TEFLON", "STAFFA", "MENSOLA", "PIASTRA", "BULLONE", "DADO", "RONDELLA", "BARRA", "COPERCHIO", "ACIDO", "DETERGENTE", "COLLANTE", "RESINA", "ADESIVO", "GEL", "FISSAGGIO", "ISOLANTE"]],
];

export const CATEGORIE = ["Tubi", "Raccordi", "Scarichi", ...REGOLE.map(([n]) => n).filter((n) => n !== "Tubi" && n !== "Raccordi"), DA_CONTROLLARE];

// Se il primo materiale è un tubo o un raccordo, ma per le fognature
const SCARICO = /(^|[^A-Z])(SCARICO|SCARICHI|HTB|BRAGA|TRIPLUS|SILENT|ISPEZIONE|BICC\.?|PEHD|FOGNATURA)([^A-Z]|$)/;

const MARCHE: Record<string, string> = {
  NICE: "Sicurezza, TV e automazioni", FAAC: "Sicurezza, TV e automazioni", TVT: "Sicurezza, TV e automazioni", AVS: "Sicurezza, TV e automazioni", TVV: "Sicurezza, TV e automazioni", TELEVES: "Sicurezza, TV e automazioni",
  BEG: "Illuminazione", PHIL: "Illuminazione", LDV: "Illuminazione", REDO: "Illuminazione", MEAN: "Illuminazione", "PRO LIGHT": "Illuminazione",
  HAG: "Quadri e interruttori", SCHN: "Quadri e interruttori", ABB: "Quadri e interruttori", FIN: "Quadri e interruttori", VEM: "Quadri e interruttori",
  BTI: "Serie civili", VIM: "Serie civili", GEW: "Serie civili", AVE: "Serie civili", ARN: "Serie civili",
  GEB: "Sanitari e rubinetteria", IDS: "Sanitari e rubinetteria", GIAC: "Sanitari e rubinetteria", FUSIO: "Sanitari e rubinetteria", PAF: "Sanitari e rubinetteria", RAIN: "Sanitari e rubinetteria", FANTON: "Cavi e canaline",
  MITSU: "Clima e ventilazione", EURAC: "Clima e ventilazione", TECSYS: "Clima e ventilazione", "TEC SYS": "Clima e ventilazione",
  IRSAP: "Riscaldamento e fumi", ARISTON: "Riscaldamento e fumi",
  CAL: "Valvole, pompe e filtri", WATTS: "Valvole, pompe e filtri", CALPEDA: "Valvole, pompe e filtri", LOWARA: "Valvole, pompe e filtri",
  VALS: "Scarichi", VIEGA: "Raccordi", PLAS: "Raccordi", TIRI: "Raccordi", OTERAC: "Raccordi", COMISA: "Raccordi", FISCH: "Fissaggio e consumabili",
};

// Sigla iniziale della descrizione, es. "STO" in "STO - RADIATORE..."
export function marcaDi(descrizione: unknown) {
  const m = String(descrizione ?? "").trim().toUpperCase().match(/^([A-Z][A-Z0-9 .&']{0,14}?)\s*[-–]\s/);
  return m ? m[1].trim() : "";
}

const ricerca = REGOLE.flatMap(([categoria, parole]) => parole.map((p) => ({
  categoria,
  lunghezza: p.length,
  re: new RegExp(`(^|[^A-Z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ $/, "")}(?![A-Z])`),
})));

export function categoriaDa(descrizione: unknown): string {
  const intera = String(descrizione ?? "").toUpperCase().replace(/’/g, "'");
  const marca = marcaDi(descrizione);
  const testo = marca ? intera.replace(/^[^-–]*[-–]\s*/, " ") : intera;
  let migliore: { categoria: string; lunghezza: number; posizione: number } | null = null;
  for (const r of ricerca) {
    const m = testo.match(r.re);
    if (!m) continue;
    const posizione = m.index! + m[1].length;
    if (!migliore || posizione < migliore.posizione || (posizione === migliore.posizione && r.lunghezza > migliore.lunghezza)) {
      migliore = { categoria: r.categoria, lunghezza: r.lunghezza, posizione };
    }
  }
  const trovata = migliore?.categoria ?? MARCHE[marca] ?? DA_CONTROLLARE;
  if ((trovata === "Tubi" || trovata === "Raccordi") && (SCARICO.test(testo) || (marca === "VALS" && !/PEXAL/.test(testo)))) return "Scarichi";
  return trovata;
}
