import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { dataIso, dataIt, leggiTutto } from "../supabase";

// Confronto IN SOLA LETTURA tra l'esportazione CSV dei rapportini di ReportOne e i rapportini del gestionale:
// quanti sono nuovi, quanti uguali (stesso numero, data e cliente) e quanti in CONFLITTO (stesso numero ma lavoro diverso,
// perché gestionale e ReportOne hanno numerato ognuno per conto suo). Non scrive niente.

type RigaCsv = { numero: number; data: string | null; cliente: string; tecnico: string; attivita: string; imponibile: number; pagata: boolean };
type RigaDb = { id: number; numero: number; data: string | null; cliente: string; tecnico: string; attivita: string; imponibile: number; pagata: boolean; eliminato: boolean };
type Esito = {
  nuovi: RigaCsv[]; uguali: { csv: RigaCsv; db: RigaDb }[]; conflitti: { csv: RigaCsv; db: RigaDb; motivo: string }[];
  soloGestionale: RigaDb[]; pagateSoloQui: number; pagateSoloLa: number; maxCsv: number;
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
const numeroIt = (s: string) => { const n = Number(String(s ?? "").trim().replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const stessoCliente = (a: string, b: string) => { const x = norm(a), y = norm(b); return !x || !y || x === y || x.includes(y) || y.includes(x); };

export default function ConfrontaReportOne({ onChiudi }: { onChiudi: () => void }) {
  const [stato, setStato] = useState("");
  const [esito, setEsito] = useState<Esito | null>(null);
  const [vedi, setVedi] = useState<"conflitti" | "nuovi" | "solo">("conflitti");
  const fileRef = useRef<HTMLInputElement>(null);

  const confronta = async (f: File) => {
    setEsito(null);
    try {
      setStato("Lettura del file…");
      const tabella = leggiCsv(await testoFile(f));
      const h = (tabella[0] ?? []).map((x) => x.trim());
      const col = (nome: string) => h.findIndex((x) => x.toLowerCase() === nome.toLowerCase());
      const i = { numero: col("Numero"), data: col("Data"), tecnico: col("Tecnico"), vecchio: col("Tecnico Vecchio"), cliente: col("Nome cliente"), attivita: col("Attività svolte"), imponibile: col("Imponibile"), pagata: col("Pagata") };
      if (i.numero < 0 || i.data < 0) throw new Error("Il file non sembra un'esportazione dei Rapporti di intervento (mancano le colonne Numero e Data)");
      const csv: RigaCsv[] = tabella.slice(1).map((r) => ({
        numero: Number(String(r[i.numero] ?? "").trim()), data: dataIso(r[i.data]) ?? null,
        cliente: (r[i.cliente] ?? "").trim(), tecnico: ((r[i.tecnico] ?? "").trim() || (r[i.vecchio] ?? "").trim()),
        attivita: (r[i.attivita] ?? "").trim(), imponibile: numeroIt(r[i.imponibile]), pagata: (r[i.pagata] ?? "").trim() === "1",
      })).filter((r) => Number.isInteger(r.numero) && r.numero > 0);

      setStato(`Lettura dei rapportini del gestionale…`);
      const db: RigaDb[] = (await leggiTutto("rapporti", "id, numero, data, attivita, pagata, imponibile, eliminato_il, tecnico_vecchio, cliente:clienti(nome), tecnico:tecnici(nome)"))
        .filter((r) => r.numero != null)
        .map((r) => ({ id: r.id, numero: Number(r.numero), data: r.data ? String(r.data).slice(0, 10) : null, cliente: String(r.cliente ?? ""),
          tecnico: String(r.tecnico || r.tecnico_vecchio || ""), attivita: String(r.attivita ?? ""), imponibile: Number(r.imponibile) || 0, pagata: !!r.pagata, eliminato: !!r.eliminato_il }));
      const perNumero = new Map<number, RigaDb>();
      for (const r of db) if (!perNumero.has(r.numero) || perNumero.get(r.numero)!.eliminato) perNumero.set(r.numero, r);

      const e: Esito = { nuovi: [], uguali: [], conflitti: [], soloGestionale: [], pagateSoloQui: 0, pagateSoloLa: 0, maxCsv: Math.max(0, ...csv.map((r) => r.numero)) };
      for (const c of csv) {
        const d = perNumero.get(c.numero);
        if (!d) { e.nuovi.push(c); continue; }
        const dataDiversa = !!c.data && !!d.data && c.data !== d.data;
        const clienteDiverso = !stessoCliente(c.cliente, d.cliente);
        if (dataDiversa || clienteDiverso) {
          e.conflitti.push({ csv: c, db: d, motivo: [dataDiversa && "data diversa", clienteDiverso && "cliente diverso"].filter(Boolean).join(" e ") });
        } else {
          e.uguali.push({ csv: c, db: d });
          if (d.pagata && !c.pagata) e.pagateSoloQui++;
          if (!d.pagata && c.pagata) e.pagateSoloLa++;
        }
      }
      const numeriCsv = new Set(csv.map((r) => r.numero));
      e.soloGestionale = db.filter((r) => !r.eliminato && !numeriCsv.has(r.numero)).sort((a, b) => b.numero - a.numero);
      e.conflitti.sort((a, b) => b.csv.numero - a.csv.numero);
      e.nuovi.sort((a, b) => b.numero - a.numero);
      setEsito(e);
      setVedi(e.conflitti.length ? "conflitti" : "nuovi");
      setStato(`${csv.length} rapportini nel file, ${db.filter((r) => !r.eliminato).length} nel gestionale. Nessuna modifica è stata fatta.`);
    } catch (err) {
      setStato("Errore: " + (err as Error).message);
    }
  };

  const Lato = ({ r, chi }: { r: { data: string | null; cliente: string; tecnico: string; attivita: string }; chi: string }) => (
    <div className="cr-lato"><span className="cr-chi">{chi}</span><b>{dataIt(r.data)}</b> · {r.cliente || "—"} · <span className="nome-tecnico">{r.tecnico || "—"}</span>
      <div className="piccolo">{r.attivita.slice(0, 120) || "—"}</div></div>
  );

  return (
    <div className="velo" onMouseDown={onChiudi}>
      <div className="finestra finestra-storico-impianti" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Confronta con ReportOne (sola lettura)<button type="button" className="chiudi" onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          <p className="piccolo">Scegli l'esportazione dei <b>Rapporti di intervento</b> di ReportOne (file .csv). Il gestionale la confronta con i suoi rapportini e ti mostra cosa succederebbe importandola. <b>Non viene modificato niente.</b></p>
          <div className="barra-storico">
            <button type="button" className="btn blu" onClick={() => fileRef.current?.click()}><FileUp size={16} /> Scegli il file .csv</button>
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) confronta(f); }} />
          </div>
          {stato && <p className={stato.startsWith("Errore") ? "errore" : "piccolo"}>{stato}</p>}
          {esito && (
            <>
              <div className="sr-riquadri cr-riquadri">
                <div className="sr-riquadro"><div className="sr-etichetta">Nuovi (non ci sono nel gestionale)</div><div className="sr-valore">{esito.nuovi.length}</div><div className="sr-nota">si potrebbero aggiungere</div></div>
                <div className="sr-riquadro"><div className="sr-etichetta">Uguali (numero, data e cliente)</div><div className="sr-valore">{esito.uguali.length}</div><div className="sr-nota">{esito.pagateSoloLa} pagati in ReportOne e non qui · {esito.pagateSoloQui} pagati qui e non in ReportOne</div></div>
                <div className="sr-riquadro cr-conflitti"><div className="sr-etichetta">⚠ In conflitto</div><div className={`sr-valore${esito.conflitti.length ? " negativo" : ""}`}>{esito.conflitti.length}</div><div className="sr-nota">stesso numero, lavoro diverso</div></div>
                <div className="sr-riquadro"><div className="sr-etichetta">Solo nel gestionale</div><div className="sr-valore">{esito.soloGestionale.length}</div><div className="sr-nota">{esito.soloGestionale.filter((r) => r.numero > esito.maxCsv).length} con numero oltre l'ultimo di ReportOne ({esito.maxCsv})</div></div>
              </div>
              <div className="filtri-categoria pillole-sezione">
                <button type="button" className={vedi === "conflitti" ? "attiva" : ""} onClick={() => setVedi("conflitti")}>⚠ Conflitti <span className="conteggio-categoria">{esito.conflitti.length}</span></button>
                <button type="button" className={vedi === "nuovi" ? "attiva" : ""} onClick={() => setVedi("nuovi")}>Nuovi <span className="conteggio-categoria">{esito.nuovi.length}</span></button>
                <button type="button" className={vedi === "solo" ? "attiva" : ""} onClick={() => setVedi("solo")}>Solo nel gestionale <span className="conteggio-categoria">{esito.soloGestionale.length}</span></button>
              </div>
              {vedi === "conflitti" && (esito.conflitti.length ? (
                <div className="cr-elenco">
                  {esito.conflitti.map(({ csv, db, motivo }) => (
                    <div key={csv.numero} className="cr-voce">
                      <div className="cr-numero">N. {csv.numero}<span className="piccolo"> · {motivo}</span></div>
                      <Lato r={db} chi="Gestionale" />
                      <Lato r={csv} chi="ReportOne" />
                    </div>
                  ))}
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
        <div className="finestra-piede"><span style={{ flex: 1 }} /><button type="button" className="btn grigio" onClick={onChiudi}>Chiudi</button></div>
      </div>
    </div>
  );
}
