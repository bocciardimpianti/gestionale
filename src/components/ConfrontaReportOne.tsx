import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { dataIso, dataIt, leggiTutto, registra, supabase } from "../supabase";

// ReportOne → gestionale, dall'esportazione CSV dei Rapporti di intervento.
// 1) CONFRONTO in sola lettura: nuovi, uguali (stesso numero, data e cliente), in CONFLITTO (stesso numero ma lavoro
//    diverso: gestionale e ReportOne hanno numerato ognuno per conto suo), solo nel gestionale.
// 2) IMPORTAZIONE solo di quello che si sceglie:
//    - conflitti: per ognuno "usa ReportOne" (il rapportino del gestionale va nel Cestino con i suoi impianti/F-gas,
//      i materiali presi dai DDT tornano disponibili, e si aggiunge quello di ReportOne) oppure "tieni il gestionale";
//    - nuovi: si aggiungono (il CSV non contiene i materiali);
//    - uguali: si segnano solo come pagati quelli pagati in ReportOne (niente viene mai cancellato o tolto).

type RigaCsv = { numero: number; data: string | null; cliente: string; tecnico: string; attivita: string; imponibile: number; pagata: boolean; dataPagamento: string | null; grezza: string[] };
type RigaDb = { id: number; numero: number; data: string | null; cliente: string; tecnico: string; attivita: string; imponibile: number; pagata: boolean; dataPagamento: string | null; eliminato: boolean };
type Conflitto = { csv: RigaCsv; db: RigaDb; motivo: string };
type Esito = {
  intestazione: string[]; nuovi: RigaCsv[]; uguali: { csv: RigaCsv; db: RigaDb }[]; conflitti: Conflitto[];
  soloGestionale: RigaDb[]; daPagare: { csv: RigaCsv; db: RigaDb }[]; pagateSoloQui: number; maxCsv: number;
  clientiMancanti: string[];
};

/** CSV con ";" e virgolette (anche testi su più righe) */
export function leggiCsv(testo: string): string[][] {
  const righe: string[][] = []; let riga: string[] = []; let campo = ""; let tra = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (tra) {
      if (c === '"') { if (testo[i + 1] === '"') { campo += '"'; i++; } else tra = false; }
      else campo += c;
    } else if (c === '"') tra = true;
    else if (c === ";") { riga.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && testo[i + 1] === "\n") i++;
      riga.push(campo); righe.push(riga); riga = []; campo = "";
    } else campo += c;
  }
  if (campo || riga.length) { riga.push(campo); righe.push(riga); }
  return righe.filter((r) => r.some((x) => x.trim()));
}
/** Testo del file: UTF-8, oppure Windows-1252 se ci sono caratteri non validi (accenti) */
export async function testoFile(f: File) {
  const buf = await f.arrayBuffer();
  const utf = new TextDecoder("utf-8").decode(buf);
  return utf.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf;
}
const numeroIt = (s: unknown) => { const t = String(s ?? "").trim(); if (!t) return null; const n = Number(t.replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const parole = (s: unknown) => norm(s).split(" ").filter(Boolean).sort().join(" ");
const stessoCliente = (a: string, b: string) => { const x = norm(a), y = norm(b); return !x || !y || x === y || x.includes(y) || y.includes(x); };
const ora = (s: unknown) => { const m = String(s ?? "").match(/(\d{1,2})[:.](\d{2})/); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null; };
const testo = (s: unknown) => { const t = String(s ?? "").trim(); return t || null; };

export default function ConfrontaReportOne({ onChiudi, onFinito }: { onChiudi: () => void; onFinito?: () => void }) {
  const [stato, setStato] = useState("");
  const [esito, setEsito] = useState<Esito | null>(null);
  const [vedi, setVedi] = useState<"conflitti" | "nuovi" | "solo">("conflitti");
  const [usaReportOne, setUsaReportOne] = useState<Set<number>>(new Set());
  const [aggiungiNuovi, setAggiungiNuovi] = useState(true);
  const [segnaPagati, setSegnaPagati] = useState(true);
  const [creaClienti, setCreaClienti] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ultimoFile = useRef<File | null>(null);

  const confronta = async (f: File) => {
    setEsito(null); ultimoFile.current = f;
    try {
      setStato("Lettura del file…");
      const tabella = leggiCsv(await testoFile(f));
      const h = (tabella[0] ?? []).map((x) => x.trim());
      const col = (nome: string) => h.findIndex((x) => x.toLowerCase() === nome.toLowerCase());
      const i = { numero: col("Numero"), data: col("Data"), tecnico: col("Tecnico"), vecchio: col("Tecnico Vecchio"), cliente: col("Nome cliente"), attivita: col("Attività svolte"), imponibile: col("Imponibile"), pagata: col("Pagata"), dataPag: col("Data Pagamento") };
      if (i.numero < 0 || i.data < 0) throw new Error("Il file non sembra un'esportazione dei Rapporti di intervento (mancano le colonne Numero e Data)");
      const csv: RigaCsv[] = tabella.slice(1).map((r) => ({
        numero: Number(String(r[i.numero] ?? "").trim()), data: dataIso(r[i.data]) ?? null,
        cliente: (r[i.cliente] ?? "").trim(), tecnico: ((r[i.tecnico] ?? "").trim() || (r[i.vecchio] ?? "").trim()),
        attivita: (r[i.attivita] ?? "").trim(), imponibile: numeroIt(r[i.imponibile]) ?? 0, pagata: (r[i.pagata] ?? "").trim() === "1",
        dataPagamento: dataIso(r[i.dataPag]) ?? null, grezza: r,
      })).filter((r) => Number.isInteger(r.numero) && r.numero > 0);

      setStato("Lettura dei rapportini del gestionale…");
      const [db, clienti] = await Promise.all([
        leggiTutto("rapporti", "id, numero, data, attivita, pagata, data_pagamento, imponibile, eliminato_il, tecnico_vecchio, cliente:clienti(nome), tecnico:tecnici(nome)").then((x) => x
          .filter((r) => r.numero != null)
          .map((r) => ({ id: r.id, numero: Number(r.numero), data: r.data ? String(r.data).slice(0, 10) : null, cliente: String(r.cliente ?? ""),
            tecnico: String(r.tecnico || r.tecnico_vecchio || ""), attivita: String(r.attivita ?? ""), imponibile: Number(r.imponibile) || 0, pagata: !!r.pagata,
            dataPagamento: r.data_pagamento ? String(r.data_pagamento).slice(0, 10) : null, eliminato: !!r.eliminato_il }) as RigaDb)),
        leggiTutto("clienti", "id, nome", true),
      ]);
      const perNumero = new Map<number, RigaDb>();
      for (const r of db) if (!perNumero.has(r.numero) || perNumero.get(r.numero)!.eliminato) perNumero.set(r.numero, r);
      const nomiClienti = new Set(clienti.map((c) => norm(c.nome)));

      const e: Esito = { intestazione: h, nuovi: [], uguali: [], conflitti: [], soloGestionale: [], daPagare: [], pagateSoloQui: 0, maxCsv: Math.max(0, ...csv.map((r) => r.numero)), clientiMancanti: [] };
      for (const c of csv) {
        const d = perNumero.get(c.numero);
        if (!d || d.eliminato) { e.nuovi.push(c); continue; }
        const dataDiversa = !!c.data && !!d.data && c.data !== d.data;
        const clienteDiverso = !stessoCliente(c.cliente, d.cliente);
        if (dataDiversa || clienteDiverso) {
          e.conflitti.push({ csv: c, db: d, motivo: [dataDiversa && "data diversa", clienteDiverso && "cliente diverso"].filter(Boolean).join(" e ") });
        } else {
          e.uguali.push({ csv: c, db: d });
          if (d.pagata && !c.pagata) e.pagateSoloQui++;
          if (!d.pagata && c.pagata) e.daPagare.push({ csv: c, db: d });
        }
      }
      const numeriCsv = new Set(csv.map((r) => r.numero));
      e.soloGestionale = db.filter((r) => !r.eliminato && !numeriCsv.has(r.numero)).sort((a, b) => b.numero - a.numero);
      e.conflitti.sort((a, b) => b.csv.numero - a.csv.numero);
      e.nuovi.sort((a, b) => b.numero - a.numero);
      // Clienti dei rapportini da aggiungere che non ci sono in anagrafica
      e.clientiMancanti = [...new Map([...e.nuovi, ...e.conflitti.map((x) => x.csv)].filter((r) => r.cliente && !nomiClienti.has(norm(r.cliente)))
        .map((r) => [norm(r.cliente), r.cliente])).values()].sort();
      setEsito(e);
      setUsaReportOne(new Set(e.conflitti.map((x) => x.csv.numero)));
      setVedi(e.conflitti.length ? "conflitti" : "nuovi");
      setStato(`${csv.length} rapportini nel file, ${db.filter((r) => !r.eliminato).length} nel gestionale. Finora nessuna modifica: scegli cosa fare e premi Importa.`);
    } catch (err) {
      setStato("Errore: " + (err as Error).message);
    }
  };

  const importa = async () => {
    if (!esito) return;
    const sostituiti = esito.conflitti.filter((x) => usaReportOne.has(x.csv.numero));
    const daAggiungere = [...(aggiungiNuovi ? esito.nuovi : []), ...sostituiti.map((x) => x.csv)];
    const pagati = segnaPagati ? esito.daPagare : [];
    if (!sostituiti.length && !daAggiungere.length && !pagati.length) return alert("Non c'è niente da fare con le scelte attuali.");
    if (!confirm(`Confermi?\n\n• ${sostituiti.length} rapportini del gestionale nel Cestino (sostituiti da ReportOne)\n• ${daAggiungere.length} rapportini di ReportOne da aggiungere\n• ${pagati.length} rapportini da segnare come pagati${creaClienti && esito.clientiMancanti.length ? `\n• ${esito.clientiMancanti.length} clienti nuovi in anagrafica` : ""}\n\nI materiali dei rapportini non ci sono nel CSV.`)) return;
    setInCorso(true);
    try {
      const h = esito.intestazione;
      const col = (nome: string, ultima = false) => { const t = nome.toLowerCase(); const idx = h.map((x, k) => (x.toLowerCase() === t ? k : -1)).filter((k) => k >= 0); return ultima ? idx[idx.length - 1] ?? -1 : idx[0] ?? -1; };
      const v = (r: string[], nome: string, ultima = false) => { const k = col(nome, ultima); return k >= 0 ? r[k] ?? "" : ""; };

      // Tecnici (nome, nome al contrario, altri nomi) e clienti per nome
      const [tecnici, clienti] = await Promise.all([leggiTutto("tecnici", "id, nome, altri_nomi", true), leggiTutto("clienti", "id, nome", true)]);
      const tecnicoPer = new Map<string, number>();
      for (const t of tecnici) {
        tecnicoPer.set(parole(t.nome), t.id);
        for (const a of String(t.altri_nomi ?? "").split(",")) if (a.trim()) tecnicoPer.set(parole(a), t.id);
      }
      const clientePer = new Map(clienti.map((c) => [norm(c.nome), c.id]));
      if (creaClienti && esito.clientiMancanti.length) {
        setStato(`Creazione di ${esito.clientiMancanti.length} clienti…`);
        const { data, error } = await supabase.from("clienti").insert(esito.clientiMancanti.map((nome) => ({ nome }))).select("id, nome");
        if (error) throw error;
        for (const c of data ?? []) clientePer.set(norm(c.nome), c.id);
      }

      // 1) Rapportini di prova del gestionale nel Cestino, con i loro impianti e F-gas
      if (sostituiti.length) {
        setStato(`Rapportini del gestionale nel Cestino…`);
        const ids = sostituiti.map((x) => x.db.id);
        const adesso = new Date().toISOString();
        const { error } = await supabase.from("rapporti").update({ eliminato_il: adesso }).in("id", ids);
        if (error) throw error;
        await supabase.from("impianti").update({ eliminato_il: adesso }).in("rapporto_id", ids).is("eliminato_il", null);
        await supabase.from("fgas").update({ eliminato_il: adesso }).in("rapporto_id", ids).is("eliminato_il", null);
      }

      // 2) Rapportini di ReportOne da aggiungere
      let senzaCliente = 0, senzaTecnico = 0;
      const record = daAggiungere.map((c) => {
        const r = c.grezza;
        const nomeTec = v(r, "Tecnico").trim();
        const tecnicoId = nomeTec ? tecnicoPer.get(parole(nomeTec)) ?? null : null;
        if (nomeTec && !tecnicoId) senzaTecnico++;
        const clienteId = c.cliente ? clientePer.get(norm(c.cliente)) ?? null : null;
        if (c.cliente && !clienteId) senzaCliente++;
        const statoDoc = testo(v(r, "Stato", true));
        return {
          numero: c.numero, data: c.data ?? dataIso(new Date()), cliente_id: clienteId, tecnico_id: tecnicoId,
          tecnico_vecchio: testo(v(r, "Tecnico Vecchio")) ?? (tecnicoId ? null : testo(nomeTec)),
          ora_inizio: ora(v(r, "Ora inizio")), ora_fine: ora(v(r, "Ora fine")),
          ore_pausa: numeroIt(v(r, "Ore Pausa")), totale_ore: numeroIt(v(r, "Totale ore")), km_percorsi: numeroIt(v(r, "KM percorsi")),
          diritto_chiamata: numeroIt(v(r, "Diritto chiamata")), tariffa_fissa: numeroIt(v(r, "Tariffa fissa")), tariffa_oraria: numeroIt(v(r, "Tariffa oraria")), tariffa_km: numeroIt(v(r, "Tariffa KM")),
          iva: numeroIt(v(r, "Iva")),
          tipo_impianto: testo(v(r, "Tipo impianto")), impianto: testo(v(r, "Impianto")), marca: testo(v(r, "Marca")), modello: testo(v(r, "Modello")), matricola: testo(v(r, "Matricola")),
          rif_preventivo: testo(v(r, "Rif. Preventivo")), fatto_conto: testo(v(r, "Fatto conto")),
          stato: statoDoc && ["Aperto", "Eseguito"].includes(statoDoc) ? statoDoc : null,
          pagata: c.pagata, data_pagamento: c.dataPagamento,
          attivita: testo(v(r, "Attività svolte")), note: testo(v(r, "Note")),
          pagamento_contanti: v(r, "Pagamento in contanti").trim() === "1", azzera_imponibile: v(r, "Azzera Imponibile").trim() === "1",
          considera_totale_preventivo: v(r, "Considera totale preventivo").trim() === "1",
          imponibile: c.imponibile, totale_preventivo: numeroIt(v(r, "Totale Preventivo")) ?? 0, gimpianto: testo(v(r, "gimpianto")),
        };
      });
      for (let k = 0; k < record.length; k += 200) {
        setStato(`Aggiunta dei rapportini… ${k} di ${record.length}`);
        const { error } = await supabase.from("rapporti").insert(record.slice(k, k + 200));
        if (error) throw error;
      }

      // 3) Pagati in ReportOne: si segnano pagati (mai il contrario)
      for (const [k, p] of pagati.entries()) {
        if (k % 20 === 0) setStato(`Pagamenti… ${k} di ${pagati.length}`);
        const { error } = await supabase.from("rapporti").update({ pagata: true, ...(p.db.dataPagamento ? {} : { data_pagamento: p.csv.dataPagamento }) }).eq("id", p.db.id);
        if (error) throw error;
      }

      await registra("rapporti_importato_reportone_csv", { file: ultimoFile.current?.name, nel_cestino: sostituiti.map((x) => x.csv.numero), aggiunti: record.length, pagati: pagati.length });
      const msg = `Fatto: ${sostituiti.length} di prova nel Cestino, ${record.length} aggiunti, ${pagati.length} segnati pagati.`
        + (senzaCliente ? ` ${senzaCliente} senza cliente collegato (nome non in anagrafica).` : "")
        + (senzaTecnico ? ` ${senzaTecnico} con tecnico non riconosciuto (scritto in "Tecnico vecchio").` : "");
      onFinito?.();
      if (ultimoFile.current) await confronta(ultimoFile.current);
      setStato(msg);
    } catch (err) {
      setStato("Errore: " + (err as Error).message + " — controlla il risultato con un nuovo confronto prima di riprovare.");
    }
    setInCorso(false);
  };

  const Lato = ({ r, chi }: { r: { data: string | null; cliente: string; tecnico: string; attivita: string }; chi: string }) => (
    <div className="cr-lato"><span className="cr-chi">{chi}</span><b>{dataIt(r.data)}</b> · {r.cliente || "—"} · <span className="nome-tecnico">{r.tecnico || "—"}</span>
      <div className="piccolo">{r.attivita.slice(0, 120) || "—"}</div></div>
  );
  const sostituiti = esito ? esito.conflitti.filter((x) => usaReportOne.has(x.csv.numero)).length : 0;

  return (
    <div className="velo" onMouseDown={() => !inCorso && onChiudi()}>
      <div className="finestra finestra-storico-impianti" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">ReportOne: confronta e importa (.csv)<button type="button" className="chiudi" disabled={inCorso} onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          <p className="piccolo">Scegli l'esportazione dei <b>Rapporti di intervento</b> di ReportOne (file .csv). Prima il gestionale la confronta con i suoi rapportini <b>senza modificare niente</b>; poi scegli tu cosa importare.</p>
          <div className="barra-storico">
            <button type="button" className="btn blu" disabled={inCorso} onClick={() => fileRef.current?.click()}><FileUp size={16} /> Scegli il file .csv</button>
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) confronta(f); }} />
          </div>
          {stato && <p className={stato.startsWith("Errore") ? "errore" : "piccolo"}>{stato}</p>}
          {esito && (
            <>
              <div className="sr-riquadri cr-riquadri">
                <div className="sr-riquadro"><div className="sr-etichetta">Nuovi (non ci sono nel gestionale)</div><div className="sr-valore">{esito.nuovi.length}</div><div className="sr-nota">si possono aggiungere</div></div>
                <div className="sr-riquadro"><div className="sr-etichetta">Uguali (numero, data e cliente)</div><div className="sr-valore">{esito.uguali.length}</div><div className="sr-nota">{esito.daPagare.length} pagati in ReportOne e non qui · {esito.pagateSoloQui} pagati qui e non in ReportOne</div></div>
                <div className="sr-riquadro cr-conflitti"><div className="sr-etichetta">⚠ In conflitto</div><div className={`sr-valore${esito.conflitti.length ? " negativo" : ""}`}>{esito.conflitti.length}</div><div className="sr-nota">stesso numero, lavoro diverso</div></div>
                <div className="sr-riquadro"><div className="sr-etichetta">Solo nel gestionale</div><div className="sr-valore">{esito.soloGestionale.length}</div><div className="sr-nota">restano come sono</div></div>
              </div>

              {/* Cosa fare */}
              <div className="cr-scelte">
                <b>Cosa importare</b>
                {esito.conflitti.length > 0 && (
                  <div>Conflitti: <b>{sostituiti}</b> sostituiti con ReportOne, <b>{esito.conflitti.length - sostituiti}</b> tenuti del gestionale
                    <span className="cr-tutti"><button type="button" className="link" onClick={() => setUsaReportOne(new Set(esito.conflitti.map((x) => x.csv.numero)))}>tutti ReportOne</button> · <button type="button" className="link" onClick={() => setUsaReportOne(new Set())}>tutti gestionale</button></span></div>
                )}
                <label><input type="checkbox" checked={aggiungiNuovi} onChange={(e) => setAggiungiNuovi(e.target.checked)} /> Aggiungi i <b>{esito.nuovi.length}</b> rapportini nuovi</label>
                <label><input type="checkbox" checked={segnaPagati} onChange={(e) => setSegnaPagati(e.target.checked)} /> Segna come pagati i <b>{esito.daPagare.length}</b> rapportini già pagati in ReportOne</label>
                {esito.clientiMancanti.length > 0 && (
                  <label title={esito.clientiMancanti.join("\n")}><input type="checkbox" checked={creaClienti} onChange={(e) => setCreaClienti(e.target.checked)} /> Crea in anagrafica i <b>{esito.clientiMancanti.length}</b> clienti che non ci sono
                    <span className="piccolo"> (altrimenti quei rapportini restano senza cliente: {esito.clientiMancanti.slice(0, 4).join(", ")}{esito.clientiMancanti.length > 4 ? "…" : ""})</span></label>
                )}
                <p className="piccolo">Il CSV non contiene i materiali: i rapportini aggiunti avranno orari, attività e importi, ma non le righe dei materiali. I rapportini sostituiti vanno nel <b>Cestino</b> (recuperabili), con i loro impianti e F-gas.</p>
              </div>

              <div className="filtri-categoria pillole-sezione">
                <button type="button" className={vedi === "conflitti" ? "attiva" : ""} onClick={() => setVedi("conflitti")}>⚠ Conflitti <span className="conteggio-categoria">{esito.conflitti.length}</span></button>
                <button type="button" className={vedi === "nuovi" ? "attiva" : ""} onClick={() => setVedi("nuovi")}>Nuovi <span className="conteggio-categoria">{esito.nuovi.length}</span></button>
                <button type="button" className={vedi === "solo" ? "attiva" : ""} onClick={() => setVedi("solo")}>Solo nel gestionale <span className="conteggio-categoria">{esito.soloGestionale.length}</span></button>
              </div>
              {vedi === "conflitti" && (esito.conflitti.length ? (
                <div className="cr-elenco">
                  {esito.conflitti.map(({ csv, db, motivo }) => {
                    const ro = usaReportOne.has(csv.numero);
                    return (
                      <div key={csv.numero} className={`cr-voce${ro ? " scelto-ro" : " scelto-gest"}`}>
                        <div className="cr-numero">N. {csv.numero}<span className="piccolo"> · {motivo}</span>
                          <span className="scelta-quadro cr-scelta" role="group" aria-label={`Scelta per il n. ${csv.numero}`}>
                            <button type="button" className={ro ? "attiva" : ""} onClick={() => setUsaReportOne((s) => new Set(s).add(csv.numero))}>Usa ReportOne</button>
                            <button type="button" className={ro ? "" : "attiva"} onClick={() => setUsaReportOne((s) => { const n = new Set(s); n.delete(csv.numero); return n; })}>Tieni gestionale</button>
                          </span>
                        </div>
                        <div className={ro ? "cr-scartato" : ""}><Lato r={db} chi={ro ? "Gestionale → Cestino" : "Gestionale"} /></div>
                        <div className={ro ? "" : "cr-scartato"}><Lato r={csv} chi="ReportOne" /></div>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="vuoto-linguetta">Nessun conflitto 👍</p>)}
              {vedi === "nuovi" && (
                <table className="gt-tabella"><thead><tr><th>N.</th><th>Data</th><th>Cliente</th><th>Tecnico</th><th>Imponibile</th></tr></thead>
                  <tbody>{esito.nuovi.slice(0, 300).map((r) => <tr key={r.numero}><td>{r.numero}</td><td>{dataIt(r.data)}</td><td>{r.cliente}</td><td>{r.tecnico}</td><td>{r.imponibile.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</td></tr>)}</tbody></table>
              )}
              {vedi === "solo" && (
                <table className="gt-tabella"><thead><tr><th>N.</th><th>Data</th><th>Cliente</th><th>Tecnico</th><th>Attività</th></tr></thead>
                  <tbody>{esito.soloGestionale.slice(0, 300).map((r) => <tr key={r.id}><td>{r.numero}</td><td>{dataIt(r.data)}</td><td>{r.cliente}</td><td>{r.tecnico}</td><td>{r.attivita.slice(0, 80)}</td></tr>)}</tbody></table>
              )}
            </>
          )}
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" disabled={inCorso} onClick={onChiudi}>Chiudi</button>
          <span style={{ flex: 1 }} />
          {esito && <button type="button" className="btn blu" disabled={inCorso} onClick={importa}>{inCorso ? "Importazione…" : "Importa"}</button>}
        </div>
      </div>
    </div>
  );
}
