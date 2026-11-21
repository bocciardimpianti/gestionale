// Catalogazione automatica degli impianti dai materiali di un rapportino.
// Per ogni categoria (Clima, Caldaie, Allarmi, Automatismi) si tiene solo quello che conta per l'impianto,
// non tutto il rapportino: es. per una caldaia la caldaia, defangatore, sdoppiatore, dosatore, pompe e valvole,
// canna fumaria (metri e sezione) e tipo di impianto di riscaldamento.
import { eUnitaEsterna, eUnitaInterna, gasDaDescrizione, testoUnitaInterne } from "./clima";
import { marcaMateriale } from "./impianti";

export const CATEGORIE_IMPIANTI = [
  { nome: "Clima", icona: "❄️", colore: "#4dd0e1" },
  { nome: "Caldaie", icona: "🔥", colore: "#ff8a65" },
  { nome: "Allarmi", icona: "🚨", colore: "#e57373" },
  { nome: "Automatismi", icona: "🚧", colore: "#ffca28" },
  { nome: "TVCC", icona: "📹", colore: "#7986cb" },
] as const;

export const TIPI_IMPIANTO_TERMICO = [
  "Radiante a pavimento", "Termosifoni in alluminio", "Termosifoni in acciaio", "Termosifoni in ghisa",
  "Termosifoni misti", "Misto (radiante + termosifoni)", "Ventilconvettori",
];

type Riga = { descrizione?: unknown; quantita?: unknown; unita_misura?: unknown; materiale_id?: unknown };
const d = (r: Riga) => String(r.descrizione ?? "").trim();
const q = (r: Riga) => Number(r.quantita) || 1;
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("it-IT");

/** "2 × DESCRIZIONE; 1 × …" con le quantità sommate */
function elenco(righe: Riga[], si: RegExp, no?: RegExp) {
  const per = new Map<string, number>();
  for (const r of righe) if (si.test(d(r)) && !(no && no.test(d(r)))) per.set(d(r), (per.get(d(r)) ?? 0) + q(r));
  return [...per.entries()].map(([t, n]) => `${fmt(n)} × ${t}`).join("; ");
}

// ---- Caldaie ----
const CALDAIA = /\bcaldai[ae]\b|termocamino a gas|generatore a condensazione/i;
const NON_CALDAIA = /salva ?caldaia|adattator|tronchett|dosator|box incasso|incasso per|copricaldaia|coibentaz|defang|partenza|sdoppiat|staffa|raccord|sotto ?caldaia|pompa|neutraliz|curva|prolunga|copertura|dima|ricambi|kit (scarico|fumi|attacchi|allacc)|scheda|sonda|termostato|cronot|filtro|valvola|rubinett|vaso|tubo|\bper caldai|\bx caldai/i;
const DEFANGATORE = /defangat|filtro magnetic|separatore (di )?fanghi/i;
const SDOPPIATORE = /sdoppiat/i;
const DOSATORE = /polifosf|dosator/i;
const NON_DOSATORE = /ricaric|cartucc|sale\b/i;
const POMPE_VALVOLE = /circolator|pompa (di )?circolaz|elettropompa|gruppo (di )?(miscelaz|rilancio|pompaggio)|valvol\w* .*(miscelat|deviatric|3 ?vie|tre vie)|(miscelatric|deviatric)e?\b.*valvol|valvola a (3|tre) vie|valvola deviatrice|valvola miscelatrice/i;
const NON_POMPE = /condensa|di calore|scarico|sollevamento|sommers|pozzo|autoclave|lavatric|doccia|lavabo|bidet|lavello|termostatic.*(doccia|lavabo)/i;
const FUMI = /canna fum|fumari|scarico fumi|kit fumi|coassial|(curva|prolunga|terminale|rosone|cappellotto|tubo|partenza|raccordo|fascetta|camino|adattatore|elemento)\b.*(ø|d\.?) ?(60|80|100|125)\b/i;
const NON_FUMI = /\btv\b|rg ?\d|cavo|spina|antenn|\bsat\b|connettor|presa|f maschio|pvc|scarico wc|sifone|braga|sdoppiat/i;
const TUBO_FUMI = /prolunga|\btubo\b|canna|elemento|condotto|tubazione|flessibile/i;
const NON_TUBO_FUMI = /curva|gomito|terminal|rosone|cappell|fascett|raccord|riduz|adattator|\btee?\b|staff|collare|guarniz|kit\b|partenza/i;

/** Metri di un pezzo di canna fumaria dalla descrizione (es. "0,5MT", "MM.1000", "L.500") */
function metriFumi(t: string) {
  const n = (v: string) => Number(v.replace(",", "."));
  // Un pezzo di canna fumaria non supera qualche metro: valori più grandi sono misure di altro (es. "Ø80 M/F")
  const ok = (v: number) => (v > 0 && v <= 6 ? v : 0);
  const mt = t.match(/(\d+(?:[.,]\d+)?)\s*(?:mt|mtl|ml|metr\w*)\.?(?![a-z])/i);
  if (mt) return ok(n(mt[1]));
  const mm = t.match(/\bmm\.?\s*(\d{3,4})\b|\b(\d{3,4})\s*mm\b|\bl\.?\s*=?\s*(\d{3,4})\b/i);
  if (mm) return ok(Number(mm[1] ?? mm[2] ?? mm[3]) / 1000);
  // "1M", "0,5 M" (ma non "80 M/F" maschio/femmina)
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*m\b(?!\s*\/)/i);
  if (m) return ok(n(m[1]));
  return 0;
}

function cannaFumaria(righe: Riga[]) {
  const pezzi = righe.filter((r) => FUMI.test(d(r)) && !NON_FUMI.test(d(r)));
  if (!pezzi.length) return null;
  let metri = 0;
  const sezioni = new Map<string, number>();
  for (const r of pezzi) {
    const t = d(r);
    if (TUBO_FUMI.test(t) && !NON_TUBO_FUMI.test(t)) metri += metriFumi(t) * q(r);
    const s = t.match(/(?:ø|d\.?)\s?(\d{2,3})(?:\s?\/\s?(\d{2,3}))?/i);
    if (s) { const k = s[2] ? `Ø ${s[1]}/${s[2]}` : `Ø ${s[1]}`; sezioni.set(k, (sezioni.get(k) ?? 0) + q(r)); }
  }
  const sezione = [...sezioni.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { metri: metri ? Math.round(metri * 100) / 100 : null, sezione: sezione.slice(0, 2).join(" + ") || null, pezzi: elenco(pezzi, /./) };
}

/** Tipo di impianto di riscaldamento dai materiali (radiatori e/o radiante), se si capisce */
function impiantoTermico(righe: Riga[]) {
  const testi = righe.map(d);
  // "radiante" come parola (la marca RADIANT delle caldaie non conta)
  const radiante = testi.some((t) => /\bradiant[ei]\b|riscaldamento a pavimento|pannell\w* isolant\w* .*pavimento/i.test(t));
  const radiatori = testi.filter((t) => /radiator|termoarred|scaldasalviett|\btesi\b|elementi .*h\s?\d{3}/i.test(t) && !/valvol|detentor|testa|kit|riduz|tappo|mensol|staff|sfiat|vernic/i.test(t));
  const materiali = new Set(radiatori.map((t) => (/ghisa/i.test(t) ? "ghisa" : /alluminio|alustorm/i.test(t) ? "alluminio" : /acciaio|tubolar|\btesi\b|irsap/i.test(t) ? "acciaio" : "")).filter(Boolean));
  if (radiante && radiatori.length) return "Misto (radiante + termosifoni)";
  if (radiante) return "Radiante a pavimento";
  if (materiali.size > 1) return "Termosifoni misti";
  if (materiali.size === 1) return `Termosifoni in ${[...materiali][0]}`;
  return null;
}

// ---- Materiali allegati all'impianto (linguetta Materiali): solo quelli che contano per la categoria ----
/** Tubi in rame del climatizzatore (1/4" 3/8" 1/2" 5/8" 7/8"), come per il documento F-gas */
const TUBO_CLIMA = (t: string) =>
  /tubo|rame|rotolo|matass|coibentat|isolat/i.test(t) && /1\/4|3\/8|1\/2|5\/8|7\/8/.test(t)
  && !/raccord|bocchetton|curva|gomito|riduz|cartell|\bdado|manicott|\btee?\b|giunt|valvol|rubinett|flessibil|filtro|tappo|staff|nastro|canalin|isolante tubo|coppella|pinza|cartellatrice|tagliatubi|piegatubi/i.test(t);
const MAT_AUTOMATISMO = /motor|fotocellul|lampeggiant|selettor|cremaglier|radiocomand|telecomand|trasmettitor|ricevent|ricevitor|\bschede?\b|centrale/i;
const MAT_ALLARME = /centrale|sensor|rilevator|volumetric|contatt\w* magnetic|sirena|telecamer/i;
const NON_MAT_ALLARME = /centrale .*(comando|cancell|motor|termic|caldai)/i;
const TVCC = /telecamer|videosorveglian|\btvcc\b|\b[ndx]vr\b|videoregistrator|\bipc\b/i;
const NON_TVCC = /citofon|\bcavo\b|cablaggio|connettor|\bplug\b|staffa|supporto|scatola|\bbox\b/i;
const MAT_TVCC = /telecamer|videosorveglian|\btvcc\b|\b[ndx]vr\b|videoregistrator|\bipc\b|\bdome\b|\bbullet\b|hard ?disk|\bhdd\b|switch.*poe|\bpoe\b.*switch|monitor|balun|alimentator\w* .*(telecam|tvcc|videosorv)/i;

/** Righe da allegare all'impianto (descrizione, quantità, unità di misura, materiale di magazzino) */
const materiali = (righe: Riga[], tiene: (t: string) => boolean) =>
  righe.filter((r) => d(r) && tiene(d(r))).map((r) => ({
    descrizione: d(r), quantita: Number(r.quantita) || 1, unita_misura: r.unita_misura ?? null, materiale_id: r.materiale_id ?? null,
  }));

// ---- Allarmi e automatismi ----
const ALLARME = /centrale.*(allarm|antifurto|antintrusion|ibrida)|(allarm|antifurto|antintrusion)\w*.*centrale|combivox|bentel|\binim\b|ksenia|ajax|paradox|\bantifurto\b|sistema (di )?allarme/i;
const COMPONENTI_ALLARME = /centrale|sensor|rilevator\w* (volumetric|infrarossi|doppia|perimetral)|volumetric|contatt\w* magnetic|sirena|tastiera|inseritore|chiave (elettronica|di prossimit)|combinatore|modulo (gsm|lte|wi-?fi|radio)|espansione|barriera (infrarossi|ir)|ricevitore radio|telecomando .*(allarm|antifurto)|batteria .*12 ?v/i;
const AUTOMATISMO = /motoriduttore|motore .*(cancell|serrand|scorrev|battent|bascul|garage)|automazione|kit .*(cancell|scorrev|battent|bascul|serrand)|operatore .*(cancell|battent|scorrev)|barriera (stradale|automatica)|attuatore .*(cancell|battent)/i;
const COMPONENTI_AUTOMATISMO = /motor|automazione|kit .*(cancell|scorrev|battent|bascul)|fotocellul|lampeggiant|selettore|telecomand|trasmettitor|ricevent|centrale .*(comando|cancell|motor)|cremaglier|elettroserratur|costa (sensibil|meccanic)|scheda .*(cancell|motor)|antenna .*(433|868)/i;

export type ImpiantoRilevato = { categoria: string; dati: Record<string, unknown> };

/** Impianti da catalogare per questo rapportino (uno per categoria trovata) */
export function impiantiDaRapportino(righe: Riga[], rapporto: Record<string, unknown>): ImpiantoRilevato[] {
  const out: ImpiantoRilevato[] = [];
  const anno = String(rapporto.data ?? "").slice(0, 4) || null;

  // Clima: unità esterna (o kit completo) e unità interne
  const esterna = righe.find((r) => eUnitaEsterna(r.descrizione));
  if (esterna) {
    const descr = d(esterna);
    out.push({ categoria: "Clima", dati: {
      tipo_impianto: "Climatizzatore", impianto: righe.some((r) => eUnitaInterna(r.descrizione)) ? "Unità esterna + interne" : "Climatizzatore",
      marca: marcaMateriale(descr), modello: descr, anno,
      unita_interne: testoUnitaInterne(righe) || null,
      tipo_gas: (rapporto.tipo_gas as string) || gasDaDescrizione(descr) || null,
      gas_kg: rapporto.gas_aggiunto_kg ?? null,
      materiali: materiali(righe, (t) => eUnitaEsterna(t) || eUnitaInterna(t) || TUBO_CLIMA(t)),
    } });
  }

  // Caldaie
  const caldaia = righe.find((r) => CALDAIA.test(d(r)) && !NON_CALDAIA.test(d(r)));
  if (caldaia) {
    const canna = cannaFumaria(righe);
    out.push({ categoria: "Caldaie", dati: {
      tipo_impianto: "Caldaia", impianto: "Caldaia", marca: marcaMateriale(d(caldaia)), modello: d(caldaia), anno,
      defangatore: elenco(righe, DEFANGATORE) || null,
      sdoppiatore: elenco(righe, SDOPPIATORE) || null,
      dosatore: elenco(righe, DOSATORE, NON_DOSATORE) || null,
      pompe_valvole: elenco(righe, POMPE_VALVOLE, NON_POMPE) || null,
      canna_fumaria_m: canna?.metri ?? null,
      canna_fumaria_sezione: canna?.sezione ?? null,
      impianto_termico: impiantoTermico(righe),
      materiali: materiali(righe, (t) => (CALDAIA.test(t) && !NON_CALDAIA.test(t)) || DEFANGATORE.test(t) || SDOPPIATORE.test(t)
        || (DOSATORE.test(t) && !NON_DOSATORE.test(t)) || (POMPE_VALVOLE.test(t) && !NON_POMPE.test(t)) || (FUMI.test(t) && !NON_FUMI.test(t))),
    } });
  }

  // Allarmi
  const centrale = righe.find((r) => ALLARME.test(d(r)));
  if (centrale) {
    out.push({ categoria: "Allarmi", dati: {
      tipo_impianto: "Allarme", impianto: "Impianto di allarme", marca: marcaMateriale(d(centrale)), modello: d(centrale), anno,
      componenti: elenco(righe, COMPONENTI_ALLARME) || null,
      materiali: materiali(righe, (t) => MAT_ALLARME.test(t) && !NON_MAT_ALLARME.test(t)),
    } });
  }

  // Automatismi
  const motore = righe.find((r) => AUTOMATISMO.test(d(r)));
  if (motore) {
    out.push({ categoria: "Automatismi", dati: {
      tipo_impianto: "Automatismo", impianto: /scorrev/i.test(d(motore)) ? "Cancello scorrevole" : /battent/i.test(d(motore)) ? "Cancello a battente" : /bascul|garage/i.test(d(motore)) ? "Basculante / garage" : /serrand/i.test(d(motore)) ? "Serranda" : /barriera/i.test(d(motore)) ? "Barriera" : "Automatismo",
      marca: marcaMateriale(d(motore)), modello: d(motore), anno,
      componenti: elenco(righe, COMPONENTI_AUTOMATISMO) || null,
      materiali: materiali(righe, (t) => MAT_AUTOMATISMO.test(t) && !ALLARME.test(t)),
    } });
  }

  // TVCC: solo i sistemi di videosorveglianza (telecamere, videoregistratori, hard disk, switch PoE, monitor)
  const tvcc = righe.filter((r) => TVCC.test(d(r)) && !NON_TVCC.test(d(r)));
  if (tvcc.length) {
    const registratore = tvcc.find((r) => /\b[ndx]vr\b|videoregistrator/i.test(d(r)));
    const principale = registratore ?? tvcc[0];
    const telecamere = righe.filter((r) => /telecamer|\bipc\b|\bdome\b|\bbullet\b/i.test(d(r)) && !/staff|supporto|scatola|box|alimentator/i.test(d(r)))
      .reduce((n, r) => n + q(r), 0);
    out.push({ categoria: "TVCC", dati: {
      tipo_impianto: "Videosorveglianza", impianto: telecamere ? `Videosorveglianza (${fmt(telecamere)} telecamere)` : "Videosorveglianza",
      marca: marcaMateriale(d(principale)), modello: d(principale), anno,
      componenti: elenco(righe, MAT_TVCC) || null,
      materiali: materiali(righe, (t) => MAT_TVCC.test(t)),
    } });
  }
  // Il materiale principale (caldaia, unità esterna, centrale, motore, registratore…) è sempre tra i materiali allegati
  for (const imp of out) {
    const lista = imp.dati.materiali as { descrizione: string }[];
    const modello = String(imp.dati.modello ?? "");
    if (modello && !lista.some((m) => m.descrizione === modello)) {
      const riga = righe.find((r) => d(r) === modello);
      if (riga) lista.unshift(...materiali([riga], () => true));
    }
  }
  return out;
}

// ---- Risposta dell'IA (funzione "impianti-ia") → impianto da catalogare ----
export type RuoloIA = { n: number; ruolo: string };
export type ImpiantoIA = {
  categoria: string; principale: number; materiali: RuoloIA[];
  canna_fumaria_m: number | null; canna_fumaria_sezione: string | null; impianto_termico: string | null; tipo_gas: string | null;
};

/** Stessi campi delle regole, ma con i materiali e i ruoli scelti dall'IA */
export function impiantoDaIA(ia: ImpiantoIA, righe: Riga[], rapporto: Record<string, unknown>): ImpiantoRilevato | null {
  const anno = String(rapporto.data ?? "").slice(0, 4) || null;
  const scelte = ia.materiali.filter((m) => righe[m.n]);
  const di = (...ruoli: string[]) => scelte.filter((m) => ruoli.includes(m.ruolo)).map((m) => righe[m.n]);
  const tutte = (r: Riga[]) => elenco(r, /./) || null;
  const principale = righe[ia.principale] ?? righe[scelte[0]?.n];
  if (!principale) return null;
  const descr = d(principale);
  const base = { marca: marcaMateriale(descr), modello: descr, anno, materiali: materiali(scelte.map((m) => righe[m.n]), () => true) };
  switch (ia.categoria) {
    case "Caldaie":
      return { categoria: "Caldaie", dati: { tipo_impianto: "Caldaia", impianto: "Caldaia", ...base,
        defangatore: tutte(di("defangatore")), sdoppiatore: tutte(di("sdoppiatore")), dosatore: tutte(di("dosatore")),
        pompe_valvole: tutte(di("pompe_valvole")),
        canna_fumaria_m: ia.canna_fumaria_m ?? cannaFumaria(di("canna_fumaria"))?.metri ?? null,
        canna_fumaria_sezione: ia.canna_fumaria_sezione ?? cannaFumaria(di("canna_fumaria"))?.sezione ?? null,
        impianto_termico: ia.impianto_termico ?? impiantoTermico(righe) } };
    case "Clima": {
      const interne = di("unita_interna");
      return { categoria: "Clima", dati: { tipo_impianto: "Climatizzatore", impianto: interne.length ? "Unità esterna + interne" : "Climatizzatore", ...base,
        unita_interne: tutte(interne),
        tipo_gas: (rapporto.tipo_gas as string) || ia.tipo_gas || gasDaDescrizione(descr) || null,
        gas_kg: rapporto.gas_aggiunto_kg ?? null } };
    }
    case "Automatismi":
      return { categoria: "Automatismi", dati: { tipo_impianto: "Automatismo", ...base,
        impianto: /scorrev/i.test(descr) ? "Cancello scorrevole" : /battent/i.test(descr) ? "Cancello a battente" : /bascul|garage/i.test(descr) ? "Basculante / garage" : /serrand/i.test(descr) ? "Serranda" : /barriera/i.test(descr) ? "Barriera" : "Automatismo",
        componenti: tutte(scelte.map((m) => righe[m.n])) } };
    case "Allarmi":
      return { categoria: "Allarmi", dati: { tipo_impianto: "Allarme", impianto: "Impianto di allarme", ...base, componenti: tutte(scelte.map((m) => righe[m.n])) } };
    case "TVCC": {
      const telecamere = di("telecamera").reduce((n, r) => n + q(r), 0);
      return { categoria: "TVCC", dati: { tipo_impianto: "Videosorveglianza", ...base,
        impianto: telecamere ? `Videosorveglianza (${fmt(telecamere)} telecamere)` : "Videosorveglianza",
        componenti: tutte(scelte.map((m) => righe[m.n])) } };
    }
  }
  return null;
}

// ---- Correzioni fatte a mano nella linguetta Materiali (script 0048): valgono sempre, regole e IA ----
export type Correzione = { categoria: string; descrizione: string; incluso: boolean };
export const chiaveCorrezione = (t: unknown) => String(t ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/** Toglie i materiali esclusi a mano e aggiunge quelli che la ditta ha detto di tenere, se sono nel rapportino */
export function applicaCorrezioni(imp: ImpiantoRilevato, righe: Riga[], correzioni: Correzione[]): ImpiantoRilevato {
  const mie = correzioni.filter((c) => c.categoria === imp.categoria);
  if (!mie.length || !Array.isArray(imp.dati.materiali)) return imp;
  const esclusi = new Set(mie.filter((c) => !c.incluso).map((c) => chiaveCorrezione(c.descrizione)));
  const inclusi = new Set(mie.filter((c) => c.incluso).map((c) => chiaveCorrezione(c.descrizione)));
  const lista = (imp.dati.materiali as { descrizione: string }[]).filter((m) => !esclusi.has(chiaveCorrezione(m.descrizione)));
  const presenti = new Set(lista.map((m) => chiaveCorrezione(m.descrizione)));
  const aggiunti = materiali(righe, (t) => inclusi.has(chiaveCorrezione(t)) && !presenti.has(chiaveCorrezione(t)));
  return { ...imp, dati: { ...imp.dati, materiali: [...lista, ...aggiunti] } };
}

// Rapportini da far guardare all'IA: quelli con un impianto trovato dalle regole o con materiali "sospetti"
export const CANDIDATO_IA = /\b(mot|cald|cond|clim|centr|sens|fotoc|lamp|tvc|telec|u\.?i)\b\.?|caldai|condensaz|clima|condizion|split|unit[aà]'? ?(est|int)|\bu\.?e\.?\b|pompa di calore|motor|cancell|automa|fotocell|allarm|antifurt|centrale|sensor|sirena|telecam|\b[ndx]vr\b|videosorv|tvcc|defang|fumi|coassial|radiator/i;
