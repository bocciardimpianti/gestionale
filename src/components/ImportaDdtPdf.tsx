import { useMemo, useRef, useState } from "react";
import { leggiTutto, registra, supabase, vuoto } from "../supabase";
import { ARCHIVI } from "../archivi";
import { leggiDdt, MODELLI_DISPONIBILI, scritteDaPdf, type DdtPdf, type RigaPdf } from "../ddtPdf";
import { euro } from "./Griglia";
import CercaMateriale from "./CercaMateriale";

// Importazione di un DDT di acquisto dal PDF del fornitore:
// lettura delle righe, abbinamento ai materiali di magazzino (con conferma) e salvataggio.

type Rec = Record<string, unknown> & { id: number };
type Stato = "ricordato" | "codice" | "proposta" | "multipli" | "nuovo" | "scelto" | "libera";
interface Riga {
  pdf: RigaPdf;
  stato: Stato;
  materiale: Rec | null;
  candidati: Rec[];
  confermata: boolean;
  // Nuovo materiale da creare
  nuovaDescrizione: string;
  nuovaUm: string;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const senzaZeri = (s: unknown) => norm(s).replace(/^0+(?=.)/, "");
const valido = (s: unknown) => !vuoto(s) && String(s).replace(/[\s/.-]/g, "") !== "";
const UM: Record<string, string> = { NR: "Pz", PZ: "Pz", N: "Pz", MT: "Mt", ML: "Mt", M: "Mt", KG: "Kg", CF: "Cf", LT: "Lt", MQ: "Mq", RT: "Rt", CP: "Cp", PA: "Pa" };
const umDa = (u: string) => UM[u.toUpperCase()] ?? (u ? u[0].toUpperCase() + u.slice(1).toLowerCase() : "Pz");
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const costo = (x: number) => `${x.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;

const ETICHETTE: Record<Stato, { testo: string; colore: string }> = {
  ricordato: { testo: "Abbinamento ricordato", colore: "verde" },
  codice: { testo: "Codice fornitore trovato", colore: "verde" },
  scelto: { testo: "Scelto da te", colore: "verde" },
  proposta: { testo: "Proposta: da confermare", colore: "giallo" },
  multipli: { testo: "Più materiali con questo codice: scegli", colore: "giallo" },
  nuovo: { testo: "Non in magazzino", colore: "rosso" },
  libera: { testo: "Riga senza magazzino", colore: "verde" },
};

export default function ImportaDdtPdf({ onChiudi, onFinito }: { onChiudi: () => void; onFinito: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [coda, setCoda] = useState<File[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [urlPdf, setUrlPdf] = useState("");
  const [ddt, setDdt] = useState<DdtPdf | null>(null);
  const [righe, setRighe] = useState<Riga[]>([]);
  const [fornitori, setFornitori] = useState<Rec[]>([]);
  const [fornitoreId, setFornitoreId] = useState<number | null>(null);
  const [doppione, setDoppione] = useState("");
  const [stato, setStato] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [scegliPer, setScegliPer] = useState<number | null>(null);
  const [fatti, setFatti] = useState<string[]>([]);

  const fornitore = fornitori.find((f) => f.id === fornitoreId) ?? null;

  // Abbinamento automatico di ogni riga a un materiale
  const abbina = (d: DdtPdf, mats: Rec[], ricordati: Map<string, number>): Riga[] => {
    const perId = new Map(mats.map((m) => [m.id, m]));
    return d.righe.map((p) => {
      const base = { pdf: p, candidati: [] as Rec[], nuovaDescrizione: p.descrizione, nuovaUm: umDa(p.um) };
      const ric = ricordati.get(norm(p.codice));
      if (ric && perId.has(ric)) return { ...base, stato: "ricordato", materiale: perId.get(ric)!, confermata: true };
      const perCodice = mats.filter((m) => [m.codice_fornitore1, m.codice_fornitore2].some((c) => valido(c) && senzaZeri(c) === senzaZeri(p.codice)));
      if (perCodice.length === 1) return { ...base, stato: "codice", materiale: perCodice[0], confermata: true };
      if (perCodice.length > 1) return { ...base, stato: "multipli", materiale: null, candidati: perCodice, confermata: false };
      // Codice del produttore: solo come proposta da confermare
      const perProduttore = valido(p.codiceProduttore)
        ? mats.filter((m) => [m.codice_fornitore1, m.codice_fornitore2, m.codice_barre, m.nome_articolo].some((c) => valido(c) && senzaZeri(c) === senzaZeri(p.codiceProduttore)))
        : [];
      if (perProduttore.length) return { ...base, stato: "proposta", materiale: perProduttore[0], candidati: perProduttore, confermata: false };
      return { ...base, stato: "nuovo", materiale: null, confermata: false };
    });
  };

  const apri = async (f: File, resto: File[]) => {
    setFile(f);
    setCoda(resto);
    setDdt(null);
    setRighe([]);
    setDoppione("");
    setInCorso(true);
    if (urlPdf) URL.revokeObjectURL(urlPdf);
    setUrlPdf(URL.createObjectURL(f));
    try {
      setStato(`Lettura di ${f.name}…`);
      const d = leggiDdt(await scritteDaPdf(f));
      if (!d) throw new Error(`Fornitore non riconosciuto. Per ora so leggere i DDT di: ${MODELLI_DISPONIBILI.join(", ")}. Mandami un esempio per aggiungere gli altri.`);
      setStato("Lettura di fornitori e materiali…");
      const [forn, mats] = await Promise.all([
        leggiTutto("fornitori", "id, nome, email, tipologia_pagamento", true),
        leggiTutto("materiali", "id, codice_interno, descrizione, nome_articolo, codice_barre, fornitore1, codice_fornitore1, fornitore2, codice_fornitore2, unita_misura, prezzo_base, ricarico, giacenza", true),
      ]);
      const trovati = forn.filter((x) => d.fornitore.test(String(x.nome ?? "")));
      const fid = trovati[0]?.id ?? null;
      let ricordati = new Map<string, number>();
      if (fid) {
        const { data } = await supabase.from("abbinamenti_fornitore").select("codice, materiale_id").eq("fornitore_id", fid);
        ricordati = new Map((data ?? []).map((a) => [norm(a.codice), a.materiale_id as number]));
        const { data: gia } = await supabase.from("ddt_acquisto").select("id, data").eq("fornitore_id", fid).eq("numero_ddt", d.numeroDdt).is("eliminato_il", null);
        if (gia?.length) setDoppione(`Il DDT n. ${d.numeroDdt} di questo fornitore è già stato caricato (del ${String(gia[0].data).split("-").reverse().join("/")}).`);
      }
      setFornitori(forn);
      setFornitoreId(fid);
      setDdt(d);
      setRighe(abbina(d, mats, ricordati));
      setStato(fid ? "" : "Fornitore non trovato in anagrafica: sceglilo dall'elenco");
    } catch (e) {
      setStato("Errore: " + (e as Error).message);
    }
    setInCorso(false);
  };

  // La scelta fatta su una riga vale anche per le altre righe non confermate con lo stesso codice
  const cambia = (i: number, v: Partial<Riga>) => setRighe((rr) => rr.map((r, j) =>
    j === i || (v.confermata && !r.confermata && norm(r.pdf.codice) === norm(rr[i].pdf.codice)) ? { ...r, ...v } : r));

  // Righe come verranno salvate nel DDT (stessi calcoli della scheda)
  const cfg = ARCHIVI.ddt_acquisto;
  const righeDdt = useMemo(() => righe.map((r, i) => {
    const m = r.materiale;
    return cfg.righe!.ricalcola({
      ordine: i,
      materiale_id: m?.id ?? null,
      codice_barre: m ? m.codice_interno ?? m.codice_barre ?? null : r.pdf.codice,
      descrizione: m ? m.descrizione : r.stato === "nuovo" ? r.nuovaDescrizione : r.pdf.descrizione,
      unita_misura: m ? m.unita_misura : r.stato === "nuovo" ? r.nuovaUm : umDa(r.pdf.um),
      quantita: r.pdf.quantita, costo: r.pdf.prezzo, sconto: 0, iva: r.pdf.iva,
    });
  }), [righe, cfg]);
  const totali = cfg.calcolaTotali!({}, righeDdt);

  const daConfermare = righe.filter((r) => !r.confermata).length;
  const bloccato = !ddt || ddt.errori.length > 0 || !!doppione || !fornitore || daConfermare > 0;

  const salva = async () => {
    if (!ddt || !fornitore || !file || bloccato) return;
    setInCorso(true);
    try {
      const finali = righe.map((r) => ({ ...r }));
      // 1. Nuovi materiali (codice interno progressivo)
      const nuovi = finali.filter((r) => r.stato === "nuovo");
      if (nuovi.length) {
        setStato("Creazione dei nuovi materiali…");
        const { data: tutti } = await supabase.from("materiali").select("codice_interno");
        let ultimo = Math.max(0, ...(tutti ?? []).map((m) => (/^\d+$/.test(String(m.codice_interno ?? "")) ? Number(m.codice_interno) : 0)));
        const lung = Math.max(6, ...(tutti ?? []).map((m) => (/^\d+$/.test(String(m.codice_interno ?? "")) ? String(m.codice_interno).length : 0)));
        // Un solo materiale per codice, anche se il codice compare in più righe
        const unici = [...new Map(nuovi.map((r) => [norm(r.pdf.codice), r])).values()];
        const { data, error } = await supabase.from("materiali").insert(unici.map((r) => ({
          codice_interno: String(++ultimo).padStart(lung, "0"),
          descrizione: r.nuovaDescrizione.trim() || r.pdf.descrizione,
          unita_misura: r.nuovaUm || "Pz",
          fornitore2: fornitore.nome, codice_fornitore2: r.pdf.codice,
          prezzo_base: r.pdf.prezzo, ricarico: 35, prezzo_ricaricato: r4(r.pdf.prezzo * 1.35), giacenza: 0,
        }))).select("*");
        if (error) throw new Error("Nuovi materiali: " + error.message);
        const creato = new Map(unici.map((r, k) => [norm(r.pdf.codice), data![k] as Rec]));
        for (const r of nuovi) { r.materiale = creato.get(norm(r.pdf.codice))!; r.stato = "scelto"; }
      }
      // 2. Abbinamenti da ricordare e codice fornitore nei materiali che non lo hanno
      const daRicordare = finali.filter((r) => r.materiale && ["scelto", "proposta", "multipli"].includes(r.stato));
      if (daRicordare.length) {
        const { error } = await supabase.from("abbinamenti_fornitore").upsert(
          [...new Map(daRicordare.map((r) => [norm(r.pdf.codice), { fornitore_id: fornitore.id, codice: r.pdf.codice, materiale_id: r.materiale!.id }])).values()],
          { onConflict: "fornitore_id,codice" },
        );
        if (error) throw new Error("Abbinamenti: " + error.message);
        for (const r of daRicordare) {
          const m = r.materiale!;
          if ([m.codice_fornitore1, m.codice_fornitore2].some((c) => senzaZeri(c) === senzaZeri(r.pdf.codice))) continue;
          const slot = !valido(m.codice_fornitore2) ? 2 : !valido(m.codice_fornitore1) ? 1 : 0;
          if (slot) await supabase.from("materiali").update({ [`fornitore${slot}`]: fornitore.nome, [`codice_fornitore${slot}`]: r.pdf.codice }).eq("id", m.id);
        }
      }
      // 3. DDT con le righe (le righe caricano la giacenza e aggiornano il costo se più alto)
      setStato("Salvataggio del DDT…");
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
      const { data: nuovo, error } = await supabase.from("ddt_acquisto").insert({
        data: ddt.data, fornitore_id: fornitore.id, numero_ddt: ddt.numeroDdt, email: fornitore.email ?? null,
        tipologia_pagamento: fornitore.tipologia_pagamento ?? null, stato: "Chiuso", note: ddt.note || null, ...tot,
      }).select("id").single();
      if (error) throw new Error("DDT: " + error.message);
      const ins = await supabase.from("righe_ddt_acquisto").insert(righeFinali.map((r) => ({ ...r, ddt_id: nuovo.id })));
      if (ins.error) {
        await supabase.from("ddt_acquisto").delete().eq("id", nuovo.id);
        throw new Error("Righe del DDT: " + ins.error.message);
      }
      // 4. PDF originale conservato con il DDT
      setStato("Archiviazione del PDF…");
      const percorso = `${nuovo.id}/DDT ${ddt.numeroDdt}.pdf`;
      const up = await supabase.storage.from("ddt_acquisto").upload(percorso, file, { contentType: "application/pdf", upsert: true });
      if (!up.error) await supabase.from("ddt_acquisto").update({ pdf: percorso }).eq("id", nuovo.id);
      await registra("ddt_acquisto_da_pdf", { id: nuovo.id, fornitore: fornitore.nome, numero_ddt: ddt.numeroDdt, righe: righeFinali.length, nuovi_materiali: new Set(nuovi.map((r) => norm(r.pdf.codice))).size });
      const messaggio = `DDT n. ${ddt.numeroDdt} del ${ddt.data.split("-").reverse().join("/")} salvato: ${righeFinali.length} righe, totale ${euro(tot.totale)}` +
        (nuovi.length ? `, ${new Set(nuovi.map((r) => norm(r.pdf.codice))).size} nuovi materiali` : "") + (up.error ? " (PDF non archiviato: " + up.error.message + ")" : "");
      setFatti((f) => [...f, messaggio]);
      setStato(messaggio);
      onFinito();
      setDdt(null);
      setRighe([]);
      setFile(null);
      if (coda.length) await apri(coda[0], coda.slice(1));
    } catch (e) {
      setStato("Errore: " + (e as Error).message);
    }
    setInCorso(false);
  };

  const azioniRiga = (r: Riga, i: number) => {
    const btn = (testo: string, f: () => void, classe = "grigio") => <button type="button" className={`btn piccolo-btn ${classe}`} onClick={f}>{testo}</button>;
    return (
      <div className="azioni-riga-pdf">
        {r.stato === "proposta" && !r.confermata && btn("Conferma", () => cambia(i, { confermata: true }), "verde")}
        {r.stato === "multipli" && r.candidati.map((c) => btn(`${c.codice_interno ?? ""} ${String(c.descrizione ?? "").slice(0, 30)}`, () => cambia(i, { materiale: c, stato: "scelto", confermata: true })))}
        {r.stato === "nuovo" && !r.confermata && btn("Crea nuovo materiale", () => cambia(i, { confermata: true }), "verde")}
        {btn(r.materiale ? "Cambia materiale" : "Scegli materiale", () => setScegliPer(i))}
        {r.stato !== "libera" && btn("Senza magazzino", () => cambia(i, { materiale: null, stato: "libera", confermata: true }))}
      </div>
    );
  };

  return (
    <div className="velo" onMouseDown={() => !inCorso && onChiudi()}>
      <div className="finestra finestra-ddt-pdf" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Importa DDT da PDF<button type="button" className="chiudi" disabled={inCorso} onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          {!ddt && (
            <div
              className="trascina-pdf"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = [...e.dataTransfer.files].filter((x) => x.name.toLowerCase().endsWith(".pdf"));
                if (f.length && !inCorso) apri(f[0], f.slice(1));
              }}
              onClick={() => !inCorso && fileRef.current?.click()}
            >
              <b>Trascina qui il PDF del DDT</b> (anche più di uno) oppure clicca per sceglierlo.
              <div className="piccolo">Fornitori riconosciuti: {MODELLI_DISPONIBILI.join(", ")}</div>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple hidden onChange={(e) => {
            const f = [...(e.target.files ?? [])];
            e.target.value = "";
            if (f.length) apri(f[0], f.slice(1));
          }} />
          {stato && <p className={stato.startsWith("Errore") || stato.startsWith("Fornitore non") ? "errore" : "ok"}>{stato}</p>}

          {ddt && (
            <>
              <div className="testata-ddt-pdf">
                <label>Fornitore
                  <select value={fornitoreId ?? ""} onChange={(e) => setFornitoreId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— scegli —</option>
                    {[...fornitori].sort((a, b) => String(a.nome).localeCompare(String(b.nome))).map((f) => <option key={f.id} value={f.id}>{String(f.nome)}</option>)}
                  </select>
                </label>
                <label>Numero DDT<input readOnly value={ddt.numeroDdt} /></label>
                <label>Data<input readOnly value={ddt.data.split("-").reverse().join("/")} /></label>
                <button type="button" className="btn grigio" onClick={() => window.open(urlPdf, "_blank")}>Apri il PDF</button>
              </div>
              {ddt.note && <div className="piccolo">Note: {ddt.note.split("\n").join(" · ")}</div>}
              {ddt.errori.map((e) => <p key={e} className="errore">⛔ {e}</p>)}
              {doppione && <p className="errore">⛔ {doppione}</p>}
              {ddt.avvisi.map((e) => <p key={e} className="avviso">⚠ {e}</p>)}

              <div className="tabella-ddt-pdf">
                <table className="griglia">
                  <thead>
                    <tr>
                      <th>Dal PDF</th>
                      <th className="destra">Q.tà</th>
                      <th className="destra">Prezzo</th>
                      <th className="destra">IVA</th>
                      <th>Materiale in magazzino</th>
                      <th className="destra">Costo in magazzino</th>
                    </tr>
                  </thead>
                  <tbody>
                    {righe.map((r, i) => {
                      const et = ETICHETTE[r.stato];
                      const colore = r.confermata ? "verde" : et.colore;
                      const pb = Number(r.materiale?.prezzo_base ?? 0);
                      return (
                        <tr key={i} className={`riga-pdf ${colore}`}>
                          <td>
                            <div><b>{r.pdf.codice}</b> <span className="piccolo">{r.pdf.codiceProduttore}</span></div>
                            <div>{r.pdf.descrizione}</div>
                          </td>
                          <td className="destra">{r.pdf.quantita.toLocaleString("it-IT")} {r.pdf.um}</td>
                          <td className="destra">{costo(r.pdf.prezzo)}</td>
                          <td className="destra">{r.pdf.iva}%</td>
                          <td>
                            <div className={`etichetta-pdf ${colore}`}>{r.confermata && r.stato === "proposta" ? "Confermato" : r.confermata && r.stato === "nuovo" ? "Verrà creato" : et.testo}</div>
                            {r.materiale && <div><b>{String(r.materiale.codice_interno ?? "")}</b> {String(r.materiale.descrizione ?? "")}</div>}
                            {r.stato === "nuovo" && (
                              <div className="nuovo-materiale">
                                <input value={r.nuovaDescrizione} onChange={(e) => cambia(i, { nuovaDescrizione: e.target.value })} title="Descrizione del nuovo materiale" />
                                <input value={r.nuovaUm} onChange={(e) => cambia(i, { nuovaUm: e.target.value })} title="Unità di misura" className="um" />
                              </div>
                            )}
                            {azioniRiga(r, i)}
                          </td>
                          <td className="destra">
                            {r.materiale && (
                              <>
                                {costo(pb)}
                                {r.pdf.prezzo > pb + 0.00005 && <div className="avviso piccolo">↑ diventa {costo(r.pdf.prezzo)}</div>}
                                {r.pdf.prezzo < pb - 0.00005 && <div className="piccolo">↓ resta invariato</div>}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="piede-ddt-pdf">
                <span>{righe.length} righe · Imponibile <b>{euro(totali.imponibile)}</b> · IVA <b>{euro(totali.iva_totale)}</b> · Totale <b>{euro(totali.totale)}</b></span>
                {daConfermare > 0 && <span className="avviso">{daConfermare} righe da confermare</span>}
              </div>
            </>
          )}
          {fatti.length > 1 && <details><summary className="ok">{fatti.length} DDT salvati</summary><ul className="piccolo">{fatti.map((f) => <li key={f}>{f}</li>)}</ul></details>}
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" disabled={inCorso} onClick={onChiudi}>Chiudi</button>
          {coda.length > 0 && <span className="piccolo" style={{ padding: "0 10px" }}>Altri {coda.length} PDF in attesa</span>}
          <span style={{ flex: 1 }} />
          {ddt && coda.length > 0 && <button type="button" className="btn grigio" disabled={inCorso} onClick={() => apri(coda[0], coda.slice(1))}>Salta questo</button>}
          {ddt && (
            <button type="button" className="btn blu" disabled={inCorso || bloccato} onClick={salva}
              title={bloccato ? "Risolvi gli errori e conferma tutte le righe" : "Salva il DDT e carica il magazzino"}>
              {inCorso ? "Salvataggio…" : "Salva DDT"}
            </button>
          )}
        </div>
      </div>
      {scegliPer !== null && (
        <div onMouseDown={(e) => e.stopPropagation()}>
        <CercaMateriale
          titolo={`Materiale per: ${righe[scegliPer].pdf.descrizione}`}
          testoIniziale={righe[scegliPer].pdf.descrizione.split(/\s+/)[0] ?? ""}
          onChiudi={() => setScegliPer(null)}
          onScegli={(m) => { cambia(scegliPer, { materiale: m as Rec, stato: "scelto", confermata: true }); setScegliPer(null); }}
        />
        </div>
      )}
    </div>
  );
}
