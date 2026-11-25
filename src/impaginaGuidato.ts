import { centralinoQuadro, NOMI_TIPO, totaleAmbiente, type Foglio, type TariffaFoglio } from "./impianti";
import type { PreventivoImpaginato } from "./stampe";

// Preventivo guidato → testo del preventivo impaginato: per ogni stanza l'elenco di quello che si installa
// (interruttori, prese, pulsanti, punti luce…, senza prezzi), il quadro con il centralino; niente copriforo,
// supporti, placche e manodopera (sono compresi nel totale). In fondo il totale + IVA.
// Le soluzioni alternative del foglio (configurazione.alternative) diventano altre soluzioni, ognuna sul suo foglio.

export const NOTA_PREVENTIVO = "* I preventivi hanno validità di 30 giorni dalla data del documento.";
const ESCLUSE = /manodopera|copriforo|supporto|supporti|montatur|placc[ae]|tappo|scatol/i;

/** Soluzione alternativa del foglio guidato: nome (titolo nel preventivo impaginato) e foglio con le sue stanze */
export type Alternativa = { nome: string; foglio: Foglio };
/** Configurazione salvata nel preventivo: la prima soluzione è il foglio stesso, le altre in "alternative" */
export type Configurazione = Foglio & { nome_soluzione?: string; alternative?: Alternativa[] };

const r2 = (x: number) => Math.round(x * 100) / 100;
export const tariffaFoglio = (f: Foglio): TariffaFoglio => ({ nome: f.tariffa_nome ?? "Manodopera", prezzo: f.tariffa_oraria ?? 0 });
/** Totali di un foglio (come nel riepilogo del foglio guidato) */
export function totaliFoglio(f: Foglio, sconto: number, iva: number) {
  const imponibile = r2(f.ambienti.reduce((t, a) => t + totaleAmbiente(a, f.serie, tariffaFoglio(f)), 0));
  const scontoTotale = r2(imponibile * (sconto || 0) / 100);
  const scontato = r2(imponibile - scontoTotale);
  const ivaTotale = r2(scontato * (iva || 0) / 100);
  return { imponibile, sconto_totale: scontoTotale, prezzo_scontato: scontato, iva_totale: ivaTotale, totale: r2(scontato + ivaTotale) };
}

const quanti = (q: number, unita: string) => {
  const t = Number.isInteger(q) ? String(q) : q.toLocaleString("it-IT");
  return /^(m|mt|ml|metri?)$/i.test(unita.trim()) ? `${t} m di` : `n. ${t}`;
};

function testoFoglio(f: Foglio) {
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
  return parti.join("\n\n");
}

/** Testo impaginato di tutte le soluzioni del preventivo guidato (totale di ognuna, già scontato, + IVA) */
export function impaginatoDaConfigurazione(conf: Configurazione, oggetto: string, sconto: number): PreventivoImpaginato {
  const { alternative = [], nome_soluzione, ...principale } = conf;
  const tutte: Alternativa[] = [{ nome: nome_soluzione || oggetto, foglio: principale }, ...alternative];
  return {
    soluzioni: tutte.map((s, i) => ({
      titolo: s.nome.trim() || oggetto.trim() || NOMI_TIPO[s.foglio.tipo],
      testo: testoFoglio(s.foglio),
      totale: totaliFoglio(s.foglio, sconto, 0).prezzo_scontato || null,
      nuovaPagina: i > 0,
    })),
    nota: NOTA_PREVENTIVO,
  };
}
