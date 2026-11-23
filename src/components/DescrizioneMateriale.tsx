// Descrizione di un materiale "colorata" per leggerla al volo:
//  - MARCA in grassetto, ognuna col suo colore (FUSIO verde, HAG celeste, STO/Storm blu scuro…; le altre un colore fisso preso dal nome)
//  - sezioni in pollici (1/2"FF, 1 1/4") in blu, in millimetri (Ø20, 16X2, 20mm, 2,5mm²) in rosso, corrente (16A, 230V, 1000W, 50Hz) in giallo ocra, altri numeri (4P, 90°) in grassetto
//  - tipo di pezzo (TEE, GOMITO, CURVA, VALVOLA…) in grassetto

// Colori delle marche presi dai loro loghi (sigle come nel catalogo); i gialli e i celesti un po' più scuri per leggerli sul bianco
export const COLORI_MARCA: Record<string, string> = {
  FUSIO: "#2e9a3c",   // Aquatechnik fusio-technik: verde
  HAG: "#00a7d1",     // Hager: turchese
  STO: "#1b2f80",     // Storm: blu scuro
  VALS: "#0096d6",    // Valsir: azzurro
  GEW: "#e37a00",     // Gewiss: arancio
  GIAC: "#d71920",    // Giacomini: rosso
  CAL: "#e30613",     // Caleffi: rosso
  GEB: "#0a5aa0",     // Geberit: blu
  VIEGA: "#c9a000",   // Viega: giallo
  SCHN: "#009530",    // Schneider Electric: verde
  BTI: "#333333",     // BTicino: nero
  VIM: "#3c4a56",     // Vimar: grigio scuro
  GF: "#c8102e",      // General Fittings: rosso
  MITSU: "#e60012",   // Mitsubishi Electric: rosso
  ABB: "#e4002b",     // ABB: rosso
  PHIL: "#0b5ed7",    // Philips: blu
  FISCH: "#d50c2f",   // fischer: rosso
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
  "BOCCHETTONI", "RACCORDI", "GOMITI", "MANICOTTI", "TAPPI", "CURVE", "VALVOLE", "RELE", "TERMOSTATO", "CRONOTERMOSTATO", "POMPA", "CIRCOLATORE", "FILTRO", "DEFANGATORE", "VASO", "CASSETTA", "TASSELLO", "COLLARE", "STAFFA"]);

type Tipo = "" | "marca" | "pollici" | "mm" | "corrente" | "misura" | "tipo";
type Pezzo = { t: string; k: Tipo };

// Una misura: comincia con una cifra o con Ø
const MISURA = /^(?:Ø|\d)/;
const SIGLE_MF = /^(M\/F|F\/M|F\/F|M\/M|MF|FM|FF|MM|FFF|MMM)$/;
// Sezione in pollici (1/2"FF, 1 1/4", 2"), in millimetri (Ø20, 16X2, 20mm, 2,5mm²) o altro numero (16A, 4P, 1MT, 230V)
function tipoMisura(t: string): Tipo {
  if (t.includes('"') || /\d'/.test(t)) return "pollici";
  if (/Ø|mm|MM(?![A-Z])/.test(t) || /^\d+(?:[.,]\d+)?X\d/.test(t)) return "mm";
  // corrente: ampere, volt, watt, hertz, amperora (16A, 4,5kA, 30mA, 230V, 12Vcc, 1000W, 3kW, 50Hz, 7Ah, 400VA)
  if (/^\d+(?:[.,]\d+)?(?:[\/-]\d+(?:[.,]\d+)?)?(?:k|K|m)?(?:A|V|W|VA|Vca|Vcc|Vac|Vdc|VCA|VCC|Hz|HZ|Ah|AH|Wh|WH|kWh)\.?$/.test(t)) return "corrente";
  return "misura";
}
// Una parola con pollici e millimetri insieme (Ø20X1/2"FX20) si divide sulle X
function dividi(w: string): Pezzo[] {
  if (!(w.includes('"') && /Ø|mm/.test(w))) return [{ t: w, k: tipoMisura(w) }];
  return w.split(/(X)(?=[\dØ])/).reduce<Pezzo[]>((a, x) => {
    if (x === "X") a.push({ t: x, k: a[a.length - 1]?.k ?? "misura" });
    else a.push({ t: x, k: /^\d+$/.test(x) && a.length ? (a.find((p) => p.k === "mm") ? "mm" : "misura") : tipoMisura(x) });
    return a;
  }, []);
}

export function pezziDescrizione(descrizione: unknown): Pezzo[] {
  const d = String(descrizione ?? "");
  const out: Pezzo[] = [];
  let resto = d;
  const marca = d.match(/^([A-Za-z0-9 .&'-]{1,15}?)(\s+[-–]\s+)/);
  if (marca) {
    out.push({ t: marca[1], k: "marca" }, { t: marca[2], k: "" });
    resto = d.slice(marca[0].length);
  }
  const misura = (k: Tipo) => k === "pollici" || k === "mm" || k === "corrente" || k === "misura";
  const aggiungi = (p: Pezzo) => {
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.k === p.k) ultimo.t += p.t; else out.push(p);
  };
  const parole = resto.split(/(\s+)/);
  let catena: Tipo = "";
  for (let i = 0; i < parole.length; i++) {
    const w = parole[i];
    {
      const u = w.toUpperCase();
      if (MISURA.test(w)) { if (!catena) catena = dividi(w)[0].k; }
      else if (!/^\s*$/.test(w) && u !== "X" && !SIGLE_MF.test(u)) catena = "";
    }
    const pulita = w.replace(/[.,;:()]+$/, "").toUpperCase();
    const prima = [...out].reverse().find((p) => p.t.trim())?.k ?? "";
    const dopo2 = (parole[i + 2] ?? "").toUpperCase();
    if (w === "Ø") aggiungi({ t: w, k: "mm" });
    else if (MISURA.test(w)) {
      // "1 1/4"": l'intero davanti alla frazione è in pollici
      if (/^\d{1,2}$/.test(w) && /^\d\/\d+"/.test(parole[i + 2] ?? "")) aggiungi({ t: w, k: "pollici" });
      // numero semplice: in mm se scritto "Ø 75", "75 MM" o dopo una X in una misura che comincia in mm (Ø20 X 1/2" X 20)
      else if (/^\d+(?:[.,]\d+)?$/.test(w) && (prima === "mm" && /^\s*$/.test(out[out.length - 1]?.t.slice(-1) ?? "") && out[out.length - 1]?.t.trim() === "Ø"
        || /^MM\.?$/.test(dopo2) || (parole[i - 2] ?? "").toUpperCase() === "X" && catena === "mm")) aggiungi({ t: w, k: "mm" });
      else dividi(w).forEach(aggiungi);
    }
    // MM dopo un numero in mm: è l'unità, non maschio-maschio
    else if (/^MM\.?$/.test(pulita) && prima === "mm" && /^\d/.test(parole[i - 2] ?? "")) aggiungi({ t: w, k: "mm" }); else if (pulita === "X" && MISURA.test(parole[i - 2] ?? "") && MISURA.test(parole[i + 2] ?? "") && misura(prima)) aggiungi({ t: w, k: prima });
    // maschio/femmina scritti a parte (M/F, FF…): con la misura vicina
    else if (SIGLE_MF.test(pulita)) aggiungi({ t: w, k: misura(prima) ? prima : MISURA.test(parole[i + 2] ?? "") ? dividi(parole[i + 2])[0].k : "misura" });
    // tipo di pezzo, solo se scritto in maiuscolo ("Curva C" di un magnetotermico no)
    else if (TIPI.has(pulita) && w === w.toUpperCase()) aggiungi({ t: w, k: "tipo" });
    // spazio tra due pezzi della stessa misura: va insieme
    else if (/^\s+$/.test(w)) {
      const ultimo = out[out.length - 1];
      const dopo = parole[i + 1] ?? "";
      const kDopo = MISURA.test(dopo) ? dividi(dopo)[0].k : SIGLE_MF.test(dopo.toUpperCase()) || dopo.toUpperCase() === "X" ? ultimo?.k : "";
      if (ultimo && misura(ultimo.k) && kDopo === ultimo.k) ultimo.t += w; else aggiungi({ t: w, k: "" });
    } else aggiungi({ t: w, k: "" });
  }
  return out.filter((p) => p.t);
}

export default function DescrizioneMateriale({ testo }: { testo: unknown }) {
  const pezzi = pezziDescrizione(testo);
  return (
    <span className="descr-materiale">
      {pezzi.map((p, i) => p.k === "marca" ? <b key={i} className="dm-marca" style={{ color: coloreMarca(p.t) }}>{p.t}</b>
        : p.k === "pollici" ? <b key={i} className="dm-pollici">{p.t}</b>
        : p.k === "mm" ? <b key={i} className="dm-mm">{p.t}</b>
        : p.k === "corrente" ? <b key={i} className="dm-corrente">{p.t}</b>
        : p.k === "misura" ? <b key={i} className="dm-misura">{p.t}</b>
        : p.k === "tipo" ? <b key={i} className="dm-tipo">{p.t}</b>
        : p.t)}
    </span>
  );
}
