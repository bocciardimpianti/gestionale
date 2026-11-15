import { useCallback, useEffect, useState } from "react";
import { Package, Plus, Trash2, X } from "lucide-react";
import { supabase } from "../../supabase";
import { leggiCatalogo, leggiSerie, NOMI_TIPO, prezzoVoce, type AmbienteTipo, type SerieCivile, type TipoImpianto, type VoceImpianto } from "../../impianti";
import CercaMateriale from "../../components/CercaMateriale";

// Impostazioni del preventivo guidato: voci d'impianto (prezzo a punto e/o kit di materiali) e ambienti tipo.
const euro = (v: number) => v.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const numero = (s: string) => Number(s.replace(",", "."));

export default function ImpiantiTipo() {
  const [tipo, setTipo] = useState<TipoImpianto>("elettrico");
  const [voci, setVoci] = useState<VoceImpianto[]>([]);
  const [ambienti, setAmbienti] = useState<AmbienteTipo[]>([]);
  const [errore, setErrore] = useState("");
  const [kitDi, setKitDi] = useState<VoceImpianto | null>(null);
  const [cercaKit, setCercaKit] = useState(false);
  const [serie, setSerie] = useState<SerieCivile[]>([]);
  const [erroreSerie, setErroreSerie] = useState("");

  const carica = useCallback(async () => {
    try {
      const c = await leggiCatalogo(tipo);
      setVoci(c.voci);
      setAmbienti(c.ambienti);
      setKitDi((k) => (k ? c.voci.find((v) => v.id === k.id) ?? null : null));
      setErrore("");
    } catch (e) { setErrore((e as Error).message); }
    if (tipo === "elettrico") leggiSerie().then((x) => { setSerie(x); setErroreSerie(""); }).catch((e) => setErroreSerie((e as Error).message));
  }, [tipo]);
  useEffect(() => { carica(); }, [carica]);

  const esegui = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) setErrore(error.message.includes("duplicate") ? "Esiste già una voce o un ambiente con questo nome" : error.message);
    await carica();
  };
  const ordineNuovo = (l: { ordine: number }[]) => Math.max(0, ...l.map((x) => x.ordine)) + 10;

  return (
    <div className="pagina-impianti">
      <div className="testata"><h1>Impianti tipo</h1></div>
      <p className="piccolo">Le <b>voci</b> (presa, interruttore, punto acqua…) con il loro <b>prezzo a punto</b>; il <b>kit di materiali</b> è facoltativo: serve per sapere cosa ordinare e, se il prezzo a punto è vuoto, il prezzo si calcola dal kit. Gli <b>ambienti tipo</b> (Cucina, Camera…) sono le stanze già pronte da inserire nel preventivo guidato.</p>
      <div className="scelta-vista-ddt tipi-impianto">
        {(Object.keys(NOMI_TIPO) as TipoImpianto[]).map((t) => (
          <button key={t} className={t === tipo ? "attiva" : ""} onClick={() => setTipo(t)}>{t === "elettrico" ? "⚡ " : "💧 "}{NOMI_TIPO[t]}</button>
        ))}
      </div>
      {errore && <p className="errore">{errore}</p>}

      <section className="riquadro-chiamata">
        <h2>Voci</h2>
        <table className="griglia tabella-voci">
          <thead><tr><th>Voce</th><th>Unità</th>{tipo === "elettrico" && <th title="Quanti posti occupa nella scatola (presa Schuko 2, interruttore 1, punto luce 0)">Moduli</th>}<th>Prezzo a punto</th><th>Kit di materiali</th><th>Attiva</th><th /></tr></thead>
          <tbody>
            {voci.map((v) => (
              <tr key={v.id} className={v.attiva ? "" : "spenta"}>
                <td><input defaultValue={v.nome} onBlur={(e) => e.target.value.trim() && e.target.value !== v.nome && esegui(supabase.from("voci_impianto").update({ nome: e.target.value.trim() }).eq("id", v.id))} /></td>
                <td><input className="corto" defaultValue={v.unita} onBlur={(e) => e.target.value !== v.unita && esegui(supabase.from("voci_impianto").update({ unita: e.target.value.trim() || "pz" }).eq("id", v.id))} /></td>
                {tipo === "elettrico" && <td><input className="corto destra" inputMode="decimal" defaultValue={String(v.moduli).replace(".", ",")}
                  onBlur={(e) => { const m = numero(e.target.value || "0"); if (!Number.isNaN(m) && m >= 0 && m !== v.moduli) esegui(supabase.from("voci_impianto").update({ moduli: m }).eq("id", v.id)); }} /></td>}
                <td>
                  <input className="corto destra" inputMode="decimal" placeholder={v.kit.length ? "dal kit" : "0,00"} defaultValue={v.prezzo === null ? "" : String(v.prezzo).replace(".", ",")}
                    onBlur={(e) => {
                      const t = e.target.value.trim();
                      const p = t === "" ? null : numero(t);
                      if (p !== null && Number.isNaN(p)) return;
                      if (p !== v.prezzo) esegui(supabase.from("voci_impianto").update({ prezzo: p }).eq("id", v.id));
                    }} /> €
                  {v.prezzo === null && <span className="piccolo"> = {euro(prezzoVoce(v))}</span>}
                </td>
                <td><button className="btn grigio piccolo-btn" onClick={() => setKitDi(v)}><Package size={14} /> {v.kit.length ? `${v.kit.length} materiali · ${euro(v.kit.reduce((t, k) => t + k.prezzo * k.quantita, 0))}` : "Aggiungi kit"}</button></td>
                <td><input type="checkbox" checked={v.attiva} onChange={(e) => esegui(supabase.from("voci_impianto").update({ attiva: e.target.checked }).eq("id", v.id))} /></td>
                <td><button className="link rosso" title="Elimina la voce" onClick={() => confirm(`Eliminare la voce "${v.nome}"? Sparisce anche dagli ambienti tipo (non dai preventivi già fatti).`) && esegui(supabase.from("voci_impianto").delete().eq("id", v.id))}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn blu" onClick={() => {
          const nome = prompt("Nome della nuova voce (es. Presa USB):")?.trim();
          if (nome) esegui(supabase.from("voci_impianto").insert({ tipo, nome, ordine: ordineNuovo(voci) }));
        }}><Plus size={15} /> Nuova voce</button>
      </section>

      <section className="riquadro-chiamata">
        <h2>Ambienti tipo</h2>
        <div className="ambienti-tipo">
          {ambienti.map((a) => {
            const totale = a.voci.reduce((t, x) => { const v = voci.find((y) => y.id === x.voce_id); return t + (v ? prezzoVoce(v) * x.quantita : 0); }, 0);
            return (
              <div key={a.id} className="carta-ambiente">
                <div className="testa-ambiente">
                  <input defaultValue={a.nome} onBlur={(e) => e.target.value.trim() && e.target.value !== a.nome && esegui(supabase.from("ambienti_tipo").update({ nome: e.target.value.trim() }).eq("id", a.id))} />
                  <button className="link rosso" title="Elimina l'ambiente" onClick={() => confirm(`Eliminare l'ambiente "${a.nome}"?`) && esegui(supabase.from("ambienti_tipo").delete().eq("id", a.id))}><Trash2 size={15} /></button>
                </div>
                {a.voci.map((x) => {
                  const v = voci.find((y) => y.id === x.voce_id);
                  return (
                    <div key={x.voce_id} className="voce-ambiente">
                      <span>{v?.nome ?? "?"}</span>
                      <input className="corto destra" inputMode="decimal" defaultValue={String(x.quantita).replace(".", ",")}
                        onBlur={(e) => { const q = numero(e.target.value); if (q > 0 && q !== x.quantita) esegui(supabase.from("ambienti_tipo_voci").update({ quantita: q }).eq("ambiente_id", a.id).eq("voce_id", x.voce_id)); }} />
                      <button className="link rosso" title="Togli" onClick={() => esegui(supabase.from("ambienti_tipo_voci").delete().eq("ambiente_id", a.id).eq("voce_id", x.voce_id))}><X size={14} /></button>
                    </div>
                  );
                })}
                <select value="" onChange={(e) => e.target.value && esegui(supabase.from("ambienti_tipo_voci").insert({ ambiente_id: a.id, voce_id: Number(e.target.value), quantita: 1 }))}>
                  <option value="">+ aggiungi voce…</option>
                  {voci.filter((v) => v.attiva && !a.voci.some((x) => x.voce_id === v.id)).map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                </select>
                {tipo === "elettrico" && (
                  <div className="voce-ambiente scatole-tipo">
                    <span>Scatole 3M / 4M</span>
                    <span className="due-input">
                      <input inputMode="numeric" defaultValue={a.scatole_3} aria-label="Scatole 3 moduli" onBlur={(e) => { const n = parseInt(e.target.value || "0", 10); if (n >= 0 && n !== a.scatole_3) esegui(supabase.from("ambienti_tipo").update({ scatole_3: n }).eq("id", a.id)); }} />
                      <input inputMode="numeric" defaultValue={a.scatole_4} aria-label="Scatole 4 moduli" onBlur={(e) => { const n = parseInt(e.target.value || "0", 10); if (n >= 0 && n !== a.scatole_4) esegui(supabase.from("ambienti_tipo").update({ scatole_4: n }).eq("id", a.id)); }} />
                    </span>
                    <span />
                  </div>
                )}
                <div className="piccolo totale-ambiente-tipo">Totale ambiente: <b>{euro(totale)}</b></div>
              </div>
            );
          })}
        </div>
        <button className="btn blu" onClick={() => {
          const nome = prompt("Nome del nuovo ambiente (es. Cameretta, Studio, Garage):")?.trim();
          if (nome) esegui(supabase.from("ambienti_tipo").insert({ tipo, nome, ordine: ordineNuovo(ambienti) }));
        }}><Plus size={15} /> Nuovo ambiente</button>
      </section>

      {tipo === "elettrico" && (
        <section className="riquadro-chiamata">
          <h2>Serie civili</h2>
          <p className="piccolo">Prezzi a pezzo usati dal preventivo guidato per calcolare supporti e placche (uno per scatola) e copriforo (posti liberi nelle scatole).</p>
          {erroreSerie && <p className="errore">{erroreSerie}</p>}
          <table className="griglia tabella-voci">
            <thead><tr><th>Serie</th><th>Supporto 3M</th><th>Placca 3M</th><th>Supporto 4M</th><th>Placca 4M</th><th>Copriforo</th><th>Attiva</th><th /></tr></thead>
            <tbody>
              {serie.map((x) => (
                <tr key={x.id} className={x.attiva ? "" : "spenta"}>
                  <td><input defaultValue={x.nome} onBlur={(e) => e.target.value.trim() && e.target.value !== x.nome && esegui(supabase.from("serie_civili").update({ nome: e.target.value.trim() }).eq("id", x.id))} /></td>
                    <td><input className="corto destra" inputMode="decimal" defaultValue={String(x.prezzo_supporto_3).replace(".", ",")} onBlur={(e) => { const p = numero(e.target.value || "0"); if (!Number.isNaN(p) && p !== x.prezzo_supporto_3) esegui(supabase.from("serie_civili").update({ prezzo_supporto_3: p }).eq("id", x.id)); }} /></td>
                    <td><input className="corto destra" inputMode="decimal" defaultValue={String(x.prezzo_placca_3).replace(".", ",")} onBlur={(e) => { const p = numero(e.target.value || "0"); if (!Number.isNaN(p) && p !== x.prezzo_placca_3) esegui(supabase.from("serie_civili").update({ prezzo_placca_3: p }).eq("id", x.id)); }} /></td>
                    <td><input className="corto destra" inputMode="decimal" defaultValue={String(x.prezzo_supporto_4).replace(".", ",")} onBlur={(e) => { const p = numero(e.target.value || "0"); if (!Number.isNaN(p) && p !== x.prezzo_supporto_4) esegui(supabase.from("serie_civili").update({ prezzo_supporto_4: p }).eq("id", x.id)); }} /></td>
                    <td><input className="corto destra" inputMode="decimal" defaultValue={String(x.prezzo_placca_4).replace(".", ",")} onBlur={(e) => { const p = numero(e.target.value || "0"); if (!Number.isNaN(p) && p !== x.prezzo_placca_4) esegui(supabase.from("serie_civili").update({ prezzo_placca_4: p }).eq("id", x.id)); }} /></td>
                    <td><input className="corto destra" inputMode="decimal" defaultValue={String(x.prezzo_copriforo).replace(".", ",")} onBlur={(e) => { const p = numero(e.target.value || "0"); if (!Number.isNaN(p) && p !== x.prezzo_copriforo) esegui(supabase.from("serie_civili").update({ prezzo_copriforo: p }).eq("id", x.id)); }} /></td>
                  <td><input type="checkbox" checked={x.attiva} onChange={(e) => esegui(supabase.from("serie_civili").update({ attiva: e.target.checked }).eq("id", x.id))} /></td>
                  <td><button className="link rosso" title="Elimina la serie" onClick={() => confirm(`Eliminare la serie "${x.nome}"?`) && esegui(supabase.from("serie_civili").delete().eq("id", x.id))}><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn blu" onClick={() => {
            const nome = prompt("Nome della serie (es. BTicino Living Now bianca):")?.trim();
            if (nome) esegui(supabase.from("serie_civili").insert({ nome, ordine: Math.max(0, ...serie.map((x) => x.ordine)) + 10 }));
          }}><Plus size={15} /> Nuova serie</button>
        </section>
      )}

      {kitDi && (
        <div className="velo" onMouseDown={() => setKitDi(null)}>
          <div className="finestra" onMouseDown={(e) => e.stopPropagation()}>
            <div className="finestra-titolo">Kit di materiali: {kitDi.nome}<button className="chiudi" onClick={() => setKitDi(null)}>×</button></div>
            <div className="finestra-corpo">
              <p className="piccolo">I materiali del magazzino che servono per una "{kitDi.nome}". Se il prezzo a punto è vuoto, la voce costa la somma del kit ({euro(kitDi.kit.reduce((t, k) => t + k.prezzo * k.quantita, 0))}).</p>
              <table className="griglia tabella-voci">
                <thead><tr><th>Materiale</th><th>Quantità</th><th>Prezzo</th><th /></tr></thead>
                <tbody>
                  {kitDi.kit.map((k) => (
                    <tr key={k.id}>
                      <td>{k.descrizione}</td>
                      <td><input className="corto destra" inputMode="decimal" defaultValue={String(k.quantita).replace(".", ",")}
                        onBlur={(e) => { const q = numero(e.target.value); if (q > 0 && q !== k.quantita) esegui(supabase.from("voci_impianto_kit").update({ quantita: q }).eq("id", k.id!)); }} /> {k.unita_misura}</td>
                      <td className="destra">{euro(k.prezzo * k.quantita)}</td>
                      <td><button className="link rosso" onClick={() => esegui(supabase.from("voci_impianto_kit").delete().eq("id", k.id!))}><X size={14} /></button></td>
                    </tr>
                  ))}
                  {!kitDi.kit.length && <tr><td colSpan={4} className="piccolo">Nessun materiale nel kit.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="finestra-piede">
              <button className="btn blu" onClick={() => setCercaKit(true)}><Plus size={15} /> Aggiungi materiale</button>
              <span style={{ flex: 1 }} />
              <button className="btn grigio" onClick={() => setKitDi(null)}>Fatto</button>
            </div>
          </div>
        </div>
      )}
      {cercaKit && kitDi && (
        <div className="sopra-materiali" onMouseDown={(e) => e.stopPropagation()}>
          <CercaMateriale chiediQuantita titolo={`Materiali per "${kitDi.nome}"`} onChiudi={() => setCercaKit(false)}
            onScegli={(m, q) => esegui(supabase.from("voci_impianto_kit").insert({ voce_id: kitDi.id, materiale_id: m.id, quantita: q ?? 1 }))} />
        </div>
      )}
    </div>
  );
}
