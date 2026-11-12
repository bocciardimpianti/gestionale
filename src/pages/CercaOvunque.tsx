import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { ARCHIVI, type Archivio } from "../archivi";
import { dataIt, supabase } from "../supabase";
import { useAuth } from "../auth";
import Scheda from "../components/Scheda";
import MicDettatura from "../components/MicDettatura";
import { pulisciRicerca } from "../testo";

// Ricerca su tutto il gestionale: impianti, clienti, rapportini, preventivi, richieste, materiali, DDT, fornitori.
// Ogni parola deve comparire nei campi del documento OPPURE nel nome del cliente/fornitore collegato
// (es. "rossi caldaia" trova le caldaie del cliente Rossi e i suoi rapportini sulle caldaie).

type Riga = Record<string, unknown> & { id: number };
interface Gruppo {
  sezione: string;
  titolo: string;
  select: string;
  // Campo con il collegamento al cliente o al fornitore (per cercare anche per il suo nome)
  collegato?: { campo: string; tabella: "clienti" | "fornitori" };
  ordine: string;
  descrivi: (r: Riga) => { titolo: string; dettagli: string[] };
}

const nomeDi = (v: unknown) => (v && typeof v === "object" && "nome" in v ? String((v as { nome: unknown }).nome ?? "") : "");
const unisci = (...v: unknown[]) => v.map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
const accorcia = (t: unknown, n = 110) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };

const GRUPPI: Gruppo[] = [
  {
    sezione: "impianti", titolo: "Impianti", select: "*, cliente:clienti(nome)", collegato: { campo: "cliente_id", tabella: "clienti" }, ordine: "id",
    descrivi: (r) => ({
      titolo: unisci(r.tipo_impianto, r.impianto, r.marca, r.modello) || "Impianto",
      dettagli: [r.matricola ? `Matr. ${r.matricola}` : "", nomeDi(r.cliente) ? `Cliente: ${nomeDi(r.cliente)}` : "", r.data_prossimo ? `Prossimo intervento: ${dataIt(r.data_prossimo)}` : ""],
    }),
  },
  {
    sezione: "clienti", titolo: "Clienti", select: "*", ordine: "nome",
    descrivi: (r) => ({ titolo: String(r.nome ?? ""), dettagli: [unisci(r.indirizzo, r.civico, r.comune), String(r.cellulare || r.telefono || ""), String(r.email ?? "")] }),
  },
  {
    sezione: "rapporti", titolo: "Rapportini", select: "*, cliente:clienti(nome), tecnico:tecnici(nome)", collegato: { campo: "cliente_id", tabella: "clienti" }, ordine: "data",
    descrivi: (r) => ({
      titolo: `N. ${r.numero ?? ""} del ${dataIt(r.data)} – ${nomeDi(r.cliente)}`,
      dettagli: [unisci(r.tipo_impianto, r.impianto, r.marca, r.modello, r.matricola ? `matr. ${r.matricola}` : ""), accorcia(r.attivita), nomeDi(r.tecnico) ? `Tecnico: ${nomeDi(r.tecnico)}` : ""],
    }),
  },
  {
    sezione: "preventivi", titolo: "Preventivi", select: "*, cliente:clienti(nome)", collegato: { campo: "cliente_id", tabella: "clienti" }, ordine: "data",
    descrivi: (r) => ({ titolo: `${r.numero ?? "Preventivo"} – ${nomeDi(r.cliente)}`, dettagli: [`del ${dataIt(r.data)}`, String(r.stato ?? ""), accorcia(r.note)] }),
  },
  {
    sezione: "richieste", titolo: "Richieste di intervento", select: "*, cliente:clienti(nome), tecnico:tecnici(nome)", collegato: { campo: "cliente_id", tabella: "clienti" }, ordine: "data_richiesta",
    descrivi: (r) => ({ titolo: `${nomeDi(r.cliente) || r.nominativo || "Richiesta"} – ${dataIt(r.data_richiesta)}`, dettagli: [accorcia(r.descrizione), String(r.stato ?? ""), nomeDi(r.tecnico) ? `Tecnico: ${nomeDi(r.tecnico)}` : ""] }),
  },
  {
    sezione: "materiali", titolo: "Materiali", select: "*", ordine: "descrizione",
    descrivi: (r) => ({ titolo: String(r.descrizione ?? ""), dettagli: [`Cod. ${r.codice_interno ?? ""}`, `Giacenza ${Number(r.giacenza ?? 0).toLocaleString("it-IT")} ${r.unita_misura ?? ""}`] }),
  },
  {
    sezione: "ddt_acquisto", titolo: "DDT di acquisto", select: "*, fornitore:fornitori(nome)", collegato: { campo: "fornitore_id", tabella: "fornitori" }, ordine: "data",
    descrivi: (r) => ({ titolo: `DDT ${r.numero_ddt ?? ""} – ${nomeDi(r.fornitore)}`, dettagli: [`del ${dataIt(r.data)}`, accorcia(r.note)] }),
  },
  {
    sezione: "fornitori", titolo: "Fornitori", select: "*", ordine: "nome",
    descrivi: (r) => ({ titolo: String(r.nome ?? ""), dettagli: [unisci(r.indirizzo, r.comune), String(r.telefono || r.cellulare || "")] }),
  },
];

// Campi di testo in cui cercare: quelli della scheda (così esistono sicuramente nella tabella)
const campiTesto = (cfg: Archivio) =>
  [...new Set([...cfg.campi, ...(cfg.piede ?? []), ...(cfg.piedeGruppi ?? []).flatMap((g) => g.campi)]
    .filter((c) => !c.tipo || ["testo", "area", "email", "telefono"].includes(c.tipo))
    .filter((c) => !c.chiave.startsWith("_"))
    .map((c) => c.chiave))];

const PER_GRUPPO = 30;

// Il documento contiene tutte le parole? (su tutti i suoi testi, compresi i nomi collegati)
const testoRiga = (r: Riga) => pulisciRicerca(Object.values(r).map((v) => (v && typeof v === "object" ? Object.values(v as object).join(" ") : String(v ?? ""))).join(" "));
const contiene = (r: Riga, parole: string[]) => parole.length > 0 && parole.every((p) => testoRiga(r).includes(p));

export default function CercaOvunque() {
  const { puo } = useAuth();
  const [parametri, setParametri] = useSearchParams();
  const [testo, setTesto] = useState(parametri.get("q") ?? "");
  const [risultati, setRisultati] = useState<Record<string, Riga[]>>({});
  // Clienti riconosciuti dal nome, con tutti i documenti collegati (le altre parole li ordinano, non li escludono)
  const [clienti, setClienti] = useState<{ cliente: Riga; altre: string[]; collegati: Record<string, Riga[]> }[]>([]);
  const [inCorso, setInCorso] = useState(false);
  const [aperto, setAperto] = useState<{ cfg: Archivio; valori: Riga } | null>(null);
  const giro = useRef(0);

  const gruppi = GRUPPI.filter((g) => ARCHIVI[g.sezione] && puo(g.sezione, "vedere"));

  const cerca = async (q: string) => {
    const parole = pulisciRicerca(q).split(" ").filter((p) => p.length >= 2);
    const mio = ++giro.current;
    if (!parole.length) { setRisultati({}); setClienti([]); return; }
    setInCorso(true);
    // Per ogni parola: clienti e fornitori il cui nome la contiene (per trovare i loro documenti)
    const val = (p: string) => `"*${p.replace(/"/g, "")}*"`;
    const collegati: Record<string, Record<string, number[]>> = { clienti: {}, fornitori: {} };
    await Promise.all(parole.flatMap((p) => (["clienti", "fornitori"] as const).map(async (t) => {
      const { data } = await supabase.from(t).select("id").ilike("nome", `%${p}%`).is("eliminato_il", null).limit(200);
      collegati[t][p] = (data ?? []).map((r) => r.id as number);
    })));
    // Clienti il cui nome contiene più parole cercate (es. "corsi daniela caldaia" → CORSI DANIELA, resta "caldaia")
    const conteggio = new Map<number, number>();
    for (const p of parole) for (const id of collegati.clienti[p] ?? []) conteggio.set(id, (conteggio.get(id) ?? 0) + 1);
    const massimo = Math.max(0, ...conteggio.values());
    const idMigliori = [...conteggio].filter(([, n]) => n === massimo && n > 0).map(([id]) => id).slice(0, 5);
    const schedeClienti: typeof clienti = [];
    if (idMigliori.length && puo("clienti", "vedere")) {
      const { data: anag } = await supabase.from("clienti").select("*").in("id", idMigliori);
      const SEZIONI_CLIENTE = ["impianti", "rapporti", "preventivi", "richieste"].map((k) => GRUPPI.find((g) => g.sezione === k)!).filter((g) => gruppi.includes(g));
      const perCliente: Record<string, Riga[]> = {};
      await Promise.all(SEZIONI_CLIENTE.map(async (g) => {
        const { data } = await supabase.from(ARCHIVI[g.sezione].tabella).select(g.select).in("cliente_id", idMigliori).is("eliminato_il", null)
          .order(g.ordine, { ascending: !["data", "data_richiesta"].includes(g.ordine) }).limit(300);
        perCliente[g.sezione] = (data ?? []) as unknown as Riga[];
      }));
      for (const c of ((anag ?? []) as Riga[]).filter((x) => idMigliori.includes(x.id))) {
        const nome = pulisciRicerca(String(c.nome ?? ""));
        const altre = parole.filter((p) => !nome.includes(p));
        const collegatiCliente: Record<string, Riga[]> = {};
        for (const g of SEZIONI_CLIENTE) {
          const elenco = (perCliente[g.sezione] ?? []).filter((r) => r.cliente_id === c.id);
          // Prima quelli che contengono le altre parole (es. "caldaia"), poi gli altri
          collegatiCliente[g.sezione] = [...elenco].sort((a, b) => Number(contiene(b, altre)) - Number(contiene(a, altre)));
        }
        schedeClienti.push({ cliente: c, altre, collegati: collegatiCliente });
      }
    }

    const trovati: Record<string, Riga[]> = {};
    await Promise.all(gruppi.map(async (g) => {
      const campi = campiTesto(ARCHIVI[g.sezione]).filter((c) => c !== "foto" && c !== "firma" && c !== "pdf");
      let query = supabase.from(ARCHIVI[g.sezione].tabella).select(g.select).is("eliminato_il", null);
      for (const p of parole) {
        const condizioni = campi.map((c) => `${c}.ilike.${val(p)}`);
        if (g.collegato && collegati[g.collegato.tabella][p]?.length) condizioni.push(`${g.collegato.campo}.in.(${collegati[g.collegato.tabella][p].join(",")})`);
        if (g.sezione === "rapporti" && /^\d{1,7}$/.test(p)) condizioni.push(`numero.eq.${p}`);
        query = query.or(condizioni.join(","));
      }
      const { data } = await query.order(g.ordine, { ascending: !["data", "data_richiesta"].includes(g.ordine) }).limit(PER_GRUPPO + 1);
      trovati[g.sezione] = ((data ?? []) as unknown as Riga[]);
    }));
    if (mio !== giro.current) return;
    setClienti(schedeClienti);
    setRisultati(trovati);
    setInCorso(false);
  };

  // Ricerca mentre si scrive (con una breve attesa) e testo ricordato nell'indirizzo
  useEffect(() => {
    const t = setTimeout(() => {
      cerca(testo);
      setParametri(testo ? { q: testo } : {}, { replace: true });
    }, 350);
    return () => clearTimeout(t);
  }, [testo]); // eslint-disable-line react-hooks/exhaustive-deps

  const apri = (g: Gruppo, r: Riga) => {
    const valori = { ...r } as Riga;
    for (const [k, v] of Object.entries(valori)) if (v && typeof v === "object" && "nome" in v) valori[k] = nomeDi(v);
    setAperto({ cfg: ARCHIVI[g.sezione], valori });
  };

  const totale = Object.values(risultati).reduce((t, l) => t + l.length, 0);

  return (
    <div className="cerca-ovunque">
      <div className="testata"><h1>Cerca ovunque</h1></div>
      <div className="riga-cerca cerca-ovunque-campo">
        <label>
          <Search size={18} />
          <input type="search" autoFocus enterKeyHint="search" value={testo} onChange={(e) => setTesto(e.target.value)}
            placeholder="Es. vaillant, rossi caldaia, matricola, numero rapportino…"
            onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} />
        </label>
        <MicDettatura onTesto={setTesto} />
      </div>
      <p className="piccolo">
        Cerca in impianti, clienti, rapportini, preventivi, richieste, materiali, DDT e fornitori. Scrivendo il nome di un cliente
        compaiono anche i suoi impianti, rapportini e preventivi; più parole restringono la ricerca (es. "rossi caldaia").
      </p>
      {inCorso && <p className="piccolo">Ricerca in corso…</p>}
      {!inCorso && testo.trim().length >= 2 && !totale && !clienti.length && <p className="vuoto-linguetta">Nessun risultato.</p>}
      {clienti.map(({ cliente, altre, collegati }) => (
        <section key={`c${cliente.id}`} className="scheda-cliente-trovato">
          <button type="button" className="risultato cliente-trovato" onClick={() => apri(GRUPPI.find((g) => g.sezione === "clienti")!, cliente)}>
            <b>{String(cliente.nome ?? "")}</b>
            <span>{GRUPPI.find((g) => g.sezione === "clienti")!.descrivi(cliente).dettagli.filter(Boolean).join(" · ") || "Apri la scheda del cliente"}</span>
          </button>
          {altre.length > 0 && <p className="piccolo">In evidenza i documenti che contengono: <b>{altre.join(" ")}</b></p>}
          {Object.entries(collegati).map(([sezione, elenco]) => {
            const g = GRUPPI.find((x) => x.sezione === sezione)!;
            return (
              <details key={sezione} className="collegati-cliente" open={elenco.length > 0 && elenco.length <= 8 || elenco.some((r) => contiene(r, altre))}>
                <summary>{g.titolo} <span className="piccolo">({elenco.length})</span></summary>
                {!elenco.length && <p className="piccolo">Nessuno</p>}
                {elenco.slice(0, 50).map((r) => {
                  const d = g.descrivi(r);
                  const evidenza = contiene(r, altre);
                  return (
                    <button type="button" key={r.id} className={`risultato${evidenza ? " in-evidenza" : ""}`} onClick={() => apri(g, r)}>
                      <b>{d.titolo}</b>
                      <span>{d.dettagli.filter(Boolean).join(" · ")}</span>
                    </button>
                  );
                })}
                {elenco.length > 50 && <p className="piccolo">Mostrati i primi 50 di {elenco.length}: apri la scheda del cliente per vederli tutti.</p>}
              </details>
            );
          })}
        </section>
      ))}
      {clienti.length > 0 && Object.values(risultati).some((l) => l.length) && <h2 className="altri-risultati">Altri risultati</h2>}
      {gruppi.filter((g) => risultati[g.sezione]?.length).map((g) => (
        <section key={g.sezione} className="gruppo-risultati">
          <h2>{g.titolo} <span className="piccolo">({risultati[g.sezione].length > PER_GRUPPO ? `primi ${PER_GRUPPO}` : risultati[g.sezione].length})</span></h2>
          {risultati[g.sezione].slice(0, PER_GRUPPO).map((r) => {
            const d = g.descrivi(r);
            return (
              <button type="button" key={r.id} className="risultato" onClick={() => apri(g, r)}>
                <b>{d.titolo}</b>
                <span>{d.dettagli.filter(Boolean).join(" · ")}</span>
              </button>
            );
          })}
        </section>
      ))}
      {aperto && (
        <Scheda
          cfg={aperto.cfg}
          valori={aperto.valori}
          cartelle={[]}
          nelCestino={false}
          onChiudi={() => setAperto(null)}
          onSalvato={() => { setAperto(null); cerca(testo); }}
          onElimina={() => alert(`Per eliminare questo documento aprilo dalla sezione ${aperto.cfg.titolo}`)}
          onSposta={() => alert(`Per spostarlo in un archivio aprilo dalla sezione ${aperto.cfg.titolo}`)}
        />
      )}
    </div>
  );
}
