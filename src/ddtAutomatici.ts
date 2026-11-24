import { supabase } from "./supabase";
import { leggiPdfDdt, salvaDdt, type Rec } from "./ddtImport";

// Importazione automatica dei DDT arrivati dalla cartella Google Drive (tabella ddt_in_arrivo, script 0057).
// Il DDT si salva da solo solo se è tutto sicuro: fornitore riconosciuto, numero e data letti, righe abbinate con
// il codice del fornitore (o abbinamenti già ricordati) oppure articoli nuovi, che vengono creati.
// Altrimenti resta "da controllare" e si apre con un tocco nella finestra "Importa DDT da PDF".
// Gli articoli nuovi e quelli del DDT senza foto vengono segnati "da rivedere" (Materiali → Filtri → Da rivedere).

export type InArrivo = { id: number; drive_id: string | null; nome_file: string; percorso: string; stato: string; messaggio: string | null; ddt_id: number | null; creato_il: string };

let inCorso: Promise<unknown> | null = null;
// Passo dell'importazione in corso (mostrato nel riquadro "DDT in arrivo")
export let passoAttuale = "";
const TEMPO_MASSIMO = 4 * 60 * 1000;

/** Chiede alla funzione server di guardare subito la cartella Drive (oltre al controllo ogni 5 minuti) */
export async function controllaDrive() {
  const { data, error } = await supabase.functions.invoke("ddt-drive", { body: {} });
  if (error) throw new Error(error.message);
  if (data?.errore) throw new Error(data.errore);
  return data as { nuovi: number; cartella: number; errori?: string[] };
}

async function segnaDaRivedere(materiali: Rec[], motivo: (m: Rec) => string | null) {
  const ora = new Date().toISOString();
  for (const m of materiali) {
    const testo = motivo(m);
    if (!testo) continue;
    await supabase.from("materiali").update({ da_rivedere: testo, da_rivedere_il: ora }).eq("id", m.id).is("da_rivedere", null);
  }
}

/** Importa uno per uno i DDT in arrivo. Restituisce quanti ne ha salvati e quanti restano da controllare */
export async function importaDdtInArrivo(avanzamento: (s: string) => void = () => {}) {
  const esito = { importati: 0, daControllare: 0, errori: 0, messaggi: [] as string[], giaInCorso: false };
  // Già in corso (es. il controllo automatico): si aspetta che finisca
  if (inCorso) { avanzamento(`Importazione già in corso: ${passoAttuale}`); await inCorso.catch(() => {}); esito.giaInCorso = true; return esito; }
  let finito = () => {};
  inCorso = new Promise((ok) => { finito = () => ok(null); });
  const passo = (t: string) => { passoAttuale = t; avanzamento(t); window.dispatchEvent(new CustomEvent("ddt-avanzamento", { detail: t })); };
  try {
    for (let giro = 0; giro < 50; giro++) {
      const { data, error } = await supabase.rpc("prendi_ddt_in_arrivo");
      if (error || !data?.length) break;
      const x = data[0] as InArrivo;
      const fine = (stato: string, messaggio: string, ddt_id: number | null = null) =>
        supabase.from("ddt_in_arrivo").update({ stato, messaggio, ddt_id, aggiornato_il: new Date().toISOString() }).eq("id", x.id);
      let ultimo = "";
      const p = (t: string) => { ultimo = t; passo(`${x.nome_file}: ${t}`); };
      let timer = 0;
      try {
        await Promise.race([
          new Promise((_, no) => { timer = window.setTimeout(() => no(new Error(`tempo scaduto durante "${ultimo}"`)), TEMPO_MASSIMO); }),
          (async () => {
        p("scarico il PDF…");
        const { data: file, error: e1 } = await supabase.storage.from("ddt_acquisto").download(x.percorso);
        if (e1 || !file) throw new Error("PDF non trovato nell'archivio: " + (e1?.message ?? ""));
        const l = await leggiPdfDdt(file, x.nome_file, p);
        const fornitore = l.fornitori.find((f) => f.id === l.fornitoreId) ?? null;
        if (l.doppione) { await fine("scartato", l.doppione); return; }
        // Cosa impedisce il salvataggio automatico
        const problemi: string[] = [...l.ddt.errori];
        if (!fornitore) problemi.push(`fornitore non riconosciuto${l.ddt.nomeFornitore ? ` (${l.ddt.nomeFornitore})` : ""}`);
        if (!l.ddt.numeroDdt.trim() || !l.ddt.data) problemi.push("numero o data del DDT non letti");
        const dubbie = l.righe.filter((r) => !r.confermata && r.stato !== "nuovo");
        if (dubbie.length) problemi.push(`${dubbie.length} ${dubbie.length === 1 ? "riga da abbinare" : "righe da abbinare"} (${dubbie.slice(0, 3).map((r) => r.pdf.descrizione).join("; ")}${dubbie.length > 3 ? "…" : ""})`);
        if (!l.righe.length) problemi.push("nessuna riga letta");
        if (problemi.length || !fornitore) { await fine("da_controllare", problemi.join(" · ")); esito.daControllare++; return; }
        // Articoli non in magazzino: si creano (verranno segnati da rivedere)
        const righe = l.righe.map((r) => (r.stato === "nuovo" ? { ...r, confermata: true } : r));
        const s = await salvaDdt({ ddt: l.ddt, fornitore, righe, file, tecnicoId: l.tecnicoId, avanzamento: p });
        p("segno gli articoli da rivedere…");
        const rif = `DDT ${l.ddt.numeroDdt} ${String(fornitore.nome ?? "")}`.trim();
        const nuovi = new Set(s.nuoviMateriali.map((m) => m.id));
        await segnaDaRivedere(s.nuoviMateriali, () => `Nuovo dal ${rif}`);
        await segnaDaRivedere(s.materialiUsati.filter((m) => !nuovi.has(m.id)), (m) => (m.foto ? null : `Senza foto (${rif})`));
        await fine("importato", s.messaggio, s.id);
        esito.importati++;
        esito.messaggi.push(s.messaggio);
          })(),
        ]);
      } catch (e) {
        await fine("errore", (e as Error).message);
        esito.errori++;
      } finally {
        window.clearTimeout(timer);
      }
    }
  } finally {
    passoAttuale = "";
    finito();
    inCorso = null;
    window.dispatchEvent(new CustomEvent("ddt-avanzamento", { detail: "" }));
  }
  return esito;
}
