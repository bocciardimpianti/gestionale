import { useMemo, useState } from "react";
import { dataIt, leggiTutto, supabase } from "../supabase";
import { CATEGORIE_IMPIANTI, impiantiDaRapportino, type ImpiantoRilevato } from "../impiantiAuto";

// Impianti dai vecchi rapportini: si analizzano tutti i rapportini e i loro materiali, si vede che cosa verrebbe
// catalogato (Clima, Caldaie, Allarmi, Automatismi) e solo dopo si importa quello che va bene.

type Rap = Record<string, unknown> & { id: number };
type Proposta = ImpiantoRilevato & { chiave: string; rapporto: Rap; esiste: boolean };

const DETTAGLI: Record<string, [string, string][]> = {
  Caldaie: [["defangatore", "Defangatore"], ["sdoppiatore", "Sdoppiatore"], ["dosatore", "Dosatore"], ["pompe_valvole", "Pompe/valvole"],
    ["canna_fumaria_m", "Canna fumaria m"], ["canna_fumaria_sezione", "Sezione"], ["impianto_termico", "Riscaldamento"]],
  Clima: [["unita_interne", "Interne"], ["tipo_gas", "Gas"], ["gas_kg", "Kg"]],
  Allarmi: [["componenti", "Componenti"]],
  Automatismi: [["componenti", "Componenti"]],
};

export default function ImpiantiDaStorico({ onChiudi, onFinito }: { onChiudi: () => void; onFinito: () => void }) {
  const [dal, setDal] = useState("");
  const [stato, setStato] = useState("");
  const [proposte, setProposte] = useState<Proposta[] | null>(null);
  const [scelte, setScelte] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState("");
  const [inCorso, setInCorso] = useState(false);

  const analizza = async () => {
    setInCorso(true); setProposte(null);
    try {
      setStato("Lettura dei rapportini…");
      let rapporti: Rap[];
      try {
        rapporti = await leggiTutto("rapporti", "id, numero, data, cliente_id, matricola, tipo_gas, gas_aggiunto_kg, eliminato_il, cliente:clienti(nome)") as Rap[];
      } catch {
        rapporti = await leggiTutto("rapporti", "id, numero, data, cliente_id, matricola, eliminato_il, cliente:clienti(nome)") as Rap[];
      }
      rapporti = rapporti.filter((r) => !r.eliminato_il && r.cliente_id && (!dal || String(r.data ?? "") >= dal));
      setStato(`Lettura dei materiali di ${rapporti.length} rapportini…`);
      const righe = await leggiTutto("righe_rapporto", "id, rapporto_id, descrizione, quantita, unita_misura");
      const perRapporto = new Map<number, Record<string, unknown>[]>();
      for (const r of righe) { const k = Number(r.rapporto_id); perRapporto.set(k, [...(perRapporto.get(k) ?? []), r]); }
      setStato("Controllo degli impianti già catalogati…");
      const gia = new Set((await leggiTutto("impianti", "id, rapporto_id, categoria")).filter((i) => i.rapporto_id).map((i) => `${i.rapporto_id}|${i.categoria}`));
      const out: Proposta[] = [];
      for (const r of rapporti) {
        for (const imp of impiantiDaRapportino(perRapporto.get(r.id) ?? [], r)) {
          const chiave = `${r.id}|${imp.categoria}`;
          out.push({ ...imp, chiave, rapporto: r, esiste: gia.has(chiave) });
        }
      }
      out.sort((a, b) => String(b.rapporto.data ?? "").localeCompare(String(a.rapporto.data ?? "")));
      setProposte(out);
      setScelte(new Set(out.filter((p) => !p.esiste).map((p) => p.chiave)));
      setStato(`${rapporti.length} rapportini analizzati: ${out.length} impianti trovati. Controlla e togli la spunta a quelli sbagliati, poi premi Importa.`);
    } catch (e) {
      setStato("Errore: " + (e as Error).message);
    }
    setInCorso(false);
  };

  const importa = async () => {
    const da = (proposte ?? []).filter((p) => scelte.has(p.chiave));
    if (!da.length || !confirm(`Catalogare ${da.length} impianti negli Impianti dei clienti?`)) return;
    setInCorso(true);
    let fatti = 0, errori = 0, primoErrore = "";
    for (const p of da) {
      const { error } = await supabase.rpc("registra_impianto", { p_rapporto: p.rapporto.id, p_categoria: p.categoria, p_dati: p.dati });
      if (error) { errori++; primoErrore ||= error.message; } else fatti++;
      if ((fatti + errori) % 10 === 0) setStato(`Importazione… ${fatti + errori} di ${da.length}`);
    }
    setInCorso(false);
    setStato(`Fatto: ${fatti} impianti catalogati${errori ? `, ${errori} non riusciti (${/registra_impianto/.test(primoErrore) ? "esegui lo script 0046_impianti_categorie.sql" : primoErrore})` : ""}.`);
    setProposte((pp) => pp?.map((p) => (scelte.has(p.chiave) ? { ...p, esiste: true } : p)) ?? null);
    setScelte(new Set());
    onFinito();
  };

  const conteggi = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of proposte ?? []) c.set(p.categoria, (c.get(p.categoria) ?? 0) + 1);
    return c;
  }, [proposte]);
  const visibili = (proposte ?? []).filter((p) => !filtro || p.categoria === filtro);

  return (
    <div className="velo" onMouseDown={() => !inCorso && onChiudi()}>
      <div className="finestra finestra-storico-impianti" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Impianti dai vecchi rapportini<button type="button" className="chiudi" disabled={inCorso} onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          <div className="barra-storico">
            <label>Rapportini dal <input type="date" value={dal} onChange={(e) => setDal(e.target.value)} /></label>
            <span className="piccolo">{dal ? "" : "(vuoto = tutti)"}</span>
            <button type="button" className="btn blu" disabled={inCorso} onClick={analizza}>{proposte ? "Analizza di nuovo" : "Analizza"}</button>
          </div>
          {stato && <p className={stato.startsWith("Errore") ? "errore" : "piccolo"}>{stato}</p>}
          {proposte && proposte.length > 0 && (
            <>
              <div className="filtri-categoria pillole-sezione">
                <button type="button" className={filtro ? "" : "attiva"} onClick={() => setFiltro("")}>Tutti <span className="conteggio-categoria">{proposte.length}</span></button>
                {CATEGORIE_IMPIANTI.map((c) => (
                  <button type="button" key={c.nome} className={filtro === c.nome ? "attiva" : ""} style={filtro === c.nome ? { background: c.colore, borderColor: c.colore } : { borderColor: c.colore }}
                    onClick={() => setFiltro(filtro === c.nome ? "" : c.nome)}>{c.icona} {c.nome} <span className="conteggio-categoria">{conteggi.get(c.nome) ?? 0}</span></button>
                ))}
              </div>
              <div className="elenco-storico-impianti">
                <table className="griglia">
                  <thead><tr>
                    <th><input type="checkbox" checked={visibili.every((p) => scelte.has(p.chiave))} aria-label="Tutti"
                      onChange={(e) => setScelte((s) => { const n = new Set(s); for (const p of visibili) { if (e.target.checked) n.add(p.chiave); else n.delete(p.chiave); } return n; })} /></th>
                    <th>Data</th><th>Rapp.</th><th>Cliente</th><th>Categoria</th><th>Macchina</th><th>Dettagli trovati</th>
                  </tr></thead>
                  <tbody>
                    {visibili.slice(0, 500).map((p) => (
                      <tr key={p.chiave} className={p.esiste ? "gia-catalogato" : ""}>
                        <td><input type="checkbox" checked={scelte.has(p.chiave)} onChange={(e) => setScelte((s) => { const n = new Set(s); if (e.target.checked) n.add(p.chiave); else n.delete(p.chiave); return n; })} /></td>
                        <td>{dataIt(p.rapporto.data)}</td>
                        <td>{String(p.rapporto.numero ?? "")}</td>
                        <td>{String((p.rapporto.cliente as { nome?: string } | null)?.nome ?? "")}</td>
                        <td>{CATEGORIE_IMPIANTI.find((c) => c.nome === p.categoria)?.icona} {p.categoria}{p.esiste && <div className="piccolo">già catalogato</div>}</td>
                        <td className="macchina-storico">{String(p.dati.modello ?? "")}</td>
                        <td className="dettagli-storico">
                          {(DETTAGLI[p.categoria] ?? []).filter(([k]) => p.dati[k] != null && p.dati[k] !== "").map(([k, t]) => (
                            <div key={k}><b>{t}:</b> {String(p.dati[k])}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visibili.length > 500 && <p className="piccolo">Mostrati i primi 500 di {visibili.length} (si importano comunque tutti quelli spuntati).</p>}
              </div>
            </>
          )}
          {proposte && !proposte.length && <p className="vuoto-linguetta">Nessun impianto riconosciuto nei rapportini.</p>}
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" disabled={inCorso} onClick={onChiudi}>Chiudi</button>
          <span style={{ flex: 1 }} />
          {proposte && proposte.length > 0 && (
            <button type="button" className="btn blu" disabled={inCorso || !scelte.size} onClick={importa}>Importa {scelte.size} impianti</button>
          )}
        </div>
      </div>
    </div>
  );
}
