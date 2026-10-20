import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import readXlsxFile from "read-excel-file";
import writeXlsxFile from "write-excel-file";
import { registra, supabase, vuoto } from "../supabase";
import { useAuth } from "../auth";
import Griglia from "../components/Griglia";
import Scheda from "../components/Scheda";
import type { Archivio } from "../archivi";

type Riga = Record<string, unknown> & { id: number };

const normalizza = (s: unknown) => String(s ?? "").trim().toLowerCase();

// Legge tutte le righe superando il limite di 1000 per richiesta
async function leggiTutto(tabella: string) {
  const tutte: Riga[] = [];
  for (let da = 0; ; da += 1000) {
    const { data, error } = await supabase.from(tabella).select("*").order("id").range(da, da + 999);
    if (error) throw error;
    tutte.push(...(data as Riga[]));
    if (!data || data.length < 1000) return tutte;
  }
}

export default function PaginaArchivio({ cfg }: { cfg: Archivio }) {
  const { puo, profilo } = useAuth();
  const [righe, setRighe] = useState<Riga[]>([]);
  const [selezionata, setSelezionata] = useState<number | null>(null);
  const [scheda, setScheda] = useState<Record<string, unknown> | null>(null);
  const [menu, setMenu] = useState<"" | "azioni" | "archivi">("");
  const [archivio, setArchivio] = useState<{ titolo: string; tabella: string } | null>(null);
  const [messaggio, setMessaggio] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const carica = useCallback(async () => {
    try {
      setRighe(await leggiTutto(cfg.tabella));
    } catch (e) {
      setMessaggio("Errore: " + (e as Error).message);
    }
  }, [cfg.tabella]);

  useEffect(() => {
    carica();
  }, [carica]);

  const rigaSel = righe.find((r) => r.id === selezionata);

  const elimina = async () => {
    if (!rigaSel || !confirm(`Eliminare "${rigaSel[cfg.colonne[0].chiave]}"?`)) return;
    const { error } = await supabase.from(cfg.tabella).delete().eq("id", rigaSel.id);
    if (error) return setMessaggio("Errore: " + error.message);
    await registra(`${cfg.sezione}_eliminato`, { id: rigaSel.id, nome: rigaSel[cfg.colonne[0].chiave] });
    setSelezionata(null);
    setScheda(null);
    carica();
  };

  const esporta = async () => {
    const intestazione = cfg.colonne.map((c) => ({ value: c.excel, fontWeight: "bold" as const }));
    const dati = righe.map((r) => cfg.colonne.map((c) => ({ type: String, value: vuoto(r[c.chiave]) ? "" : String(r[c.chiave]) })));
    await writeXlsxFile([intestazione, ...dati], { fileName: `${cfg.titolo}.xlsx` });
    await registra(`${cfg.sezione}_esportato`, { righe: righe.length });
  };

  // Importazione dall'export Excel del programma originale: aggiorna i record esistenti (stesso nome), aggiunge i nuovi
  const importa = async (file: File) => {
    setMessaggio("Lettura del file…");
    try {
      const celle = await readXlsxFile(file);
      const indiceIntestazione = celle.findIndex((r) => r.some((v) => cfg.colonne.some((c) => normalizza(c.excel) === normalizza(v))));
      if (indiceIntestazione < 0) throw new Error("Il file non contiene le colonne attese");
      const intestazione = celle[indiceIntestazione].map(normalizza);
      const mappa = cfg.colonne
        .map((c) => ({ chiave: c.chiave, i: intestazione.indexOf(normalizza(c.excel)) }))
        .filter((m) => m.i >= 0);

      // Valori ammessi per i campi a scelta (valori sconosciuti vengono lasciati vuoti)
      const ammessi: Record<string, Set<string>> = {};
      for (const c of cfg.campi.filter((c) => c.opzioniDa)) {
        const { data } = await supabase.from(c.opzioniDa!).select("nome");
        ammessi[c.chiave] = new Set((data ?? []).map((o) => o.nome));
      }

      const record = celle
        .slice(indiceIntestazione + 1)
        .map((r) => {
          const o: Record<string, string | null> = {};
          for (const m of mappa) {
            const v = r[m.i];
            o[m.chiave] = vuoto(v) ? null : String(v).trim();
            if (ammessi[m.chiave] && o[m.chiave] && !ammessi[m.chiave].has(o[m.chiave]!)) o[m.chiave] = null;
          }
          return o;
        })
        .filter((o) => !vuoto(o[cfg.chiaveImport]));

      const esistenti = new Map(righe.map((r) => [normalizza(r[cfg.chiaveImport]), r]));
      const nuovi = record.filter((o) => !esistenti.has(normalizza(o[cfg.chiaveImport])));
      const daAggiornare = record.filter((o) => esistenti.has(normalizza(o[cfg.chiaveImport])));

      if (!confirm(`Trovate ${record.length} righe nel file:\n• ${nuovi.length} nuove da aggiungere\n• ${daAggiornare.length} già presenti da aggiornare\n\nProcedere?`)) {
        setMessaggio("");
        return;
      }

      for (let i = 0; i < nuovi.length; i += 500) {
        setMessaggio(`Importazione… ${i} / ${nuovi.length}`);
        const { error } = await supabase.from(cfg.tabella).insert(nuovi.slice(i, i + 500));
        if (error) throw error;
      }
      for (const [n, o] of daAggiornare.entries()) {
        if (n % 50 === 0) setMessaggio(`Aggiornamento… ${n} / ${daAggiornare.length}`);
        const { error } = await supabase.from(cfg.tabella).update(o).eq("id", esistenti.get(normalizza(o[cfg.chiaveImport]))!.id);
        if (error) throw error;
      }
      await registra(`${cfg.sezione}_importato`, { file: file.name, nuovi: nuovi.length, aggiornati: daAggiornare.length });
      setMessaggio(`Importazione completata: ${nuovi.length} aggiunti, ${daAggiornare.length} aggiornati`);
      carica();
    } catch (e) {
      setMessaggio("Errore: " + (e as Error).message);
    }
  };

  const voceMenu = (etichetta: string, azione: () => void, abilitata = true) =>
    abilitata && (
      <button onClick={() => { setMenu(""); azione(); }}>{etichetta}</button>
    );

  return (
    <div className="pagina-archivio" onClick={() => menu && setMenu("")}>
      <div className="testata">
        <h1>{cfg.titolo}</h1>
        <div className="pulsanti" onClick={(e) => e.stopPropagation()}>
          {puo(cfg.sezione, "creare") && <button className="btn blu" onClick={() => setScheda({})}>Nuovo</button>}
          <div className="tendina">
            <button className="btn verde" onClick={() => setMenu(menu === "azioni" ? "" : "azioni")}>Azioni <span className="punta">⌵</span></button>
            {menu === "azioni" && (
              <div className="voci">
                {voceMenu("Apri", () => rigaSel && setScheda(rigaSel), !!rigaSel)}
                {voceMenu("Elimina", elimina, !!rigaSel && puo(cfg.sezione, "eliminare"))}
                {voceMenu("Esporta in Excel", esporta, puo(cfg.sezione, "esportare"))}
                {voceMenu("Importa da Excel", () => fileRef.current?.click(), puo(cfg.sezione, "creare") && puo(cfg.sezione, "modificare"))}
                {voceMenu("Aggiorna", carica)}
              </div>
            )}
          </div>
          {cfg.archivi && profilo?.ruolo === "admin" && (
            <div className="tendina">
              <button className="btn verde" onClick={() => setMenu(menu === "archivi" ? "" : "archivi")}>Archivi <span className="punta">⌵</span></button>
              {menu === "archivi" && (
                <div className="voci">
                  {cfg.archivi.map((a) => voceMenu(a.titolo, () => setArchivio(a)))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) importa(f);
      }} />
      {messaggio && <p className={messaggio.startsWith("Errore") ? "errore" : "ok"}>{messaggio}</p>}

      <Griglia
        colonne={cfg.colonne}
        righe={righe}
        selezionata={selezionata}
        onSeleziona={setSelezionata}
        onApri={(r) => setScheda(r)}
      />

      {scheda && (
        <Scheda
          cfg={cfg}
          valori={scheda}
          onChiudi={() => setScheda(null)}
          onSalvato={(id) => { setScheda(null); setSelezionata(id); carica(); }}
          onElimina={elimina}
        />
      )}
      {archivio && <GestioneArchivio {...archivio} onChiudi={() => setArchivio(null)} />}
    </div>
  );
}

// Gestione di un archivio semplice (es. tipologie di pagamento), solo admin
function GestioneArchivio({ titolo, tabella, onChiudi }: { titolo: string; tabella: string; onChiudi: () => void }) {
  const [voci, setVoci] = useState<{ nome: string; ordine: number }[]>([]);
  const [nuova, setNuova] = useState("");
  const [errore, setErrore] = useState("");

  const carica = useCallback(async () => {
    const { data } = await supabase.from(tabella).select("*").order("ordine");
    setVoci(data ?? []);
  }, [tabella]);

  useEffect(() => {
    carica();
  }, [carica]);

  const aggiungi = async (e: FormEvent) => {
    e.preventDefault();
    const ordine = Math.max(0, ...voci.map((v) => v.ordine)) + 10;
    const { error } = await supabase.from(tabella).insert({ nome: nuova.trim(), ordine });
    if (error) return setErrore(error.message);
    setNuova("");
    carica();
  };

  const elimina = async (nome: string) => {
    if (!confirm(`Eliminare "${nome}"?`)) return;
    const { error } = await supabase.from(tabella).delete().eq("nome", nome);
    if (error) return setErrore(error.message);
    carica();
  };

  return (
    <div className="velo" onMouseDown={onChiudi}>
      <form className="finestra stretta" onSubmit={aggiungi} onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">{titolo}<button type="button" className="chiudi" onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          <table className="griglia">
            <tbody>
              {voci.map((v) => (
                <tr key={v.nome}>
                  <td>{v.nome}</td>
                  <td style={{ width: 1 }}><button type="button" className="pericolo" onClick={() => elimina(v.nome)}>Elimina</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="riga-aggiungi">
            <input value={nuova} onChange={(e) => setNuova(e.target.value)} placeholder="Nuova voce" required />
            <button className="btn blu">Aggiungi</button>
          </div>
          {errore && <p className="errore">{errore}</p>}
        </div>
      </form>
    </div>
  );
}
