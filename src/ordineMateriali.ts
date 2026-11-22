// Ordine "naturale" degli articoli: prima lo stesso tipo di articolo insieme (es. GF - GOMITO CROMATO), poi dalla misura
// più piccola alla più grande (1/4" → 3/8" → 1/2" → 3/4" → 1"…; Ø14 → Ø16…; 1,5mm² → 2,5mm²…), a parità di misura
// prima MF poi FM, FF, MM. I pollici si confrontano con i millimetri (1/2" = 12,7mm).

const FRAZ = String.raw`(?:[1357]\/8|[13]\/4|1\/2)`;
// pollici (con o senza intero davanti: 1 1/4, 1.1/4, 1"1/4) oppure numeri
const MISURA = new RegExp(String.raw`(?<![\d\/.,])(?:(\d{1,2})(?:[ .]|"\s?))?(${FRAZ})(?![\d\/])"?|(?<![\d\/])(\d+(?:[.,]\d+)?)("?)`, "g");
const RANGO_MF: [RegExp, number][] = [
  [/(?:^|[\s"\d])(?:M\/F|M-F|MF)(?![A-Z])|"M X [^ ]+"F/, 0],
  [/(?:^|[\s"\d])(?:F\/M|F-M|FM)(?![A-Z])|"F X [^ ]+"M/, 1],
  [/(?:^|[\s"\d])(?:F\/F|F-F|FF)(?![A-Z])|"F X [^ ]+"F/, 2],
  [/(?:^|[\s"\d])(?:M\/M|M-M|MM)(?![A-Z0-9.²])|"M X [^ ]+"M/, 3],
];
// I colori non dividono i gruppi: prima la misura, poi il colore (cavo 1,5mm² di tutti i colori, poi 2,5mm²…)
const COLORE = /^(BIANC[OAIE]|NER[OAIE]|BLU|ROSS[OAIE]|GRIGI[OA]|GRIGIE|MARRONE|CELESTE|ARANCIONE|GIALL[OAIE]|VERD[EI]|GIALLO\/VERDE|ANTRACITE|SCURO|CHIARO|VIOLA|ROSA|BEIGE|AVORIO|SABBIA|TRASPARENTE)$/;
const UNITA = new Set(["X", "MM", "MT", "CM", "ML", "M", "F", "MF", "FM", "FF", "M/F", "F/M", "F/F", "M/M", "M-F", "F-M", "F-F", "M-M", "LT", "KW", "W", "V", "A", "MA", "KA", "VCA", "VCC", "MQ", "PZ", "PZ.", "N", "NR"]);

/** Chiave per ordinare le descrizioni dei materiali in modo naturale */
export function chiaveOrdineMateriale(descrizione: unknown): string {
  const d = String(descrizione ?? "").toUpperCase().replace(/[”“″]|''/g, '"').replace(/\s+/g, " ").trim();
  const numeri: number[] = [];
  for (const m of d.matchAll(MISURA)) {
    if (m[2]) {
      const [a, b] = m[2].split("/").map(Number);
      numeri.push((Number(m[1] ?? 0) + a / b) * 25.4);
    } else if (m[3]) {
      const n = Number(m[3].replace(",", "."));
      numeri.push(m[4] ? n * 25.4 : n);
    }
  }
  // Tipo di articolo: le parole senza misure, unità e sigle M/F
  const parole = d.replace(MISURA, " ").replace(/[^A-Z0-9À-Ü\/\- ]+/g, " ").split(" ")
    .filter((w) => w && !UNITA.has(w) && !/^[\d\/]+$/.test(w));
  const base = parole.filter((w) => !COLORE.test(w)).join(" ");
  const colore = parole.filter((w) => COLORE.test(w)).join(" ");
  const rango = RANGO_MF.find(([re]) => re.test(d))?.[1] ?? -1;
  const num = numeri.slice(0, 4).map((n) => String(Math.round(n * 100)).padStart(9, "0")).join(".");
  return `${base}\u0001${num}\u0001${rango + 1}\u0001${colore}\u0001${d}`;
}

/** Confronto tra due descrizioni di materiali (per sort) */
export const confrontaMateriali = (a: unknown, b: unknown) => {
  const x = chiaveOrdineMateriale(a), y = chiaveOrdineMateriale(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
