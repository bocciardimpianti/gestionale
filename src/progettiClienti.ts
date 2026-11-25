import { leggiTutto, supabase } from "./supabase";
import { scritteDaPdf } from "./ddtPdf";

// Progetti e schede dei clienti (script 0059): i file arrivati dalla cartella Drive "Progetti clienti" vengono letti
// qui nel gestionale (nome del file, sottocartella di Drive e, per i PDF, il testo) e smistati:
//  - cliente: il nome dell'anagrafica trovato nel file (nome e cognome in qualsiasi ordine);
//  - argomento: Bagni, Caldaia, Clima… dalle parole del file (nel nome del file e nella cartella contano di più).
// Nessun dato va a servizi esterni. Quello che non si capisce resta "da smistare" e si assegna a mano.

export type ProgettoFile = {
  id: number; drive_id: string | null; nome_file: string; cartella: string | null; percorso: string; tipo: string | null; dimensione: number | null;
  stato: string; cliente_id: number | null; categoria: string | null; motivo: string | null; a_mano: boolean; creato_il: string;
};

export const CATEGORIE_PROGETTO: { nome: string; icona: string; parole: RegExp }[] = [
  { nome: "Bagni", icona: "🛁", parole: /\bbagn[oi]\b|sanitar|\bwc\b|vaso sospes|lavab|bidet|\bdocci|piatto doccia|mobile bagno|miscelator|rubinett|vasca/g },
  { nome: "Caldaia", icona: "🔥", parole: /caldai|condensazion|generatore di calore|canna fumaria|fumi\b/g },
  { nome: "Clima", icona: "❄️", parole: /climatizz|condizionator|\bsplit\b|multisplit|unit[aà] (esterna|interna)|canalizzat|aria condizionata|\bvrv\b|\bvrf\b/g },
  { nome: "Riscaldamento", icona: "♨️", parole: /radiante|riscaldamento|collettor|termosifon|radiator|pompa di calore|scaldasalviett|ventilconvettor|fan ?coil/g },
  { nome: "Acqua calda", icona: "🚿", parole: /scaldabagno|bollitor|acqua calda sanitaria|\bpuffer\b|accumulo acqua|solare termico/g },
  { nome: "Elettrico", icona: "⚡", parole: /impianto elettrico|quadro elettrico|centralino|interruttor|unifilare|punti? luce|\bprese\b|domotic|illuminazion|\bled\b/g },
  { nome: "Fotovoltaico", icona: "☀️", parole: /fotovoltaic|inverter|pannelli solari|moduli fv|\bkwp\b|batteri[ae] di accumulo|accumulo elettrico/g },
  { nome: "Allarme e videosorveglianza", icona: "🚨", parole: /allarm|antifurto|videosorvegl|telecamer|\btvcc\b|\bnvr\b|\bdvr\b|sensor[ei] volumetric/g },
  { nome: "Automazioni", icona: "🚧", parole: /cancell|automazion|motoriduttor|basculant|serrand|barriera/g },
  { nome: "Cucina", icona: "🍳", parole: /cucina|piano cottura|\bcappa\b|lavastovigli|\bforno\b/g },
  { nome: "Gas", icona: "🧯", parole: /impianto gas|tubazione gas|contatore gas|\bmetano\b|\bgpl\b/g },
  { nome: "Planimetrie e progetti", icona: "📐", parole: /planimetri|\bpiant[ae]\b|progett|\btavola\b|prospett|\bdwg\b|\bdxf\b|scala 1 ?[:/]|rilievo/g },
  { nome: "Documenti", icona: "📄", parole: /dichiarazione di conformit|\bdico\b|librett|certificat|collaud|garanzi|contratt|\bfattur|preventiv|offerta/g },
];
export const ALTRO = { nome: "Altro", icona: "📁" };
export const FOTO = { nome: "Foto", icona: "📷" };
export const iconaCategoria = (nome: string | null) =>
  [...CATEGORIE_PROGETTO, ALTRO, FOTO].find((c) => c.nome === nome)?.icona ?? "📁";

export const normalizza = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[_\-.,;:()/\\'"’]+/g, " ").replace(/\s+/g, " ").trim();
const VUOTE = new Set(["srl", "spa", "snc", "sas", "srls", "ditta", "studio", "sig", "sig ra", "sigra", "dott", "ing", "geom", "arch", "di", "de", "del", "della", "e", "la", "il", "lo", "condominio", "via", "presso"]);

// Argomenti generici: valgono solo se il file non parla di un impianto preciso (un progetto del bagno va in Bagni)
const GENERICHE = new Set(["Planimetrie e progetti", "Documenti"]);

/** Argomento del file: la categoria con più parole trovate (nome del file e cartella valgono 4 volte il testo) */
export function categoriaDi(nome: string, cartella: string, testo: string, tipo: string | null): { categoria: string; parole: string[] } {
  const testa = normalizza(`${cartella} ${nome}`), corpo = normalizza(testo).slice(0, 60000);
  let migliore = { categoria: "", punti: 0, parole: [] as string[] };
  for (const c of [...CATEGORIE_PROGETTO.filter((x) => !GENERICHE.has(x.nome)), ...CATEGORIE_PROGETTO.filter((x) => GENERICHE.has(x.nome))]) {
    if (GENERICHE.has(c.nome) && migliore.punti) break;
    const inTesta = testa.match(c.parole) ?? [], inCorpo = corpo.match(c.parole) ?? [];
    const punti = inTesta.length * 4 + Math.min(inCorpo.length, 25);
    if (punti > migliore.punti) migliore = { categoria: c.nome, punti, parole: [...new Set([...inTesta, ...inCorpo])].slice(0, 4) };
  }
  if (migliore.punti) return { categoria: migliore.categoria, parole: migliore.parole };
  return { categoria: /^image\//.test(tipo ?? "") ? FOTO.nome : ALTRO.nome, parole: [] };
}

/** Cliente del file: il nome dell'anagrafica trovato (tutto il nome, o tutte le sue parole in qualsiasi ordine) */
export function clienteDi(nome: string, cartella: string, testo: string, clienti: { id: number; nome: string }[]) {
  const testa = ` ${normalizza(`${cartella} ${nome}`)} `, tutto = ` ${testa} ${normalizza(testo).slice(0, 80000)} `;
  const trovati: { id: number; nome: string; punti: number }[] = [];
  // Quante volte ogni parola compare nei nomi dei clienti: un cognome che ha un solo cliente basta da solo
  // se è nel nome del file o della cartella (es. cartella "Bellagamba" → BELLAGAMBA STEFANO)
  const usi = new Map<string, number>();
  for (const c of clienti) for (const w of new Set(normalizza(c.nome).split(" "))) usi.set(w, (usi.get(w) ?? 0) + 1);
  for (const c of clienti) {
    const n = normalizza(c.nome);
    const parole = n.split(" ").filter((w) => w.length >= 3 && !VUOTE.has(w));
    if (!parole.length) continue;
    const parola = (w: string, dove: string) => dove.includes(` ${w} `);
    // un nome di una sola parola (es. ROSSI) conta solo se è nel nome del file o della cartella, ed è lungo
    if (parole.length === 1) {
      if (parole[0].length >= 5 && parola(parole[0], testa)) trovati.push({ ...c, punti: 3 });
      continue;
    }
    const intero = tutto.includes(` ${n} `);
    const tutte = parole.every((w) => parola(w, tutto));
    if (!intero && !tutte) {
      if (parole.some((w) => w.length >= 5 && usi.get(w) === 1 && parola(w, testa))) trovati.push({ ...c, punti: 2.5 });
      continue;
    }
    const inTesta = parole.every((w) => parola(w, testa));
    trovati.push({ ...c, punti: (intero ? 3 : 2) + (inTesta ? 3 : 0) + parole.length * 0.1 });
  }
  trovati.sort((a, b) => b.punti - a.punti);
  const primo = trovati[0];
  const unico = primo && (!trovati[1] || trovati[1].punti < primo.punti);
  return { cliente: unico ? primo : null, candidati: trovati.slice(0, 4) };
}

let inCorso: Promise<unknown> | null = null;
export const EVENTO_PROGETTI = "progetti-smistati";

/** Legge e smista i file arrivati da Drive (uno alla volta) */
export async function smistaProgetti(avanzamento: (s: string) => void = () => {}) {
  const esito = { smistati: 0, daSmistare: 0, errori: 0 };
  if (inCorso) { await inCorso.catch(() => {}); return esito; }
  let finito = () => {};
  inCorso = new Promise((ok) => { finito = () => ok(null); });
  try {
    let clienti: { id: number; nome: string }[] | null = null;
    for (let giro = 0; giro < 60; giro++) {
      const { data, error } = await supabase.rpc("prendi_progetto_da_leggere");
      if (error || !data?.length) break;
      const x = data[0] as ProgettoFile;
      try {
        avanzamento(`Lettura di ${x.nome_file}…`);
        clienti ??= (await leggiTutto("clienti", "id, nome", true)) as unknown as { id: number; nome: string }[];
        let testo = "";
        if ((x.tipo ?? "").includes("pdf") || /\.pdf$/i.test(x.nome_file)) {
          const { data: file } = await supabase.storage.from("progetti").download(x.percorso);
          if (file) testo = await scritteDaPdf(file).then((s) => s.map((y) => y.s).join(" ")).catch(() => "");
        }
        const { categoria, parole } = categoriaDi(x.nome_file, x.cartella ?? "", testo, x.tipo);
        const { cliente, candidati } = clienteDi(x.nome_file, x.cartella ?? "", testo, clienti);
        const motivo = cliente
          ? `cliente "${cliente.nome}" trovato ${normalizza(`${x.cartella ?? ""} ${x.nome_file}`).includes(normalizza(cliente.nome).split(" ")[0]) ? "nel nome del file o della cartella" : "nel testo"}${parole.length ? ` · argomento da: ${parole.join(", ")}` : ""}`
          : candidati.length ? `più clienti possibili: ${candidati.map((c) => c.nome).join(", ")}` : "nessun cliente dell'anagrafica trovato nel file";
        await supabase.from("progetti_file").update({
          stato: cliente ? "smistato" : "da_smistare", cliente_id: cliente?.id ?? null, categoria, motivo, aggiornato_il: new Date().toISOString(),
        }).eq("id", x.id);
        if (cliente) esito.smistati++; else esito.daSmistare++;
      } catch (e) {
        await supabase.from("progetti_file").update({ stato: "errore", motivo: (e as Error).message, aggiornato_il: new Date().toISOString() }).eq("id", x.id);
        esito.errori++;
      }
    }
  } finally {
    finito();
    inCorso = null;
    if (esito.smistati || esito.daSmistare || esito.errori) window.dispatchEvent(new CustomEvent(EVENTO_PROGETTI, { detail: esito }));
  }
  return esito;
}

/** Apre un file in una nuova scheda del browser */
export async function apriProgetto(x: Pick<ProgettoFile, "percorso">) {
  const w = window.open("", "_blank");
  const { data, error } = await supabase.storage.from("progetti").createSignedUrl(x.percorso, 3600);
  if (error || !data) { w?.close(); return alert("File non trovato: " + (error?.message ?? "")); }
  if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl;
}
