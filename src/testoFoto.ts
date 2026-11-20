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
