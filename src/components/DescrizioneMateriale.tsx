// Descrizione di un materiale "colorata" per leggerla al volo:
//  - MARCA in grassetto, ognuna col suo colore (FUSIO verde, HAG celeste, STO/Storm blu scuro…; le altre un colore fisso preso dal nome)
//  - misure (1/2"FF, Ø20, 16X2, 90°, 2,5mm², 32A…) in grassetto blu
//  - tipo di pezzo (TEE, GOMITO, CURVA, VALVOLA…) in grassetto

// Colori scelti per le marche (sigle come nel catalogo)
export const COLORI_MARCA: Record<string, string> = {
  FUSIO: "#1a8a3a", HAG: "#1aa3d9", STO: "#1b2f80", BTI: "#0a7d8c", VIM: "#e0701a", VALS: "#c0392b", GEB: "#2f6fa8",
  VIEGA: "#b88a00", PLAS: "#7a4fc4", GF: "#c2185b", GEW: "#00897b", BEG: "#6d4c41", SCHN: "#2e9e3e", TIRI: "#8e44ad",
  GIAC: "#d35400", CAL: "#b71c1c", IRSAP: "#5d6d7e", FISCH: "#d4a017", NICE: "#0277bd", MITSU: "#c62828", ABB: "#e53935",
  FAAC: "#f39c12", FRABO: "#a0522d", AVE: "#455a64", PHIL: "#1565c0",
};
// Altre marche: un colore fisso ricavato dal nome
const TAVOLOZZA = ["#2a78d6", "#d9622b", "#1b9e6e", "#b8860b", "#d6457e", "#2e7d32", "#6250d6", "#d63838", "#0f7f8a", "#8a5a00", "#7b1fa2", "#00838f"];
export function coloreMarca(marca: string) {
  const m = marca.toUpperCase();
  if (COLORI_MARCA[m]) return COLORI_MARCA[m];
  let h = 0;
  for (const c of m) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TAVOLOZZA[h % TAVOLOZZA.length];
}

// Tipi di pezzo messi in evidenza
const TIPI = new Set(["TEE", "GOMITO", "CURVA", "MANICOTTO", "RIDUZIONE", "NIPLES", "TAPPO", "CALOTTA", "BOCCHETTONE", "BARILOTTO", "CROCE", "PORTAGOMMA",
  "PROLUNGA", "ADATTATORE", "GIUNTO", "RACCORDO", "TRONCHETTO", "CANOTTO", "BRAGA", "TERMINALE", "VALVOLA", "RUBINETTO", "TUBO", "CAVO", "FLESSIBILE",
  "MISCELATORE", "COLLETTORE", "INTERRUTTORE", "MAGNETOTERMICO", "DIFFERENZIALE", "PRESA", "PLACCA", "SCATOLA", "CANALINA", "CORRUGATO", "GUAINA",
  "CALDAIA", "RADIATORE", "SIFONE", "PILETTA", "LAMPADA", "PLAFONIERA", "FARETTO", "STRISCIA", "ALIMENTATORE", "TELECAMERA", "CENTRALINO", "QUADRO",
  "RELE", "TERMOSTATO", "CRONOTERMOSTATO", "POMPA", "CIRCOLATORE", "FILTRO", "DEFANGATORE", "VASO", "CASSETTA", "TASSELLO", "COLLARE", "STAFFA"]);

type Pezzo = { t: string; k: "" | "marca" | "misura" | "tipo" };

// Una misura: comincia con una cifra, con Ø, con una frazione (1/2") o è la X tra due misure
const MISURA = /^(?:Ø|\d)/;
export function pezziDescrizione(descrizione: unknown): Pezzo[] {
  const d = String(descrizione ?? "");
  const out: Pezzo[] = [];
  let resto = d;
  const marca = d.match(/^([A-Za-z0-9 .&'-]{1,15}?)(\s+[-–]\s+)/);
  if (marca) {
    out.push({ t: marca[1], k: "marca" }, { t: marca[2], k: "" });
    resto = d.slice(marca[0].length);
  }
  const parole = resto.split(/(\s+)/);
  for (let i = 0; i < parole.length; i++) {
    const w = parole[i];
    const pulita = w.replace(/[.,;:()]+$/, "").toUpperCase();
    let k: Pezzo["k"] = "";
    if (MISURA.test(w)) k = "misura";
    // "X" tra due misure (3/4" X 1/2")
    else if (pulita === "X" && MISURA.test(parole[i - 2] ?? "") && MISURA.test(parole[i + 2] ?? "")) k = "misura";
    // maschio/femmina scritti a parte (M/F, FF…): con le misure
    else if (/^(M\/F|F\/M|F\/F|M\/M|MF|FM|FF|MM|FFF|MMM)$/.test(pulita)) k = "misura";
    // tipo di pezzo, solo se scritto in maiuscolo ("Curva C" di un magnetotermico no)
    else if (TIPI.has(pulita) && w === w.toUpperCase()) k = "tipo";
    // spazio tra due pezzi uguali: va insieme (es. "1 1/4"")
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.k === k) ultimo.t += w;
    else if (/^\s+$/.test(w) && ultimo && ultimo.k === "misura" && MISURA.test(parole[i + 1] ?? "")) ultimo.t += w;
    else out.push({ t: w, k });
  }
  return out.filter((p) => p.t);
}

export default function DescrizioneMateriale({ testo }: { testo: unknown }) {
  const pezzi = pezziDescrizione(testo);
  return (
    <span className="descr-materiale">
      {pezzi.map((p, i) => p.k === "marca" ? <b key={i} className="dm-marca" style={{ color: coloreMarca(p.t) }}>{p.t}</b>
        : p.k === "misura" ? <b key={i} className="dm-misura">{p.t}</b>
        : p.k === "tipo" ? <b key={i} className="dm-tipo">{p.t}</b>
        : p.t)}
    </span>
  );
}
