// Ricerca "furba" dei materiali:
// - singolare/plurale e desinenze ("gomiti" trova "gomito", "bianchi" trova "bianco")
// - sinonimi del mestiere ("gomito" trova anche "curva"), modificabili in Archivi → Sinonimi ricerca
// - errori di battitura: se non si trova niente, si cercano le parole più simili ("gommito" → "gomito")
import { useEffect, useState } from "react";
import { pulisciRicerca } from "./testo";
import { supabase } from "./supabase";

// Sinonimi di partenza: ogni riga è un gruppo di parole (o brevi frasi) equivalenti, separate da virgola.
// Restano validi anche se l'elenco sul database non è ancora stato creato.
export const SINONIMI_BASE = [
  "gomito, curva",
  "manicotto, giunto, giunzione",
  "niples, nipplo, nipple",
  "riduzione, ridotto, riduttore",
  "flessibile, flex",
  "rubinetto, valvola",
  "saracinesca, valvola a saracinesca",
  "braga, diramazione",
  "tee, raccordo a t",
  "tassello, fischer, fisch, ancorante",
  "differenziale, salvavita",
  "magnetotermico, automatico",
  "schuko, tedesca",
  "placca, mostrina",
  "scatola, cassetta",
  "corrugato, guaina",
  "canalina, canaletta, canale",
  "fascetta, stringicavo",
  "lampada, lampadina",
  "plafoniera, plafone",
  "faretto, spot",
  "termostato, cronotermostato",
  "scaldabagno, boiler, scaldacqua",
  "radiatore, termosifone, calorifero",
  "miscelatore, monocomando",
  "vaso, wc, water, tazza",
  "lavabo, lavandino",
  "lavello, acquaio",
  "guarnizione, oring, o-ring",
  "canapa, stoppa",
  "teflon, ptfe",
  "cavo, cordina",
  "capocorda, puntale",
  "morsetto, morsettiera, wago",
  "contattore, teleruttore",
  "rele, relais",
  "quadro, centralino",
  "zincato, galvanizzato",
  "pompa, circolatore",
  "alimentatore, trasformatore",
  "condizionatore, climatizzatore, split",
  "prolunga, ciabatta, multipresa",
  "sensore, rilevatore",
  "silicone, sigillante",
  "fumaria, fumi",
];

// Minuscole, senza accenti
export const normalizza = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Radice della parola: toglie la vocale finale (gomito/gomiti → gomit) e sistema -chi/-ghi (bianchi → bianc)
export const radice = (w: string) => {
  if (w.length < 4 || /\d/.test(w)) return w;
  let r = w.replace(/[aeiou]$/, "");
  if (/[cg]h$/.test(r)) r = r.slice(0, -1);
  return r;
};

type Forma = string[]; // una o più radici che devono esserci tutte (sinonimo di più parole)

// Gruppi di sinonimi → per ogni radice, le forme equivalenti
export function preparaSinonimi(gruppi: string[]) {
  const mappa = new Map<string, Forma[]>();
  for (const g of gruppi) {
    const voci = g.split(",").map((v) => normalizza(v).split(/[^a-z0-9]+/).filter(Boolean).map(radice)).filter((v) => v.length);
    for (const v of voci) if (v.length === 1) mappa.set(v[0], [...(mappa.get(v[0]) ?? []), ...voci.filter((x) => x.join(" ") !== v[0])]);
  }
  return mappa;
}

// Distanza fra due parole (lettere sbagliate, mancanti, in più o scambiate)
function distanza(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let minRiga = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      minRiga = Math.min(minRiga, d[i][j]);
    }
    if (minRiga > max) return max + 1;
  }
  return d[a.length][b.length];
}

export type Ricerca = {
  /** Il testo (già normalizzato) contiene tutte le parole cercate, o loro equivalenti */
  corrisponde: (testoNormalizzato: string) => boolean;
  parole: string[];
};

/** Ricerca con radici e sinonimi. "sostituti" (dalla correzione degli errori) aggiunge forme per singole parole. */
export function creaRicerca(testo: string, sinonimi: Map<string, Forma[]>, sostituti: Map<string, string[]> = new Map()): Ricerca {
  const parole = normalizza(pulisciRicerca(testo)).split(/\s+/).filter(Boolean);
  const formePerParola = parole.map((p) => {
    const r = radice(p);
    const forme: Forma[] = [[r]];
    for (const f of sinonimi.get(r) ?? []) forme.push(f);
    for (const s of sostituti.get(p) ?? []) forme.push([s]);
    return forme;
  });
  return {
    parole,
    corrisponde: (t) => formePerParola.every((forme) => forme.some((f) => f.every((x) => t.includes(x)))),
  };
}

/** Parole dei testi con quante volte compaiono (per correggere gli errori di battitura) */
export const vocabolario = (testi: string[]) => {
  const v = new Map<string, number>();
  for (const t of testi) for (const w of new Set(t.split(/[^a-z0-9]+/))) if (w.length >= 4 && !/\d/.test(w)) v.set(w, (v.get(w) ?? 0) + 1);
  return v;
};

/** Per ogni parola cercata che sembra scritta male, le parole del magazzino più simili */
export function correggi(parole: string[], voc: Map<string, number>) {
  const sostituti = new Map<string, string[]>();
  for (const p of parole) {
    if (p.length < 4 || /\d/.test(p)) continue;
    const max = p.length <= 5 ? 1 : 2;
    const vicine: [string, number, number][] = [];
    for (const [w, volte] of voc) {
      if (w === p) continue;
      const d = distanza(p, w, max);
      if (d <= max) vicine.push([w, d, volte]);
    }
    if (!vicine.length) continue;
    const minima = Math.min(...vicine.map((x) => x[1]));
    // Le più vicine, più quelle appena più lontane ma molto usate ("interutore" → interruttore, non solo interrutore)
    const scelte = vicine
      .filter(([, d, volte]) => d === minima || volte >= 10)
      .sort((a, b) => b[2] - a[2])
      .slice(0, 5)
      .map(([w]) => w);
    sostituti.set(p, scelte);
  }
  return sostituti;
}

// Sinonimi dal database (Archivi → Sinonimi ricerca); finché l'elenco non c'è valgono quelli di partenza
let sinonimiInMemoria: Map<string, Forma[]> | null = null;
export function useSinonimi(versione = 0) {
  const [s, setS] = useState(() => sinonimiInMemoria ?? preparaSinonimi(SINONIMI_BASE));
  useEffect(() => {
    supabase.from("sinonimi_ricerca").select("nome").order("ordine").then(({ data, error }) => {
      if (error || !data?.length) return;
      sinonimiInMemoria = preparaSinonimi(data.map((r) => String(r.nome)));
      setS(sinonimiInMemoria);
    });
  }, [versione]);
  return s;
}
