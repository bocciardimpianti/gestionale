// Testo per cercare la foto di un materiale: nelle descrizioni idrauliche "M" e "F" sono maschio e femmina
// (es. 'TAPPO F 1/2"', 'RACCORDO 3/4"M X 1/2"F', 'VALVOLA SFERA F/F', 'PROLUNGA MF Ø80').
// Una M dopo un numero semplice resta com'è: "25 M" sono metri.

const parola = (c: string) => (c.toUpperCase() === "M" ? "maschio" : "femmina");

export function maschioFemmina(testo: string) {
  return testo
    // Coppie: MF, FM, MM, FF, M/F, F-M… come parola a sé
    .replace(/(^|[\s(,;])([MF])\s?[/-]?\s?([MF])(?=$|[\s),;.])/gi, (_, prima, a, b) => `${prima}${parola(a)} ${parola(b)}`)
    // Subito dopo una misura in pollici: 1/2"M, 3/4" F, 1''F
    .replace(/(["”]|'')\s?([MF])(?:\s?[/-]?\s?([MF]))?(?![A-Za-z0-9])/gi, (_, pollici, c, d) => `${pollici} ${parola(c)}${d ? " " + parola(d) : ""}`)
    // Dopo una frazione senza virgolette: "1/2 M", "3/4F", "3/4M/F"
    .replace(/(\d\/\d+)\s?([MF])(?:\s?[/-]?\s?([MF]))?(?![A-Za-z0-9])/gi, (_, misura, c, d) => `${misura} ${parola(c)}${d ? " " + parola(d) : ""}`)
    // Lettera da sola non preceduta da un numero (che potrebbe essere una quantità in metri): "TAPPO F 1/2"
    .replace(/(^|[^\w"”'/.,])([MF])(?=$|[\s),;])/g, (tutto, prima, c, pos, intero: string) => {
      const prec = intero.slice(0, pos + prima.length).trimEnd();
      return /\d$/.test(prec) ? tutto : `${prima}${parola(c)}`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

// Ricerche aggiuntive per tipo di materiale: le foto devono somigliare a quello che compriamo davvero.
// Raccordi multistrato: i nostri hanno l'inserto (anello) blu o giallo → si cerca con tutti e due i colori.
const RACCORDO = /raccord|gomito|curva|manicott|\btee?\b|\bti\b|giunt|riduz|terminal|attacc|bocchettone|a pressare|press-?fitting/i;
const REGOLE: { se: (t: string) => boolean; varianti: string[]; preferisci: RegExp }[] = [
  {
    se: (t) => /multistrat|pexal|mixal|alpex|\bpe-?x\b|\bpress/i.test(t) && RACCORDO.test(t) && !/^\s*tubo\b/i.test(t),
    varianti: ["multistrato inserto blu", "multistrato inserto giallo"],
    preferisci: /\b(blu|blue|azzurr\w*|giall\w*|yellow)\b/i,
  },
];

/** Testi da cercare (uno o più) e parole che, se nel titolo della foto, la fanno salire in cima */
export function ricercheFoto(testo: string): { testi: string[]; preferisci: RegExp | null; nota: string } {
  const r = REGOLE.find((x) => x.se(testo));
  if (!r) return { testi: [testo], preferisci: null, nota: "" };
  // Senza ripetere "multistrato" se c'è già nella descrizione
  const testi = r.varianti.map((v) => `${testo} ${/multistrat/i.test(testo) ? v.replace(/^multistrato\s+/i, "") : v}`);
  return { testi, preferisci: r.preferisci, nota: r.varianti.map((v) => v.replace(/^multistrato\s+/i, "")).join(" + ") };
}
