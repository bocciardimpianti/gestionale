import { useCallback, useEffect, useRef, useState } from "react";
import readXlsxFile from "read-excel-file";
import writeXlsxFile from "write-excel-file";
import {
  ChevronRight, Columns3, FileDown, FileUp, Folder, FolderOpen, FolderPlus, Printer, RefreshCw,
  RotateCcw, Sheet, Trash2, Undo2,
} from "lucide-react";
import { dataIso, leggiTutto, registra, supabase, vuoto } from "../supabase";
import { useAuth } from "../auth";
import Griglia from "../components/Griglia";
import Scheda from "../components/Scheda";
import type { Archivio } from "../archivi";

type Riga = Record<string, unknown> & { id: number; archivio_id?: number | null; eliminato_il?: string | null };
type Vista = { tipo: "tutti" } | { tipo: "archivio"; id: number; nome: string } | { tipo: "cestino" };
export interface Cartella { id: number; nome: string }

const normalizza = (s: unknown) => String(s ?? "").trim().toLowerCase();
const testo = (v: unknown) => (vuoto(v) ? "" : String(v));

// Colonne nascoste, ricordate per utente su questo dispositivo
const chiaveLayout = (sezione: string) => `colonne-nascoste:${sezione}`;
function leggiNascoste(sezione: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(chiaveLayout(sezione)) ?? "[]");
  } catch {
    return [];
  }
}

export default function PaginaArchivio({ cfg }: { cfg: Archivio }) {
  const { puo, profilo } = useAuth();
  const apriNuovo = async () => {
    const base = vista.tipo === "archivio" ? { archivio_id: vista.id } : {};
    const proposti = (await cfg.valoriNuovo?.({ utenteId: profilo?.id ?? "", admin: profilo?.ruolo === "admin" })) ?? {};
    setScheda({ ...proposti, ...base });
  };
  const [righe, setRighe] = useState<Riga[]>([]);
  const [visibili, setVisibili] = useState<Riga[]>([]);
  const [cartelle, setCartelle] = useState<Cartella[]>([]);
  const [vista, setVista] = useState<Vista>({ tipo: "tutti" });
  const [selezionata, setSelezionata] = useState<number | null>(null);
  const [scheda, setScheda] = useState<Record<string, unknown> | null>(null);
  const [menu, setMenu] = useState<"" | "azioni" | "tabella" | "archivi">("");
  const [sceltaColonne, setSceltaColonne] = useState(false);
  const [nascoste, setNascoste] = useState<string[]>(() => leggiNascoste(cfg.sezione));
  const [messaggio, setMessaggio] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const carica = useCallback(async () => {
    try {
      const [tutte, { data: arch }] = await Promise.all([
        leggiTutto(cfg.tabella, cfg.select) as Promise<Riga[]>,
        supabase.from("archivi").select("id, nome").eq("sezione", cfg.sezione).order("nome"),
      ]);
      setRighe(tutte);
      setCartelle(arch ?? []);
    } catch (e) {
      setMessaggio("Errore: " + (e as Error).message);
    }
  }, [cfg.tabella, cfg.sezione]);

  useEffect(() => {
    carica();
  }, [carica]);

  const salvaNascoste = (n: string[]) => {
    setNascoste(n);
    try {
      localStorage.setItem(chiaveLayout(cfg.sezione), JSON.stringify(n));
    } catch {
      /* archiviazione locale non disponibile */
    }
  };

  const nelCestino = vista.tipo === "cestino";
  const righeVista = righe.filter((r) =>
    nelCestino ? !!r.eliminato_il : !r.eliminato_il && (vista.tipo === "tutti" || r.archivio_id === vista.id),
  );
  const colonne = cfg.colonne.filter((c) => !nascoste.includes(c.chiave));
  const rigaSel = righeVista.find((r) => r.id === selezionata);
  const nomeDi = (r: Riga) => String(r[cfg.colonne[0].chiave] ?? "");

  const aggiorna = async (id: number, campi: Record<string, unknown>, azione: string, nome: string) => {
    const { error } = await supabase.from(cfg.tabella).update(campi).eq("id", id);
    if (error) {
      setMessaggio("Errore: " + error.message);
      return false;
    }
    await registra(`${cfg.sezione}_${azione}`, { id, nome });
    await carica();
    return true;
  };

  const spostaNelCestino = async (r: Riga) => {
    if (!confirm(`Spostare "${nomeDi(r)}" nel cestino?`)) return;
    if (await aggiorna(r.id, { eliminato_il: new Date().toISOString() }, "eliminato", nomeDi(r))) {
      setSelezionata(null);
      setScheda(null);
    }
  };

  const ripristina = async (r: Riga) => {
    if (await aggiorna(r.id, { eliminato_il: null }, "ripristinato", nomeDi(r))) setSelezionata(null);
  };

  const eliminaDefinitivo = async (r: Riga) => {
    if (!confirm(`Eliminare definitivamente "${nomeDi(r)}"? L'operazione non si può annullare.`)) return;
    const { error } = await supabase.from(cfg.tabella).delete().eq("id", r.id);
    if (error) return setMessaggio("Errore: " + error.message);
    await registra(`${cfg.sezione}_eliminato_definitivamente`, { id: r.id, nome: nomeDi(r) });
    setSelezionata(null);
    carica();
  };

  const spostaInArchivio = async (r: Riga, archivio: Cartella | null) => {
    if (await aggiorna(r.id, { archivio_id: archivio?.id ?? null }, "spostato", nomeDi(r))) {
      setScheda(null);
      setMessaggio(archivio ? `"${nomeDi(r)}" spostato in ${archivio.nome}` : `"${nomeDi(r)}" tolto dall'archivio`);
    }
  };

  const nuovoArchivio = async () => {
    const nome = prompt("Nome del nuovo archivio:")?.trim();
    if (!nome) return;
    const { data, error } = await supabase.from("archivi").insert({ sezione: cfg.sezione, nome }).select("id, nome").single();
    if (error) return setMessaggio("Errore: " + error.message);
    await carica();
    setVista({ tipo: "archivio", ...data });
  };

  const eliminaArchivio = async (a: Cartella) => {
    if (!confirm(`Eliminare l'archivio "${a.nome}"? I record contenuti restano nell'elenco completo.`)) return;
    const { error } = await supabase.from("archivi").delete().eq("id", a.id);
    if (error) return setMessaggio("Errore: " + error.message);
    setVista({ tipo: "tutti" });
    carica();
  };

  const esporta = async () => {
    const intestazione = colonne.map((c) => ({ value: c.excel, fontWeight: "bold" as const }));
    const dati = visibili.map((r) => colonne.map((c) => ({ type: String, value: testo(r[c.chiave]) })));
    await writeXlsxFile([intestazione, ...dati], { fileName: `${cfg.titolo}.xlsx` });
    await registra(`${cfg.sezione}_esportato`, { righe: visibili.length });
  };

  const stampa = () => {
    const finestra = window.open("", "_blank");
    if (!finestra) return setMessaggio("Errore: il browser ha bloccato la finestra di stampa");
    const esc = (v: unknown) => testo(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    finestra.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(cfg.titolo)}</title>
      <style>body{font:11px Arial,sans-serif;margin:16px}h1{font-size:16px;margin:0 0 8px}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}
      th{background:#eee}@page{size:landscape;margin:10mm}</style></head><body>
      <h1>${esc(titoloVista)}</h1><table><thead><tr>${colonne.map((c) => `<th>${esc(c.titolo)}</th>`).join("")}</tr></thead>
      <tbody>${visibili.map((r) => `<tr>${colonne.map((c) => `<td>${esc(r[c.chiave])}</td>`).join("")}</tr>`).join("")}</tbody></table>
      <script>window.onload=()=>{window.print()}</script></body></html>`);
    finestra.document.close();
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

      const chiavi = Array.isArray(cfg.chiaveImport) ? cfg.chiaveImport : [cfg.chiaveImport];
      const chiaveDi = (o: Record<string, unknown>) => chiavi.map((k) => normalizza(o[k])).join("|");
      const colonnaDi = (k: string) => cfg.colonne.find((c) => c.chiave === k);

      const record = celle
        .slice(indiceIntestazione + 1)
        .map((r) => {
          const o: Record<string, string | null> = {};
          for (const m of mappa) {
            const v = r[m.i];
            const tipo = colonnaDi(m.chiave)?.tipo;
            (o as Record<string, unknown>)[m.chiave] =
              tipo === "data" ? dataIso(v)
              : tipo === "booleano" ? v === 1 || v === true || ["1", "si", "sì", "true", "vero"].includes(normalizza(v))
              : tipo === "euro" ? (vuoto(v) || isNaN(Number(v)) ? 0 : Math.round(Number(v) * 100) / 100)
              : vuoto(v) ? null : String(v).trim();
            if (ammessi[m.chiave] && o[m.chiave] && !ammessi[m.chiave].has(o[m.chiave]!)) o[m.chiave] = null;
          }
          return o;
        })
        .filter((o) => chiavi.some((k) => !vuoto(o[k])));

      const esistenti = new Map(righe.map((r) => [chiaveDi(r), r]));
      const idEsistente = new Map(record.map((o) => [o, esistenti.get(chiaveDi(o))?.id]));

      // Colonne collegate (es. Cliente): il nome viene trasformato nell'id del record collegato
      let nonTrovati = 0;
      for (const c of cfg.colonne.filter((c) => c.riferimento && mappa.some((m) => m.chiave === c.chiave))) {
        const collegati = await leggiTutto(c.riferimento!.tabella, "id, nome");
        const perNome = new Map(collegati.map((r) => [normalizza(r.nome), r.id]));
        // Nomi non presenti: si propone di crearli, per non perdere il collegamento
        const mancanti = [...new Map(record
          .map((o) => o[c.chiave])
          .filter((nome): nome is string => !!nome && !perNome.has(normalizza(nome)))
          .map((nome) => [normalizza(nome), nome.trim()])).values()];
        if (mancanti.length && confirm(
          `${mancanti.length} nomi della colonna "${c.titolo}" non sono presenti in ${c.riferimento!.tabella}:\n` +
          mancanti.slice(0, 15).join("\n") + (mancanti.length > 15 ? "\n…" : "") +
          `\n\nVuoi crearli automaticamente?`,
        )) {
          const { data, error } = await supabase.from(c.riferimento!.tabella).insert(mancanti.map((nome) => ({ nome }))).select("id, nome");
          if (error) throw error;
          for (const r of data ?? []) perNome.set(normalizza(r.nome), r.id);
        }
        for (const o of record) {
          const nome = o[c.chiave];
          const id = nome ? perNome.get(normalizza(nome)) : undefined;
          if (nome && id === undefined) nonTrovati++;
          (o as Record<string, unknown>)[c.riferimento!.campo] = id ?? null;
          delete o[c.chiave];
        }
      }

      const nuovi = record.filter((o) => idEsistente.get(o) === undefined);
      const daAggiornare = record.filter((o) => idEsistente.get(o) !== undefined);
      const avviso = nonTrovati ? `\n\nAttenzione: ${nonTrovati} righe fanno riferimento a nomi non presenti in anagrafica e resteranno senza collegamento.` : "";

      if (!confirm(`Trovate ${record.length} righe nel file:\n• ${nuovi.length} nuove da aggiungere\n• ${daAggiornare.length} già presenti da aggiornare${avviso}\n\nProcedere?`)) {
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
        const { error } = await supabase.from(cfg.tabella).update(o).eq("id", idEsistente.get(o)!);
        if (error) throw error;
      }
      await registra(`${cfg.sezione}_importato`, { file: file.name, nuovi: nuovi.length, aggiornati: daAggiornare.length });
      setMessaggio(`Importazione completata: ${nuovi.length} aggiunti, ${daAggiornare.length} aggiornati`);
      carica();
    } catch (e) {
      setMessaggio("Errore: " + (e as Error).message);
    }
  };

  const voce = (Icona: typeof RefreshCw, colore: string, etichetta: string, azione: () => void, abilitata = true, freccia = false) =>
    abilitata && (
      <button
        key={etichetta}
        onClick={(e) => {
          if (freccia) {
            e.stopPropagation();
            setMenu(menu === "tabella" ? "azioni" : "tabella");
            return;
          }
          setMenu("");
          azione();
        }}
      >
        <Icona size={22} strokeWidth={1.6} color={colore} />
        <span>{etichetta}</span>
        {freccia && <ChevronRight size={14} className="freccia-sotto" />}
      </button>
    );

  const titoloVista =
    vista.tipo === "cestino" ? `${cfg.titolo} - Cestino` : vista.tipo === "archivio" ? `${cfg.titolo} - ${vista.nome}` : cfg.titolo;

  return (
    <div className="pagina-archivio" onClick={() => menu && setMenu("")}>
      <div className="testata">
        <h1>{titoloVista}</h1>
        <div className="pulsanti" onClick={(e) => e.stopPropagation()}>
          {puo(cfg.sezione, "creare") && !nelCestino && (
            <button className="btn blu" onClick={apriNuovo}>Nuovo</button>
          )}
          <div className="tendina">
            <button className="btn verde" onClick={() => setMenu(menu ? "" : "azioni")}>Azioni <span className="punta">⌵</span></button>
            {(menu === "azioni" || menu === "tabella") && (
              <div className="voci con-icone">
                {voce(RefreshCw, "#b59b1b", "Aggiorna", carica)}
                {voce(Sheet, "#4a8a3a", "Tabella", () => {}, true, true)}
                {voce(FileDown, "#3a8a3a", "Esporta", esporta, puo(cfg.sezione, "esportare"))}
                {voce(Printer, "#444", "Stampa", stampa, puo(cfg.sezione, "esportare"))}
                {nelCestino && rigaSel && voce(Undo2, "#3a7dc0", "Ripristina", () => ripristina(rigaSel), puo(cfg.sezione, "eliminare"))}
                {nelCestino && rigaSel && voce(Trash2, "#d9342b", "Elimina definitivamente", () => eliminaDefinitivo(rigaSel), puo(cfg.sezione, "eliminare"))}
                {menu === "tabella" && (
                  <div className="voci con-icone sottomenu" onClick={(e) => e.stopPropagation()}>
                    {voce(Columns3, "#3a7dc0", "Scegli colonne", () => setSceltaColonne(true))}
                    {voce(RotateCcw, "#666", "Ripristina colonne", () => salvaNascoste([]))}
                    {voce(FileUp, "#3a8a3a", "Importa da Excel", () => fileRef.current?.click(),
                      !nelCestino && puo(cfg.sezione, "creare") && puo(cfg.sezione, "modificare"))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="tendina">
            <button className="btn verde" onClick={() => setMenu(menu === "archivi" ? "" : "archivi")}>Archivi <span className="punta">⌵</span></button>
            {menu === "archivi" && (
              <div className="voci con-icone">
                {voce(Folder, "#f5a623", "Elenco completo", () => setVista({ tipo: "tutti" }))}
                {cartelle.map((a) => voce(FolderOpen, "#f5a623", a.nome, () => setVista({ tipo: "archivio", ...a })))}
                {voce(FolderPlus, "#3a7dc0", "Nuovo Archivio", nuovoArchivio, puo(cfg.sezione, "modificare"))}
                {vista.tipo === "archivio" &&
                  voce(Trash2, "#d9342b", `Elimina archivio "${vista.nome}"`, () => eliminaArchivio(vista), puo(cfg.sezione, "eliminare"))}
                {voce(Trash2, "#666", "Cestino", () => setVista({ tipo: "cestino" }), puo(cfg.sezione, "eliminare"))}
              </div>
            )}
          </div>
        </div>
      </div>

      <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) importa(f);
      }} />
      {messaggio && <p className={messaggio.startsWith("Errore") ? "errore" : "ok"}>{messaggio}</p>}

      <Griglia
        key={vista.tipo + (vista.tipo === "archivio" ? vista.id : "")}
        colonne={colonne}
        righe={righeVista}
        selezionata={selezionata}
        onSeleziona={setSelezionata}
        onApri={(r) => setScheda(r)}
        onVisibili={setVisibili}
        ordineIniziale={cfg.ordineIniziale}
      />

      {scheda && (
        <Scheda
          cfg={cfg}
          valori={scheda}
          cartelle={cartelle}
          nelCestino={nelCestino}
          onChiudi={() => setScheda(null)}
          onSalvato={(id) => { setScheda(null); setSelezionata(id); carica(); }}
          onElimina={() => spostaNelCestino(scheda as Riga)}
          onSposta={(a) => spostaInArchivio(scheda as Riga, a)}
        />
      )}

      {sceltaColonne && (
        <div className="velo" onMouseDown={() => setSceltaColonne(false)}>
          <div className="finestra stretta" onMouseDown={(e) => e.stopPropagation()}>
            <div className="finestra-titolo">Colonne visibili<button className="chiudi" onClick={() => setSceltaColonne(false)}>×</button></div>
            <div className="finestra-corpo elenco-colonne">
              {cfg.colonne.map((c) => (
                <label key={c.chiave} className="interruttore">
                  <input
                    type="checkbox"
                    checked={!nascoste.includes(c.chiave)}
                    onChange={(e) => salvaNascoste(e.target.checked ? nascoste.filter((n) => n !== c.chiave) : [...nascoste, c.chiave])}
                  />
                  {c.titolo}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
