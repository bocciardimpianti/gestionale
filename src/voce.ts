// Comandi vocali: la frase riconosciuta diventa un'azione sulla schermata aperta.
// Nessuna azione che cancella dati viene eseguita a voce.

export type Comando =
  | { tipo: "aiuto" }
  | { tipo: "apri"; hash: string; nome: string }
  | { tipo: "nuovo"; hash?: string; nome?: string }
  | { tipo: "cerca"; testo: string }
  | { tipo: "aggiungi"; testo: string }
  | { tipo: "primo" }
  | { tipo: "consigliati" }
  | { tipo: "salva" }
  | { tipo: "chiudi" }
  | { tipo: "quantita"; valore: number }
  | { tipo: "vietato" }
  | { tipo: "premi"; testo: string }
  | { tipo: "scrivi"; testo: string }
  | { tipo: "libero"; testo: string };

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();

const SEZIONI: [RegExp, string, string][] = [
  [/^(home|dashboard|pagina iniziale)$/, "#/", "Home"],
  [/^(client[ei])$/, "#/s/clienti", "Clienti"],
  [/^(fornitor[ei])$/, "#/s/fornitori", "Fornitori"],
  [/^(tecnic[oi])$/, "#/s/tecnici", "Tecnici"],
  [/^(impiant[oi])$/, "#/s/impianti", "Impianti"],
  [/^(rapport[oi]|rapportin[oi]|intervent[oi]|rapport[oi] di intervento)$/, "#/s/rapporti", "Rapporti di intervento"],
  [/^agenda$/, "#/s/agenda", "Agenda"],
  [/^(preventiv[oi])$/, "#/s/preventivi", "Preventivi"],
  [/^(ddt|d d t|bolla|bolle|ddt di acquisto)$/, "#/s/ddt_acquisto", "DDT di Acquisto"],
  [/^(material[ei]|magazzino|articol[oi])$/, "#/s/materiali", "Materiali"],
  [/^(scadenziario|scadenz[ae]|pagamenti)$/, "#/s/scadenziario", "Scadenziario"],
];
const sezione = (t: string) => SEZIONI.find(([re]) => re.test(t.replace(/^(il|la|lo|i|le|gli|un|una|l) /, "")));

const NUMERI: Record<string, number> = { un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, venti: 20, trenta: 30, cinquanta: 50, cento: 100 };
export const numeroDa = (t: string) => {
  const n = t.replace(",", ".").trim();
  if (/^\d+(\.\d+)?$/.test(n)) return Number(n);
  return NUMERI[n];
};

export function interpreta(frase: string): Comando {
  const t = norm(frase);
  if (/^(aiuto|cosa posso dire|comandi|che comandi ci sono)$/.test(t)) return { tipo: "aiuto" };
  if (/(^| )(elimina|eliminare|cancella|cancellare|svuota|togli tutto)( |$)/.test(t) && !t.startsWith("scrivi ") && !t.startsWith("cerca ")) return { tipo: "vietato" };

  let m = t.match(/^(?:scrivi|detta) (.+)$/);
  if (m) return { tipo: "scrivi", testo: frase.trim().replace(/^\S+\s+/, "") };
  m = t.match(/^(?:nuovo|nuova|crea|aggiungi nuovo|aggiungi nuova)(?: (.+))?$/);
  if (m) {
    if (!m[1]) return { tipo: "nuovo" };
    const s = sezione(m[1]);
    if (s) return { tipo: "nuovo", hash: s[1], nome: s[2] };
  }
  m = t.match(/^(?:cerca|trova|ricerca)(?: il| la| lo| i| le)? (.+)$/);
  if (m) return { tipo: "cerca", testo: m[1] };
  if (/^(materiali )?consigliati$|^consiglia( materiali)?$|^suggerisci( materiali)?$/.test(t)) return { tipo: "consigliati" };
  if (/^(scegli |prendi |aggiungi |seleziona )?(il )?primo( risultato)?$/.test(t)) return { tipo: "primo" };
  m = t.match(/^(?:aggiungi|inserisci|metti)(?: un| una| il| la)?(?: materiale| articolo)?(?: (.+))?$/);
  if (m && !/^\d+$/.test(m[1] ?? "") && NUMERI[m[1] ?? ""] === undefined) return { tipo: "aggiungi", testo: m[1] ?? "" };
  m = t.match(/^(?:quantita|metti|pezzi|numero pezzi)(?: a| di)? (.+)$/);
  if (m && numeroDa(m[1]) !== undefined) return { tipo: "quantita", valore: numeroDa(m[1]) };
  if (/^(salva|salvare|conferma salvataggio)( .*)?$/.test(t)) return { tipo: "salva" };
  if (/^(chiudi|annulla|indietro|fine)( finestra| scheda| ricerca)?$/.test(t)) return { tipo: "chiudi" };
  m = t.match(/^(?:premi|clicca|tocca|schiaccia) (?:su )?(?:il |la |lo )?(.+)$/);
  if (m) return { tipo: "premi", testo: m[1] };
  m = t.match(/^(?:apri|mostra|(?:vai|portami)(?: a| ai| al| alla| alle| agli| in| su| nei| nelle)?)(?: il| la| lo| i| le| gli)? (.+)$/);
  const s = sezione(m ? m[1] : t);
  if (s) return { tipo: "apri", hash: s[1], nome: s[2] };
  return { tipo: "libero", testo: frase.trim() };
}

// ---- Azioni sulla pagina ----
const visibile = (e: Element) => {
  const r = (e as HTMLElement).getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
};
// La parte di schermata in primo piano: ricerca a tutto schermo, finestra aperta più recente, oppure l'intera pagina
const primoPiano = (): Element => {
  const r = document.querySelector(".ricerca-telefono");
  if (r) return r;
  const finestre = [...document.querySelectorAll(".velo")].filter(visibile);
  return finestre[finestre.length - 1] ?? document.body;
};
const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const schedaAperta = () => !!document.querySelector(".velo");

function imposta(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, valore: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!.call(el, valore);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

const VIETATI = /(elimin|cancell|svuota|definitiv|^esci|esci$|togli questa)/;

function bottone(testo: string, radice: Element = primoPiano()) {
  const voluto = norm(testo);
  const tutti = [...radice.querySelectorAll<HTMLElement>("button, a, [role=menuitem]")].filter(visibile)
    .map((el) => ({ el, t: norm(el.innerText || el.getAttribute("aria-label") || el.title || "") }))
    .filter((x) => x.t && !VIETATI.test(x.t));
  return (tutti.find((x) => x.t === voluto) ?? tutti.find((x) => x.t.startsWith(voluto)) ?? tutti.find((x) => x.t.includes(voluto)))?.el;
}

// "cliente rossi", "attivita sostituita caldaia": riempie il campo con quell'etichetta nella scheda aperta
async function compilaCampo(frase: string) {
  const radice = primoPiano();
  const voluta = norm(frase);
  const campi = [...radice.querySelectorAll<HTMLLabelElement>(".cornice > label, .campo-riga, .testata-ddt-pdf label")].filter(visibile)
    .map((label) => ({ label, nome: norm(label.childNodes[0]?.textContent ?? label.innerText) }))
    .filter((c) => c.nome.length >= 2 && (voluta.startsWith(c.nome + " ") || voluta.startsWith(c.nome.replace(/^nome /, "") + " ")))
    .sort((a, b) => b.nome.length - a.nome.length);
  const c = campi[0];
  if (!c) return "";
  const parole = c.nome.split(" ").length - (voluta.startsWith(c.nome + " ") ? 0 : 1);
  const valore = frase.trim().split(/\s+/).slice(parole).join(" ");
  const contenitore = c.label.closest(".cornice") ?? c.label;
  const ricerca = contenitore.querySelector<HTMLButtonElement>("button.campo-ricerca");
  if (ricerca) {
    ricerca.click();
    await pausa(150);
    const input = document.querySelector<HTMLInputElement>(".ricerca-telefono input");
    if (input) imposta(input, valore);
    await pausa(150);
    const risultati = [...document.querySelectorAll<HTMLButtonElement>(".ricerca-telefono-elenco button")];
    if (risultati.length === 1) risultati[0].click();
    return risultati.length === 1 ? `${c.nome}: ${risultati[0].innerText}` : `${c.nome}: scegli dall'elenco`;
  }
  const el = contenitore.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=checkbox]), textarea, select");
  if (!el || el.disabled || (el as HTMLInputElement).readOnly) return "";
  if (el instanceof HTMLSelectElement) {
    const o = [...el.options].find((x) => norm(x.text).includes(norm(valore)));
    if (!o) return `${c.nome}: "${valore}" non è tra le scelte`;
    imposta(el, o.value);
  } else {
    el.focus();
    imposta(el, el.type === "number" && numeroDa(norm(valore)) !== undefined ? String(numeroDa(norm(valore))) : valore);
    // Campo con suggerimenti su PC: la proposta unica viene scelta da sola
    if (el.closest(".autocompleta")) {
      await pausa(120);
      const proposte = el.closest(".autocompleta")!.querySelectorAll("li");
      if (proposte.length === 1) proposte[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      else if (proposte.length > 1) return `${c.nome}: scegli dall'elenco`;
    }
  }
  return `${c.nome}: ${valore}`;
}

function scriviNelCampo(testo: string) {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.readOnly || el.disabled || ["checkbox", "radio"].includes(el.type)) return false;
  const attuale = el.value;
  imposta(el, attuale && !/\s$/.test(attuale) ? `${attuale} ${testo}` : attuale + testo);
  return true;
}

function campoRicerca() {
  const radice = primoPiano();
  return radice.querySelector<HTMLInputElement>(".ricerca-telefono input, .cerca-materiale > input")
    ?? (radice === document.body ? document.querySelector<HTMLInputElement>(".ricerca input") : null);
}

async function aggiungi(testo: string) {
  let campo = document.querySelector<HTMLInputElement>(".cerca-materiale > input");
  if (!campo) {
    const b = bottone("Aggiungi materiale") ?? primoPiano().querySelector<HTMLElement>('button[title^="Aggiungi materiali"]');
    if (!b) return "Apri prima un rapportino";
    b.click();
    await pausa(250);
    campo = document.querySelector<HTMLInputElement>(".cerca-materiale > input");
  }
  if (!campo) return "Non riesco ad aprire la ricerca materiali";
  if (testo) imposta(campo, testo);
  return testo ? `Cerco il materiale: ${testo}. Tocca quello giusto o di' "il primo"` : "Di' cosa cercare";
}

function primo() {
  const radice = primoPiano();
  const r = radice.querySelector<HTMLElement>(".ricerca-telefono-elenco button, .materiali-telefono button, .cerca-materiale tbody tr, .elenco-telefono-righe .riga-telefono-apri");
  if (!r) return "Nessun risultato da scegliere";
  const nome = r.innerText.split("\n")[0];
  r.click();
  return `Scelto: ${nome}`;
}

function quantita(valore: number) {
  const telefono = [...document.querySelectorAll<HTMLInputElement>(".quantita-telefono input")].filter(visibile);
  let campo: HTMLInputElement | undefined = telefono[telefono.length - 1];
  if (!campo) {
    const tab = document.querySelector(".tabella-righe table");
    if (tab) {
      const i = [...tab.querySelectorAll("th")].findIndex((t) => norm(t.textContent ?? "") === "quantita");
      const righe = tab.querySelectorAll("tbody tr");
      campo = righe[righe.length - 1]?.children[i]?.querySelector("input") ?? undefined;
    }
  }
  if (!campo) return "Nessuna riga materiali a cui dare la quantità";
  imposta(campo, String(valore));
  return `Quantità: ${valore}`;
}

export const AIUTO = "Puoi dire: apri clienti, nuovo rapportino, cerca rossi, cliente rossi, attività sostituita caldaia, aggiungi valvola, il primo, quantità 3, materiali consigliati, salva, chiudi, premi azioni, scrivi seguito dal testo.";

// Esegue il comando e restituisce il messaggio da mostrare
export async function esegui(c: Comando): Promise<string> {
  switch (c.tipo) {
    case "aiuto": return AIUTO;
    case "vietato": return "Per sicurezza non elimino a voce: tieni premuto sulla riga e conferma.";
    case "apri":
      if (schedaAperta()) return "Chiudi prima la scheda aperta, così non perdi modifiche.";
      location.hash = c.hash;
      return `Apro ${c.nome}`;
    case "nuovo": {
      if (schedaAperta()) return "Chiudi prima la scheda aperta, così non perdi modifiche.";
      if (c.hash && location.hash !== c.hash) {
        location.hash = c.hash;
        await pausa(700);
      }
      const pulsanti = document.querySelector(".pulsanti");
      const b = pulsanti ? bottone("Nuovo", pulsanti) : undefined;
      if (!b) return "In questa pagina non si può creare un nuovo documento.";
      b.click();
      return c.nome ? `Nuovo in ${c.nome}` : "Nuovo documento";
    }
    case "cerca": {
      const campo = campoRicerca();
      if (!campo) return "Qui non c'è una ricerca";
      imposta(campo, c.testo);
      return `Cerco: ${c.testo}`;
    }
    case "aggiungi": return aggiungi(c.testo);
    case "primo": return primo();
    case "consigliati": {
      const b = bottone("Materiali consigliati");
      if (!b) return "Apri prima un rapportino";
      b.click();
      return "Materiali consigliati";
    }
    case "salva": {
      const b = [...primoPiano().querySelectorAll<HTMLElement>("button")].filter(visibile).find((x) => /^salva/.test(norm(x.innerText)));
      if (!b) return "Qui non c'è nulla da salvare";
      b.click();
      return "Salvo";
    }
    case "chiudi": {
      const r = document.querySelector(".ricerca-telefono");
      const b = r ? bottone("Fine", r) : bottone("Chiudi") ?? bottone("Fine") ?? bottone("Annulla") ?? primoPiano().querySelector<HTMLElement>(".chiudi");
      if (!b || primoPiano() === document.body) return "Non c'è nulla da chiudere";
      b.click();
      return "Chiuso";
    }
    case "quantita": return quantita(c.valore);
    case "premi": {
      const b = bottone(c.testo);
      if (!b) return `Non vedo il pulsante "${c.testo}"`;
      b.click();
      return `Premuto: ${c.testo}`;
    }
    case "scrivi": return scriviNelCampo(c.testo) ? "Scritto" : "Tocca prima il campo in cui scrivere";
    case "libero": {
      const campo = await compilaCampo(c.testo);
      if (campo) return campo;
      if (scriviNelCampo(c.testo)) return "Scritto";
      const b = bottone(c.testo);
      if (b && norm(c.testo).length >= 3) {
        b.click();
        return `Premuto: ${c.testo}`;
      }
      return `Non ho capito "${c.testo}". Di' "aiuto" per l'elenco dei comandi.`;
    }
  }
}
