import { leggiTutto, prossimiCodiciInterni, registra, supabase, vuoto } from "./supabase";
import { ARCHIVI } from "./archivi";
import { leggiDdt, scritteDaPdf, type DdtPdf, type RigaPdf } from "./ddtPdf";
import { euro } from "./components/Griglia";
import { tecnicoDaTesto, type TecnicoDdt } from "./tecnicoDdt";

// Lettura, abbinamento e salvataggio di un DDT di acquisto da PDF: usato dalla finestra "Importa DDT da PDF"
// e dall'importazione automatica dei PDF messi nella cartella Drive (DDT in arrivo).

export type Rec = Record<string, unknown> & { id: number };
export type Stato = "ricordato" | "codice" | "proposta" | "multipli" | "simili" | "nuovo" | "scelto" | "libera";
export interface Riga {
  pdf: RigaPdf;
  stato: Stato;
  materiale: Rec | null;
  candidati: Rec[];
  confermata: boolean;
  // Nuovo materiale da creare
  nuovaDescrizione: string;
  nuovaUm: string;
}

export const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
// Identifica l'articolo di una riga: il codice o, se il documento non lo riporta, la descrizione
export const chiaveRiga = (p: RigaPdf) => norm(p.codice) || `descrizione:${norm(p.descrizione)}`;
export const soloCifre = (s: unknown) => String(s ?? "").replace(/\D/g, "");
// Forma societaria e punteggiatura non aiutano a riconoscere un nome
export const nomeBase = (s: unknown) => norm(s).replace(/\b(s\.?\s?r\.?\s?l\.?s?|s\.?\s?p\.?\s?a\.?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?s\.?)(?![a-z])/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
// Fornitore in anagrafica per un DDT senza lettura su misura: prima la partita IVA, poi il nome più lungo trovato nel testo
export function fornitoreDaTesto(forn: Rec[], testo: string, d: DdtPdf) {
  const cifre = soloCifre(testo);
  const conPiva = forn.find((f) => {
    const piva = soloCifre(f.piva);
    return piva.length === 11 && (piva === d.pivaFornitore || cifre.includes(piva));
  });
  if (conPiva) return conPiva;
  const pulito = ` ${nomeBase(testo)} `;
  return forn
    .map((f) => ({ f, nome: nomeBase(f.nome) }))
    .filter((x) => x.nome.length >= 4 && pulito.includes(` ${x.nome} `))
    .sort((a, b) => b.nome.length - a.nome.length)[0]?.f ?? null;
}
export const senzaZeri = (s: unknown) => norm(s).replace(/^0+(?=.)/, "");
export const valido = (s: unknown) => !vuoto(s) && String(s).replace(/[\s/.-]/g, "") !== "";
// Un campo codice può contenere più codici (es. "90040 - 9000350": vecchio e nuovo codice CLLAT)
export const codiciDi = (s: unknown) => (valido(s) ? String(s).split(/\s+-\s+|\s*;\s*|\s+/).filter(valido).map(senzaZeri) : []);
// Parole significative di una descrizione (per proporre materiali simili)
export const parole = (s: unknown) => new Set(String(s ?? "").toLowerCase().replace(/["'ø°]/g, "").split(/[^a-z0-9.,/]+/).map((w) => w.replace(/^[.,/]+|[.,/]+$/g, "")).filter((w) => w.length >= 2));
export function simili(descr: string, mats: Rec[], quanti = 3) {
  const p = parole(descr);
  if (p.size < 2) return [];
  return mats
    .map((m) => {
      const q = parole(`${m.descrizione ?? ""} ${m.nome_articolo ?? ""}`);
      let comuni = 0;
      for (const w of p) if (q.has(w)) comuni++;
      return { m, comuni, punti: comuni / p.size };
    })
    .filter((x) => x.comuni >= 2 && x.punti >= 0.6)
    .sort((a, b) => b.punti - a.punti || b.comuni - a.comuni)
    .slice(0, quanti)
    .map((x) => x.m);
}
export const UM: Record<string, string> = { NR: "Pz", PZ: "Pz", N: "Pz", MT: "Mt", ML: "Mt", M: "Mt", KG: "Kg", CF: "Cf", LT: "Lt", MQ: "Mq", RT: "Rt", CP: "Cp", PA: "Pa" };
export const umDa = (u: string) => UM[u.toUpperCase()] ?? (u ? u[0].toUpperCase() + u.slice(1).toLowerCase() : "Pz");
export const r4 = (x: number) => Math.round(x * 10000) / 10000;

// Connessione caduta (la richiesta non è arrivata o la risposta non è tornata): si può riprovare
export const erroreRete = (e: { message?: string } | null | undefined) => !!e && /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(e.message ?? "");
export const attendi = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
export const MSG_RETE = "connessione a internet interrotta durante il salvataggio. Controlla la connessione e premi di nuovo Salva DDT: quello che era già stato salvato non viene ripetuto";
export const costo = (x: number) => `${x.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;

export const ETICHETTE: Record<Stato, { testo: string; colore: string }> = {
  ricordato: { testo: "Abbinamento ricordato", colore: "verde" },
  codice: { testo: "Codice fornitore trovato", colore: "verde" },
  scelto: { testo: "Scelto da te", colore: "verde" },
  proposta: { testo: "Proposta: da confermare", colore: "giallo" },
  multipli: { testo: "Più materiali con questo codice: scegli", colore: "giallo" },
  simili: { testo: "Codice non trovato: materiali con descrizione simile", colore: "giallo" },
  nuovo: { testo: "Non in magazzino", colore: "rosso" },
  libera: { testo: "Riga senza magazzino", colore: "verde" },
};

// DDT già caricati con questo numero; quelli senza righe sono salvataggi interrotti (dalla connessione) da completare
export async function ddtConNumero(fornitoreId: number, numero: string) {
  const { data } = await supabase.from("ddt_acquisto").select("id, data, righe:righe_ddt_acquisto(count)").eq("fornitore_id", fornitoreId).eq("numero_ddt", numero.trim()).is("eliminato_il", null);
  return ((data ?? []) as unknown as { id: number; data: string; righe: { count: number }[] }[]).map((d) => ({ id: d.id, data: d.data, vuoto: !(d.righe?.[0]?.count > 0) }));
}

export async function cercaDoppione(fornitoreId: number, numero: string) {
  if (!numero.trim()) return "";
  const pieni = (await ddtConNumero(fornitoreId, numero)).filter((d) => !d.vuoto);
  return pieni.length ? `Il DDT n. ${numero.trim()} di questo fornitore è già stato caricato (del ${String(pieni[0].data).split("-").reverse().join("/")}).` : "";
}


// Abbinamento automatico di ogni riga a un materiale
export function abbina(d: DdtPdf, mats: Rec[], ricordati: Map<string, number>): Riga[] {
  const perId = new Map(mats.map((m) => [m.id, m]));
  return d.righe.map((p) => {
    const base = { pdf: p, candidati: [] as Rec[], nuovaDescrizione: p.descrizione, nuovaUm: umDa(p.um) };
    const ric = ricordati.get(norm(p.codice));
    if (ric && perId.has(ric)) return { ...base, stato: "ricordato", materiale: perId.get(ric)!, confermata: true };
    const perCodice = mats.filter((m) => [m.codice_fornitore1, m.codice_fornitore2].some((c) => codiciDi(c).includes(senzaZeri(p.codice))));
    if (perCodice.length === 1) return { ...base, stato: "codice", materiale: perCodice[0], confermata: true };
    if (perCodice.length > 1) return { ...base, stato: "multipli", materiale: null, candidati: perCodice, confermata: false };
    // Codice del produttore: solo come proposta da confermare
    const perProduttore = valido(p.codiceProduttore)
      ? mats.filter((m) => [m.codice_fornitore1, m.codice_fornitore2, m.codice_barre, m.nome_articolo].some((c) => codiciDi(c).includes(senzaZeri(p.codiceProduttore))))
      : [];
    if (perProduttore.length) return { ...base, stato: "proposta", materiale: perProduttore[0], candidati: perProduttore, confermata: false };
    // Descrizione simile (es. materiali ancora con il vecchio codice del fornitore): solo proposte da scegliere
    const perDescrizione = simili(p.descrizione, mats);
    if (perDescrizione.length) return { ...base, stato: "simili", materiale: null, candidati: perDescrizione, confermata: false };
    return { ...base, stato: "nuovo", materiale: null, confermata: false };
  });
}

// Tipologia di pagamento: dalla scheda del fornitore o, se vuota, dall'ultimo DDT dello stesso fornitore
export async function tipologiaPagamento(f: Rec) {
  if (!vuoto(f.tipologia_pagamento)) return String(f.tipologia_pagamento);
  const { data } = await supabase.from("ddt_acquisto").select("tipologia_pagamento").eq("fornitore_id", f.id)
    .not("tipologia_pagamento", "is", null).is("eliminato_il", null).order("data", { ascending: false }).limit(1);
  return (data?.[0]?.tipologia_pagamento as string | undefined) ?? null;
}

export interface LetturaDdt {
  ddt: DdtPdf; scritte: string; fornitori: Rec[]; materiali: Rec[]; fornitoreId: number | null; righe: Riga[];
  doppione: string; tecnici: TecnicoDdt[]; tecnicoId: number | null; tecnicoDa: string;
}

/** Legge il PDF, trova fornitore e tecnico e abbina le righe ai materiali */
export async function leggiPdfDdt(f: Blob, nome: string, avanzamento: (s: string) => void = () => {}): Promise<LetturaDdt> {
  avanzamento(`Lettura di ${nome}…`);
  const scritte = await scritteDaPdf(f);
  const d = leggiDdt(scritte, nome);
  if (!d) throw new Error("Questo PDF è una scansione e non contiene testo leggibile: inserisci il DDT a mano con \"Nuovo\".");
  avanzamento("Lettura di fornitori e materiali…");
  const [forn, mats] = await Promise.all([
    leggiTutto("fornitori", "id, nome, piva, email, tipologia_pagamento", true),
    leggiTutto("materiali", "id, codice_interno, descrizione, nome_articolo, codice_barre, fornitore1, codice_fornitore1, fornitore2, codice_fornitore2, unita_misura, prezzo_base, ricarico, giacenza, foto", true),
  ]);
  const testo = scritte.map((x) => x.s).join(" ");
  const trovati = d.generico
    ? [fornitoreDaTesto(forn, testo, d)].filter((x): x is Rec => !!x)
    : forn.filter((x) => d.fornitore.test(String(x.nome ?? "")));
  const fid = trovati[0]?.id ?? null;
  let ricordati = new Map<string, number>();
  let doppione = "";
  if (fid) {
    const { data } = await supabase.from("abbinamenti_fornitore").select("codice, materiale_id").eq("fornitore_id", fid);
    ricordati = new Map((data ?? []).map((a) => [norm(a.codice), a.materiale_id as number]));
    doppione = await cercaDoppione(fid, d.numeroDdt);
  }
  // Tecnici (con gli "altri nomi" se lo script 0027 è stato eseguito)
  const conAltri = await supabase.from("tecnici").select("id, nome, altri_nomi").is("eliminato_il", null);
  const tec = conAltri.error ? await supabase.from("tecnici").select("id, nome").is("eliminato_il", null) : conAltri;
  const tecnici = (tec.data ?? []) as TecnicoDdt[];
  // CLLAT: vale solo il nome dopo "RITIRA"; per gli altri fornitori si cerca nelle note
  const riconosciuto = d.ritira ? tecnicoDaTesto(d.ritira, tecnici) : tecnicoDaTesto(d.note, tecnici);
  return { ddt: d, scritte: testo, fornitori: forn, materiali: mats, fornitoreId: fid, righe: abbina(d, mats, ricordati), doppione,
    tecnici, tecnicoId: riconosciuto?.tecnico.id ?? null, tecnicoDa: riconosciuto ? riconosciuto.parola : "" };
}

/** Salva il DDT: crea i materiali nuovi, ricorda gli abbinamenti, salva testata e righe e archivia il PDF */
export async function salvaDdt({ ddt, fornitore, righe, file, tecnicoId, avanzamento = () => {} }: {
  ddt: DdtPdf; fornitore: Rec; righe: Riga[]; file: Blob; tecnicoId: number | null; avanzamento?: (s: string) => void;
}): Promise<{ id: number; messaggio: string; nuoviMateriali: Rec[]; materialiUsati: Rec[] }> {
  const cfg = ARCHIVI.ddt_acquisto;
  // Il numero può essere stato appena corretto a mano: ultimo controllo dei doppioni
  const gia = await cercaDoppione(fornitore.id, ddt.numeroDdt);
  if (gia) throw new Error(gia);
  const finali = righe.map((r) => ({ ...r }));
  // 1. Nuovi materiali (codice interno progressivo)
  const nuovi = finali.filter((r) => r.stato === "nuovo");
  if (nuovi.length) {
    avanzamento("Creazione dei nuovi materiali…");
    // Un solo materiale per codice, anche se il codice compare in più righe
    const unici = [...new Map(nuovi.map((r) => [chiaveRiga(r.pdf), r])).values()];
    // Codice interno: quello del fornitore (CLLAT) oppure il progressivo a 6 cifre
    const dalFornitore = !!ddt.codiceInternoDalFornitore;
    const progressivi = dalFornitore ? [] : await prossimiCodiciInterni(unici.length);
    if (dalFornitore) {
      const { data: esistenti } = await supabase.from("materiali").select("codice_interno, descrizione").in("codice_interno", unici.map((r) => r.pdf.codice));
      if (esistenti?.length) throw new Error(`Esiste già un materiale con codice interno ${esistenti.map((m) => `${m.codice_interno} (${m.descrizione})`).join(", ")}: sceglilo con "Scegli materiale"`);
    }
    const slot = dalFornitore ? 1 : 2;
    const codici = unici.map((r, k) => String(dalFornitore ? r.pdf.codice : progressivi[k]));
    const righeMateriali = unici.map((r, k) => ({
      codice_interno: dalFornitore ? r.pdf.codice : progressivi[k],
      codice_barre: dalFornitore ? r.pdf.codice : progressivi[k],
      descrizione: r.nuovaDescrizione.trim() || r.pdf.descrizione,
      unita_misura: r.nuovaUm || "Pz",
      [`fornitore${slot}`]: fornitore.nome, [`codice_fornitore${slot}`]: r.pdf.codice || null,
      prezzo_base: r.pdf.prezzo, ricarico: 35, prezzo_ricaricato: r4(r.pdf.prezzo * 1.35), giacenza: 0,
    }));
    let { data, error } = await supabase.from("materiali").insert(righeMateriali).select("*");
    if (erroreRete(error)) {
      // Connessione caduta: i materiali potrebbero essere già stati creati (stessi codici interni)
      avanzamento("Connessione interrotta, riprovo…");
      await attendi(1500);
      const { data: trovati, error: e2 } = await supabase.from("materiali").select("*").in("codice_interno", codici);
      if (!e2 && trovati?.length === codici.length) { data = codici.map((c) => trovati.find((m) => String(m.codice_interno) === c)!); error = null; }
      else if (!e2 && !trovati?.length) ({ data, error } = await supabase.from("materiali").insert(righeMateriali).select("*"));
    }
    if (error || !data) throw new Error("Nuovi materiali: " + (erroreRete(error) ? MSG_RETE : error?.message ?? "creazione non riuscita"));
    const creato = new Map(unici.map((r, k) => [chiaveRiga(r.pdf), data![k] as Rec]));
    for (const r of nuovi) { r.materiale = creato.get(chiaveRiga(r.pdf))!; r.stato = "scelto"; }
  }
  // 2. Abbinamenti da ricordare e codice fornitore nei materiali che non lo hanno
  // Senza codice del fornitore non c'è nulla da ricordare
  const daRicordare = finali.filter((r) => r.materiale && valido(r.pdf.codice) && ["scelto", "proposta", "multipli", "simili"].includes(r.stato));
  if (daRicordare.length) {
    const abbinamenti = [...new Map(daRicordare.map((r) => [norm(r.pdf.codice), { fornitore_id: fornitore.id, codice: r.pdf.codice, materiale_id: r.materiale!.id }])).values()];
    let { error } = await supabase.from("abbinamenti_fornitore").upsert(abbinamenti, { onConflict: "fornitore_id,codice" });
    if (erroreRete(error)) { await attendi(1500); ({ error } = await supabase.from("abbinamenti_fornitore").upsert(abbinamenti, { onConflict: "fornitore_id,codice" })); }
    if (error) throw new Error("Abbinamenti: " + (erroreRete(error) ? MSG_RETE : error.message));
    for (const r of daRicordare) {
      const m = r.materiale!;
      if ([m.codice_fornitore1, m.codice_fornitore2].some((c) => senzaZeri(c) === senzaZeri(r.pdf.codice))) continue;
      const slot = !valido(m.codice_fornitore2) ? 2 : !valido(m.codice_fornitore1) ? 1 : 0;
      if (slot) await supabase.from("materiali").update({ [`fornitore${slot}`]: fornitore.nome, [`codice_fornitore${slot}`]: r.pdf.codice }).eq("id", m.id);
    }
  }
  // 3. DDT con le righe (le righe caricano la giacenza e aggiornano il costo se più alto)
  avanzamento("Salvataggio del DDT…");
  const righeFinali = finali.map((r, i) => {
    const m = r.materiale;
    return cfg.righe!.ricalcola({
      ordine: i, materiale_id: m?.id ?? null,
      codice_barre: m ? m.codice_interno ?? m.codice_barre ?? null : r.pdf.codice,
      descrizione: m ? m.descrizione : r.pdf.descrizione,
      unita_misura: m ? m.unita_misura : umDa(r.pdf.um),
      quantita: r.pdf.quantita, costo: r.pdf.prezzo, sconto: 0, iva: r.pdf.iva,
    });
  });
  const tot = cfg.calcolaTotali!({}, righeFinali);
  const testata = {
    data: ddt.data, fornitore_id: fornitore.id, numero_ddt: ddt.numeroDdt, email: fornitore.email ?? null,
    tipologia_pagamento: await tipologiaPagamento(fornitore), stato: "Chiuso", note: ddt.note || null, ...tot,
    ...(tecnicoId ? { tecnico_id: tecnicoId } : {}),
  };
  // Se la connessione cade si riprova, ma prima si guarda se il DDT era già arrivato (per non salvarlo due volte)
  const giaSalvato = async () => {
    const { data } = await supabase.from("ddt_acquisto").select("id").eq("fornitore_id", fornitore.id).eq("numero_ddt", ddt.numeroDdt).eq("data", ddt.data).is("eliminato_il", null).order("id", { ascending: false }).limit(1);
    return (data?.[0] as { id: number } | undefined) ?? null;
  };
  // Un salvataggio interrotto prima delle righe ha lasciato il DDT vuoto: si completa quello
  const interrotto = (await ddtConNumero(fornitore.id, ddt.numeroDdt)).find((d) => d.vuoto);
  let nuovo: { id: number } | null = null;
  if (interrotto) {
    const { error } = await supabase.from("ddt_acquisto").update(testata).eq("id", interrotto.id);
    if (error) throw new Error("DDT: " + (erroreRete(error) ? MSG_RETE : error.message));
    nuovo = { id: interrotto.id };
  }
  for (let tentativo = 0; !nuovo; tentativo++) {
    const { data, error } = await supabase.from("ddt_acquisto").insert(testata).select("id").single();
    if (!error) { nuovo = data as { id: number }; break; }
    if (!erroreRete(error) || tentativo >= 2) throw new Error("DDT: " + (erroreRete(error) ? MSG_RETE : error.message));
    avanzamento("Connessione interrotta, riprovo…");
    await attendi(1500 * (tentativo + 1));
    nuovo = await giaSalvato().catch(() => null);
  }
  // Righe: anche qui, prima di riprovare si controlla se erano già state salvate
  for (let tentativo = 0; ; tentativo++) {
    if (tentativo) {
      // Le righe potrebbero essere arrivate anche se la risposta si è persa
      const { count, error: e } = await supabase.from("righe_ddt_acquisto").select("id", { count: "exact", head: true }).eq("ddt_id", nuovo.id);
      if (e) { if (tentativo >= 3) throw new Error("Righe del DDT: " + MSG_RETE); await attendi(1500 * tentativo); continue; }
      if ((count ?? 0) >= righeFinali.length) break;
    }
    const ins = await supabase.from("righe_ddt_acquisto").insert(righeFinali.map((r) => ({ ...r, ddt_id: nuovo!.id })));
    if (!ins.error) break;
    if (!erroreRete(ins.error) || tentativo >= 2) {
      // Senza righe il DDT non serve: si toglie (se la connessione lo permette) e si potrà rifare da capo
      await supabase.from("ddt_acquisto").delete().eq("id", nuovo.id);
      throw new Error("Righe del DDT: " + (erroreRete(ins.error) ? MSG_RETE : ins.error.message));
    }
    avanzamento("Connessione interrotta, riprovo…");
    await attendi(1500 * (tentativo + 1));
  }
  // 4. PDF originale conservato con il DDT
  avanzamento("Archiviazione del PDF…");
  const percorso = `${nuovo.id}/DDT ${ddt.numeroDdt.replace(/[/\\]/g, "-")}.pdf`;
  const up = await supabase.storage.from("ddt_acquisto").upload(percorso, file, { contentType: "application/pdf", upsert: true });
  if (!up.error) await supabase.from("ddt_acquisto").update({ pdf: percorso }).eq("id", nuovo.id);
  await registra("ddt_acquisto_da_pdf", { id: nuovo.id, fornitore: fornitore.nome, numero_ddt: ddt.numeroDdt, righe: righeFinali.length, nuovi_materiali: new Set(nuovi.map((r) => chiaveRiga(r.pdf))).size });
  const nuoviMateriali = [...new Map(nuovi.map((r) => [r.materiale!.id, r.materiale!])).values()];
  const materialiUsati = [...new Map(finali.filter((r) => r.materiale).map((r) => [r.materiale!.id, r.materiale!])).values()];
  const messaggio = `DDT n. ${ddt.numeroDdt} del ${ddt.data.split("-").reverse().join("/")} salvato: ${righeFinali.length} righe, totale ${euro(tot.totale)}` +
    (nuovi.length ? `, ${new Set(nuovi.map((r) => chiaveRiga(r.pdf))).size} nuovi materiali` : "") + (up.error ? " (PDF non archiviato: " + up.error.message + ")" : "");
  return { id: nuovo.id, messaggio, nuoviMateriali, materialiUsati };
}
