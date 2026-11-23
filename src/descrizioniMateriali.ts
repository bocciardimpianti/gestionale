// Riordino delle descrizioni dei materiali con regole fisse (decise con il titolare):
//  1. una sola forma per marca (sigla) all'inizio: "BTI - …"; un solo " - ", quello dopo la marca
//  2. testo in MAIUSCOLO, unità scritte normali (mm, mm², kW, Vca, lm, Hz…)
//  3. pollici sempre con ": 1/2", 1 1/4" (niente Ø davanti ai pollici)
//  4. maschio/femmina attaccati alla misura: stessa misura una volta sola (1/2"FF), misure diverse 3/4"M X 1/2"F
//  5. diametri Ø14 attaccati, lunghezze 200mm, misure 16X2, pollici 3/4" X 1/2", metri 1MT, gradi 90°
//  6. abbreviazioni per esteso (c/ → CON, RUB → RUBINETTO…), niente spazi doppi né punto finale
// Le frazioni che non sono pollici (0,6/1kV, 5/10, 130/220) non si toccano.

export type Regola = "spazi" | "maiuscolo" | "marca" | "abbreviazioni" | "gradi" | "diametri" | "pollici" | "maschio_femmina" | "misure" | "metri" | "trattini" | "materiale" | "unita" | "finale";
export const NOMI_REGOLE: Record<Regola, string> = {
  spazi: "Spazi doppi", maiuscolo: "Maiuscolo", marca: "Stessa sigla per la marca", abbreviazioni: "Abbreviazioni per esteso",
  gradi: "Gradi 90°", diametri: "Diametri Ø e mm", pollici: 'Pollici con "', maschio_femmina: "Maschio/femmina", misure: "Misure AxB",
  metri: "Metri 1MT", trattini: "Trattini solo dopo la marca", materiale: "Materiale dopo le misure", unita: "Unità (mm, kW, Vca…)", finale: "Punto o trattino in fondo",
};

// Sigle della stessa marca scritte in modi diversi → la più usata nel catalogo
const MARCHE: Record<string, string> = { GEBERIT: "GEB", SCH: "SCHN", FISCHER: "FISCH", GIACOMINI: "GIAC", CALEFFI: "CAL", IMMERGAS: "IMG" };

const FRAZ = String.raw`(?:[1357]\/8|[13]\/4|1\/2)`;
const POLL = String.raw`(?<![\d\/.,])(?:(?:(?<!Ø)[1-9]\d?|[1-4]) ${FRAZ}|(?<!(?<![\d\/.,])\d{1,2} )${FRAZ}|[1-9]\d?)"`;                 // 1/2"  1 1/4"  2"
const MIS = String.raw`(?:${POLL}|Ø\d+(?:[.,]\d+)?(?![\d.,]))`;                          // misura: pollici o Ø in mm
const SIGLE_MF: Record<string, [string, string]> = {
  MF: ["M", "F"], "M/F": ["M", "F"], "M-F": ["M", "F"], "M.F.": ["M", "F"], FM: ["F", "M"], "F/M": ["F", "M"], "F-M": ["F", "M"],
  FFF: ["F", "F"], MMM: ["M", "M"], FF: ["F", "F"], "F/F": ["F", "F"], "F-F": ["F", "F"], "F.F.": ["F", "F"], MM: ["M", "M"], "M/M": ["M", "M"], "M-M": ["M", "M"], "M.M.": ["M", "M"],
};
// coppia di misure: almeno una in pollici o con Ø, l'altra può essere un numero (mm): 18X1/2", Ø16X14, 1 1/4"X32
const NUM = String.raw`(?<![\d\/.,])\d+(?:[.,]\d+)?(?![\d.,\/])(?:MM)?`;
const COPPIA = String.raw`(?:(${MIS})\s*X\s*(${MIS}|${NUM})|(${NUM})\s*X\s*(${MIS}))`;
const SIGLA = String.raw`(FFF|MMM|M\/F|F\/M|M-F|F-M|F\/F|M\/M|F-F|M-M|M\.F\.|F\.F\.|M\.M\.|MF|FM|FF|MM)`;

const RACCORDI = new Set(["TEE", "GOMITO", "CURVA", "MANICOTTO", "RIDUZIONE", "NIPLES", "TAPPO", "CALOTTA", "BOCCHETTONE", "BARILOTTO", "CROCE",
  "PORTAGOMMA", "PROLUNGA", "ADATTATORE", "GIUNTO", "RACCORDO", "TRONCHETTO", "CANOTTO"]);
const MATERIALI_RACC = new Set(["OTTONE", "BRONZO", "RAME", "ACCIAIO", "INOX", "ZINCATO", "GHISA", "PVC", "CROMATO", "NICHELATO"]);

const passi: { r: Regola; f: (d: string) => string }[] = [
  { r: "spazi", f: (d) => d.replace(/\s+/g, " ").trim() },
  { r: "maiuscolo", f: (d) => d.replace(/[”“″]|''/g, '"').replace(/[×]/g, "X").toUpperCase() },
  // (serve uno spazio vicino al trattino: "O-RING" non è una marca)
  { r: "marca", f: (d) => d.replace(/^([A-Z0-9 .&'-]{1,15}?)(?:\s+[-–]\s*|\s*[-–]\s+)/, (t, m: string) => `${MARCHE[m.trim()] ?? m.trim()} - `) },
  { r: "abbreviazioni", f: (d) => d
    .replace(/\bC\/\s*(?=[A-Z])/g, "CON ")
    .replace(/\bRUB\.?(?= )/g, "RUBINETTO").replace(/\bBCO\.?\b/g, "BIANCO").replace(/\bINTERR\.?(?= )/g, "INTERRUTTORE")
    .replace(/\bRACC\.(?=\s|[A-Z])/g, "RACCORDO ").replace(/\bRID\.?(?= )/g, "RIDUZIONE").replace(/\bRIDUZ\.?(?= )/g, "RIDUZIONE")
    .replace(/\bFLESSIB\.?(?= )/g, "FLESSIBILE").replace(/\bMANIC\.?(?= )/g, "MANICOTTO").replace(/\bVALV\.?(?= )/g, "VALVOLA")
    .replace(/\bIRRIGAZ\.(?=\s|$)/g, "IRRIGAZIONE")
    .replace(/(?<=[A-Z]{2}) X (?=[A-Z]{3,})/g, " PER ")
    .replace(/(?<=\d) X (?=(?:GAS|ACQUA|PEX|RAME|MULTISTRATO|TUBO|CALDAIA|LAVABO|WC|BIDET|SCARICO)\b)/g, " PER ") },
  // Gradi solo per gli angoli dei raccordi (500 GR di silicone restano grammi)
  { r: "gradi", f: (d) => d.replace(/\b(15|30|45|67|87|88|90|135|180)\s*(?:GR\.?|GRADI)(?![A-Z])/g, "$1°").replace(/(\d)\s+°/g, "$1°") },
  { r: "diametri", f: (d) => d
    .replace(/(?:\bDIAM\.?|\bDIAMETRO|(?<![A-Z])D\.)\s*(?=\d)/g, "Ø").replace(/Ø\s+(?=\d)/g, "Ø")
    .replace(/(\d)\s+MM(?![A-Z0-9²2.])/g, "$1MM")
    .replace(/Ø(\d+(?:[.,]\d+)?)MM\b/g, "Ø$1")                                    // Ø50 MM → Ø50 (Ø è già in mm)
    .replace(/(?<![A-Z\d"])MM\.?\s*(\d+\/\d+)(?![\d"])/g, "$1MM")                   // MM.130/220 → 130/220mm
    .replace(/(?<![A-Z\d])CM\.?\s*(\d+(?:[.,]\d+)?(?:-\d+)?)(?![\d\/"])/g, "$1CM")    // CM.30 → 30cm
    .replace(/(?<![A-WYZ\d"])MM\.?\s*(\d+(?:[.,]\d+)?(?:\s*X\s*\d+(?:[.,]\d+)?)*)(?![\d\/"])/g, "$1MM")
    .replace(/(\d)\s*(?:LT\.?|LITRI)(?![A-Z])/g, "$1LT") },
  { r: "pollici", f: (d) => d
    .replace(/(?<!°\s?\d{0,2}|(?:\.{2,}|…)\d{0,2})(\d)'(?![A-EG-LN-WYZ'])/g, '$1"')                              // apostrofo come pollici: 1'F X 1'1/2F → 1"F X 1"1/2F
    .replace(/(\d{1,2})\s*\.\s*(\d\/[248])(?!\d)/g, "$1 $2")              // 1.1/4 → 1 1/4
    .replace(/(\d{1,2})"\s*(\d\/[248])"?/g, "$1 $2\"")                    // 1"1/2 → 1 1/2"
    .replace(new RegExp(String.raw`(?<![\d,.\/])(\d{1,2} ${FRAZ}|${FRAZ})(?![\d\/"])`, "g"), '$1"') // 1/2 → 1/2"
    .replace(new RegExp(String.raw`Ø\s*(?=${POLL})`, "g"), "") },          // Ø1/2" → 1/2"
  { r: "maschio_femmina", f: (d) => {
    // tee con le tre uscite uguali: la misura una volta sola (TEE FF 1"X1"X1" → TEE 1"FFF)
    const tee = /\bTEE\b/.test(d) && !/\bRIDOTT[OA]\b/.test(d);
    if (tee) d = d.replace(new RegExp(String.raw`(${MIS})(?:\s*X\s*\1){1,2}(?![\dX"\/])`, "g"), "$1");
    const lettere = (s: string) => SIGLE_MF[s] ?? null;
    // stessa misura ai due lati: una volta sola con le lettere attaccate (1/2"FF); misure diverse: 3/4"M X 1/2"F
    // prolunghe: pollici X numero in mm = attacco X lunghezza → le lettere restano sui pollici (3/4"MF X 20mm)
    const prolunga = /\bPROLUNG/.test(d);
    const coppia = (m1: string, m2: string | undefined, l: [string, string]) => (!m2 || m2 === m1 ? `${m1}${l[0]}${l[1]}`
      : prolunga && m1.includes('"') && !m2.includes('"') && !m2.startsWith("Ø") ? `${m1}${l[0]}${l[1]} X ${m2}` : `${m1}${l[0]} X ${m2}${l[1]}`);
    // lettera davanti alla misura: M1/2"-F1/2" → 1/2"M X 1/2"F
    d = d.replace(new RegExp(String.raw`\b([MF]) ?(${POLL})\s*[-X]\s*([MF]) ?(${POLL})`, "g"), "$2$1 X $4$3");
    // misure con la lettera già vicina: 3/4" M → 3/4"M ;  M 3/8" X F 3/8" → 3/8"M X 3/8"F
    d = d.replace(new RegExp(String.raw`\b([MF]) (${POLL})(?=\s*X\s*[MF] )`, "g"), "$2$1").replace(new RegExp(String.raw`(X\s*)([MF]) (${POLL})`, "g"), "$1$3$2");
    d = d.replace(new RegExp(String.raw`(${POLL}) ([MF])(?![A-Z0-9\/.-])`, "g"), "$1$2");
    // sigla (MF, FF, M/F…) dopo la misura: 1" FF → 1"F X 1"F ; 3/4" X 1/2" MF → 3/4"M X 1/2"F ; 18X1/2" FF → 18F X 1/2"F
    d = d.replace(new RegExp(String.raw`${COPPIA}\s+${SIGLA}(?![A-Z0-9\/])`, "g"), (t, a1, a2, b1, b2, s: string) => {
      const l = lettere(s); const m1 = a1 ?? b1, m2 = a2 ?? b2;
      if (!l || (s === "MM" && !`${m1}${m2}`.includes('"'))) return t;
      return coppia(m1, m2, l);
    });
    d = d.replace(new RegExp(String.raw`(${MIS})\s*${SIGLA}(?![A-Z0-9\/])`, "g"), (t, m1: string, s: string) => {
      const l = lettere(s); if (!l || (s === "MM" && !m1.includes('"'))) return t;
      return coppia(m1, undefined, l);
    });
    // sigla prima della misura (anche con parole in mezzo, es. CURVA MF 45° Ø28): va sulla prima misura che segue
    d = d.replace(new RegExp(String.raw`(?<![A-Z0-9\/."])${SIGLA}(?![A-Z0-9\/])((?:\s+(?!\d+(?:[.,]\d+)?MM\b)[^\s"Ø]+){0,4}?)\s*(?:${COPPIA}|(${MIS}))(?![MF]\b|"|\s*X\s*[\dØ])`, "g"),
      (t, s: string, mezzo: string, a1, a2, b1, b2, sola) => {
        const l = lettere(s);
        const m1 = a1 ?? b1 ?? sola, m2 = a2 ?? b2;
        if (!l || !m1 || (s === "MM" && !`${m1}${m2 ?? ""}`.includes('"'))) return t;
        return `${mezzo.trim() ? mezzo.trim() + " " : ""}${coppia(m1, m2, l)}`;
      });
    // già scritte con la stessa misura due volte: 1/2"F X 1/2"F → 1/2"FF
    d = d.replace(new RegExp(String.raw`(?<!(?:"[MF]?|\d|\s)X\s*)(${MIS})([MF])\s*X\s*\1([MF])(?![A-Z0-9]|\s*X)`, "g"), "$1$2$3");
    // tee: tre uscite, quindi FFF / MMM
    if (tee) d = d.replace(new RegExp(String.raw`(${MIS})(FF|MM)(?![A-Z0-9])`, "g"), (t, m: string, l: string) => m + l + l[0]);
    // sigle rimaste senza misura: una sola forma
    return d.replace(new RegExp(String.raw`(?<![A-Z0-9\/.])(M\/F|M-F|M\.F\.)(?![A-Z0-9\/])`, "g"), "MF").replace(/(?<![A-Z0-9\/.])(F\/F|F-F|F\.F\.)(?![A-Z0-9\/])/g, "FF")
      .replace(/(?<![A-Z0-9\/.])(F\/M|F-M)(?![A-Z0-9\/])/g, "FM").replace(/(?<![A-Z0-9\/.])(M\/M|M-M|M\.M\.)(?![A-Z0-9\/])/g, "MM");
  } },
  { r: "misure", f: (d) => d
    .replace(/(\d)\s*X\s*(\d)/g, "$1X$2")
    .replace(/("[MF]?)\s*X\s*(?=[\dØ])/g, "$1 X ")
    .replace(/(\d)X(\d{1,2} \d\/\d"|\d\/\d")/g, "$1 X $2") },
  { r: "metri", f: (d) => d
    .replace(/\bMT\.?\s*(\d+(?:[.,]\d+)?)(?![\d\/])/g, "$1MT")
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:MT\.?|MTL\.?|METRI)(?![A-Z²³])/g, "$1MT")
    // ML: metri lineari se pochi (1ML, 25ML), millilitri se tanti (750ML)
    .replace(/(\d+(?:[.,]\d+)?)\s*ML\.?(?![A-Z²³])/g, (t, n: string) => (Number(n.replace(",", ".")) < 50 ? `${n}MT` : t)) },
  { r: "trattini", f: (d) => {
    const m = d.match(/^([A-Z0-9 .&'-]{1,15}? - )(.*)$/);
    return m ? m[1] + m[2].replace(/\s+-\s+/g, " ").replace(/^-\s+/, "") : d.replace(/\s+-\s+/g, " ");
  } },
  // M o F scritti da soli vicino alla misura (RACCORDO F 1/2" X 16, 3/4" X 22 F, MANICOTTO Ø22 F): attaccati alla prima
  // misura in pollici o con Ø → 1/2"F X 16, 3/4"F X 22, Ø22F (come le altre sigle)
  { r: "maschio_femmina", f: (d) => {
    const w = d.split(" ");
    // pollici (1/2", 2", la frazione di 1 1/4") o Ø, senza lettere già attaccate
    const sezione = (t: string) => /^(?:\d\/\d{1,2}"|\d{1,2}"|Ø\d+(?:[.,]\d+)?(?:X\d+(?:[.,]\d+)?)*)$/.test(t);
    const misura = (t: string) => /^(?:Ø|\d)/.test(t) && !/°/.test(t);
    // nel gruppo di misure (A X B X C) la lettera va sui pollici, se ci sono (TEE F Ø20 X 1/2" X 20 → Ø20 X 1/2"F X 20)
    const scegli = (da: number) => {
      const g = [da];
      for (let q = da; w[q + 1] === "X" && misura(w[q + 2] ?? ""); q += 2) g.push(q + 2);
      return g.find((q) => sezione(w[q]) && w[q].includes('"')) ?? g.find((q) => sezione(w[q]));
    };
    for (let k = 0; k < w.length; k++) {
      if (w[k] !== "M" && w[k] !== "F") continue;
      // misura dopo: "F 1/2" X 16" (anche "F 1 1/4"")
      const dopo = /^\d{1,2}$/.test(w[k + 1] ?? "") && /^\d\/\d{1,2}"$/.test(w[k + 2] ?? "") ? k + 2 : k + 1;
      let dove = misura(w[dopo] ?? "") ? scegli(dopo) : undefined;
      // misura prima: "3/4" X 22 F"
      if (dove === undefined && misura(w[k - 1] ?? "")) {
        let q = k - 1;
        while (q - 2 >= 0 && w[q - 1] === "X" && misura(w[q - 2])) q -= 2;
        dove = scegli(q);
      }
      if (dove === undefined) continue;
      w[dove] += w[k]; w.splice(k, 1); k--;
    }
    return w.join(" ");
  } },
  // Raccordi: il materiale (OTTONE GIALLO, BRONZO, RAME…) sempre subito dopo le misure, come nella maggior parte del catalogo
  // (RACCORDO BRONZO F 1/2" X 16 SALDARE → RACCORDO F 1/2" X 16 BRONZO SALDARE). "PER RAME" resta dov'è.
  { r: "materiale", f: (d) => {
    const m = d.match(/^([A-Z0-9 .&'-]{1,15}? - )?(.*)$/)!;
    const marca = m[1] ?? "", w = m[2].split(" ");
    if (!RACCORDI.has(w[0])) return d;
    // gli angoli (90°) non contano: le misure sono le sezioni
    const misura = (t: string) => /^(?:Ø|\d)/.test(t) && !/°/.test(t) && !/^\d{4,}/.test(t);
    const primo = w.findIndex(misura);
    if (primo < 0) return d;
    const tolti: string[] = [];
    const via = new Set<number>();
    for (let k = 1; k < primo; k++) {
      const t = w[k], prima = w[k - 1] ?? "";
      if (!(MATERIALI_RACC.has(t) || (/^(GIALLO|NERO)$/.test(t) && MATERIALI_RACC.has(prima)))) continue;
      if (via.has(k - 1)) { via.add(k); continue; }                         // OTTONE GIALLO, ACCIAIO ZINCATO: insieme
      if (/^(PER|X|DI|TUBO)$|PATINA$|EFFETTO$/.test(prima)) continue;        // "PER RAME", "TUBO RAME", "PATINA RAME": restano
      if (prima === "IN" && k - 1 > 0) via.add(k - 1);                      // "IN OTTONE" si sposta tutto
      via.add(k);
    }
    for (const k of [...via].sort((a, b) => a - b)) tolti.push(w[k]);
    const resto = w.filter((_, k) => !via.has(k));
    if (!tolti.length) return d;
    // fine delle misure: misure, X tra misure, sigle M/F e unità
    let fine = resto.findIndex(misura);
    while (fine + 1 < resto.length && (misura(resto[fine + 1]) || (resto[fine + 1] === "X" && misura(resto[fine + 2] ?? "")) || /^(MF|FM|FF|MM|FFF|MMM|M|F|M\/F|F\/M|F\/F|M\/M)$/.test(resto[fine + 1]))) fine++;
    resto.splice(fine + 1, 0, ...tolti);
    return marca + resto.join(" ");
  } },
  { r: "unita", f: (d) => d
    .replace(/(\d)\s?MM[²2](?![\d])/g, "$1mm²").replace(/(\d)MM(?=[MF]?\b)/g, "$1mm").replace(/(\d)\s?CM\b/g, "$1cm").replace(/(\d)CM(?=\s|$)/g, "$1cm")
    .replace(/(\d)\s?KW\b/g, "$1kW").replace(/(\d)\s?KVA\b/g, "$1kVA").replace(/(\d)\s?KV\b/g, "$1kV")
    .replace(/(\d)\s?VCA\b/g, "$1Vca").replace(/(\d)\s?VCC\b/g, "$1Vcc").replace(/(\d)\s?VAC\b/g, "$1Vac").replace(/(\d)\s?VDC\b/g, "$1Vdc")
    .replace(/(\d)\s?KA\b/g, "$1kA").replace(/(\d)\s?MA\b/g, "$1mA").replace(/(\d)\s?LM\b/g, "$1lm").replace(/(\d)\s?MHZ\b/g, "$1MHz").replace(/(\d)\s?HZ\b/g, "$1Hz")
    .replace(/(\d)\s?ML\b/g, "$1ml").replace(/(\d)\s?AH\b/g, "$1Ah").replace(/(\d)\s?KG\b/g, "$1kg").replace(/M³\/H\b/g, "m³/h").replace(/(\d)W\/M\b/g, "$1W/m") },
  { r: "finale", f: (d) => d.replace(/[\s.;,-]+$/, "") },
  { r: "spazi", f: (d) => d.replace(/\s+/g, " ").trim() },
];

/** Descrizione riordinata e regole che l'hanno cambiata */
export function riordinaDescrizione(d: string): { nuova: string; regole: Regola[] } {
  let x = d; const regole = new Set<Regola>();
  // si ripete finché non cambia più nulla (una regola può preparare il lavoro a un'altra), così riordinare due volte dà lo stesso risultato
  for (let giro = 0; giro < 3; giro++) {
    const inizio = x;
    for (const p of passi) { const y = p.f(x); if (y !== x) regole.add(p.r); x = y; }
    if (x === inizio) break;
  }
  return { nuova: x, regole: [...regole] };
}
