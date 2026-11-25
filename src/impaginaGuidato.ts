import { centralinoQuadro, NOMI_TIPO, type Foglio } from "./impianti";
import type { PreventivoImpaginato } from "./stampe";

// Preventivo guidato → testo del preventivo impaginato: per ogni stanza l'elenco di quello che si installa
// (interruttori, prese, pulsanti, punti luce…, senza prezzi), il quadro con il centralino; niente copriforo,
// supporti, placche e manodopera (sono compresi nel totale). In fondo il totale del preventivo + IVA.

export const NOTA_PREVENTIVO = "* I preventivi hanno validità di 30 giorni dalla data del documento.";
const ESCLUSE = /manodopera|copriforo|supporto|supporti|montatur|placc[ae]|tappo|scatol/i;

const quanti = (q: number, unita: string) => {
  const t = Number.isInteger(q) ? String(q) : q.toLocaleString("it-IT");
  return /^(m|mt|ml|metri?)$/i.test(unita.trim()) ? `${t} m di` : `n. ${t}`;
};

export function impaginatoDaFoglio(f: Foglio, oggetto: string, totale: number): PreventivoImpaginato {
  const elettrico = f.tipo === "elettrico";
  const parti: string[] = [
    `Fornitura e posa in opera di ${NOMI_TIPO[f.tipo].toLowerCase()}${elettrico && f.serie?.nome ? ` con frutti e placche della serie ${f.serie.nome}` : ""}, così composto:`,
  ];
  for (const a of f.ambienti) {
    const righe = a.voci.filter((v) => v.quantita > 0 && !ESCLUSE.test(v.nome)).map((v) => `- ${quanti(v.quantita, v.unita ?? "")} ${v.nome}`);
    const c = a.quadro ? centralinoQuadro(a) : null;
    if (c) righe.unshift(`- centralino ${c.tipo === "incasso" ? "da incasso" : "da esterno"} da ${c.moduli} moduli`);
    if (righe.length) parti.push(`${a.nome}:\n${righe.join("\n")}`);
  }
  parti.push(elettrico
    ? "Al termine dei lavori verrà rilasciata regolare dichiarazione di conformità dell'impianto."
    : "Al termine dei lavori verrà rilasciata regolare dichiarazione di conformità.");
  return { soluzioni: [{ titolo: oggetto.trim() || NOMI_TIPO[f.tipo], testo: parti.join("\n\n"), totale: totale || null }], nota: NOTA_PREVENTIVO };
}
