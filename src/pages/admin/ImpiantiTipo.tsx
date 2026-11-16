import { useCallback, useEffect, useState } from "react";
import { Package, Plus, Trash2, X } from "lucide-react";
import { supabase } from "../../supabase";
import { COMPONENTI, leggiCatalogo, leggiLavori, leggiSerie, leggiTariffe, type CategoriaLavoro, type TariffaPreventivo, type LavoroPreventivo, NOMI_TIPO, type Componente, prezzoVoce, type AmbienteTipo, type SerieCivile, type TipoImpianto, type VoceImpianto } from "../../impianti";
import CercaMateriale from "../../components/CercaMateriale";
import { materialiCategoria, useCatalogo } from "../../components/ConfiguratoreLavoro";

// Impostazioni del preventivo guidato: voci d'impianto (prezzo a punto e/o kit di materiali) e ambienti tipo.
const euro = (v: number) => v.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const numero = (s: string) => Number(s.replace(",", "."));

const NOMI_COMPONENTE: Record<Componente, string> = { supporto_3: "Supporto 3M", placca_3: "Placca 3M", supporto_4: "Supporto 4M", placca_4: "Placca 4M", copriforo: "Copriforo" };

export default function ImpiantiTipo() {
  const [tipo, setTipo] = useState<TipoImpianto>("elettrico");
  const [voci, setVoci] = useState<VoceImpianto[]>([]);
  const [ambienti, setAmbienti] = useState<AmbienteTipo[]>([]);
  const [errore, setErrore] = useState("");
  const [kitDi, setKitDi] = useState<VoceImpianto | null>(null);
  const [cercaKit, setCercaKit] = useState(false);
  const [serie, setSerie] = useState<SerieCivile[]>([]);
  const [erroreSerie, setErroreSerie] = useState("");
  const [lavori, setLavori] = useState<LavoroPreventivo[]>([]);
  const [erroreLavori, setErroreLavori] = useState("");
  const [collegaA, setCollegaA] = useState<{ serie: SerieCivile; c: Componente } | null>(null);

  const carica = useCallback(async () => {
    try {
      const c = await leggiCatalogo(tipo);
      setVoci(c.voci);
      setAmbienti(c.ambienti);
      setKitDi((k) => (k ? c.voci.find((v) => v.id === k.id) ?? null : null));
      setErrore("");
    } catch (e) { setErrore((e as Error).message); }
    leggiLavori(tipo).then((x) => { setLavori(x); setErroreLavori(""); }).catch((e) => setErroreLavori((e as Error).message));
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
      <Tariffe />

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
          <p className="piccolo">Ogni pezzo è collegato a un materiale del catalogo e ne usa il <b>prezzo di vendita</b> (se cambi il prezzo nel catalogo cambia anche qui); se non è collegato vale il prezzo scritto a mano. Prezzi a pezzo usati dal preventivo guidato per calcolare supporti e placche (uno per scatola) e copriforo (posti liberi nelle scatole).</p>
          {erroreSerie && <p className="errore">{erroreSerie}</p>}
          <table className="griglia tabella-voci">
            <thead><tr><th>Serie</th>{COMPONENTI.map((c) => <th key={c}>{NOMI_COMPONENTE[c]}</th>)}<th>Attiva</th><th /></tr></thead>
            <tbody>
              {serie.map((x) => (
                <tr key={x.id} className={x.attiva ? "" : "spenta"}>
                  <td><input defaultValue={x.nome} onBlur={(e) => e.target.value.trim() && e.target.value !== x.nome && esegui(supabase.from("serie_civili").update({ nome: e.target.value.trim() }).eq("id", x.id))} /></td>
                  {COMPONENTI.map((c) => {
                    const m = x.collegati?.[c];
                    return (
                      <td key={c} className="cella-serie">
                        {m ? (
                          <span className="materiale-serie" title={m.descrizione}>
                            <b>{euro(m.prezzo)}</b>
                            <span className="descr">{m.descrizione}</span>
                            <span className="azioni-serie">
                              <button className="link" onClick={() => setCollegaA({ serie: x, c })}>cambia</button>
                              <button className="link rosso" onClick={() => esegui(supabase.from("serie_civili").update({ [`mat_${c}`]: null }).eq("id", x.id))}>scollega</button>
                            </span>
                          </span>
                        ) : (
                          <span className="materiale-serie">
                            <span><input className="corto destra" inputMode="decimal" defaultValue={String(x[`prezzo_${c}`]).replace(".", ",")} onBlur={(e) => { const p = numero(e.target.value || "0"); if (!Number.isNaN(p) && p !== x[`prezzo_${c}`]) esegui(supabase.from("serie_civili").update({ [`prezzo_${c}`]: p }).eq("id", x.id)); }} /> €</span>
                            <button className="link" onClick={() => setCollegaA({ serie: x, c })}>🔗 dal catalogo</button>
                          </span>
                        )}
                      </td>
                    );
                  })}
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

      <Lavori tipo={tipo} lavori={lavori} errore={erroreLavori} esegui={esegui} />

      {collegaA && (
        <div className="sopra-materiali" onMouseDown={(e) => e.stopPropagation()}>
          <CercaMateriale titolo={`${NOMI_COMPONENTE[collegaA.c]} – ${collegaA.serie.nome}`} testoIniziale={`${NOMI_COMPONENTE[collegaA.c].split(" ")[0].toLowerCase()} ${collegaA.serie.nome.replace(/^(BTicino|Vimar|Gewiss) /, "")}`}
            onChiudi={() => setCollegaA(null)}
            onScegli={(m) => { esegui(supabase.from("serie_civili").update({ [`mat_${collegaA.c}`]: m.id }).eq("id", collegaA.serie.id)); setCollegaA(null); }} />
        </div>
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

// "Cosa facciamo?": lavori (Caldaia, Climatizzatore…) e le loro categorie di materiali del catalogo
function Lavori({ tipo, lavori, errore, esegui }: { tipo: TipoImpianto; lavori: LavoroPreventivo[]; errore: string; esegui: (p: PromiseLike<{ error: { message: string } | null }>) => Promise<void> }) {
  const { materiali } = useCatalogo();
  const [aperto, setAperto] = useState<number | null>(null);
  const [materialiDi, setMaterialiDi] = useState<number | null>(null);
  const categoriaAperta = lavori.flatMap((l) => l.categorie).find((c) => c.id === materialiDi) ?? null;
  const salva = (tabella: string, id: number, campi: Record<string, unknown>) => esegui(supabase.from(tabella).update(campi).eq("id", id));
  return (
    <section className="riquadro-chiamata">
      <h2>Lavori – "Cosa facciamo?"</h2>
      <p className="piccolo">Le pillole che compaiono nel preventivo guidato. Ogni lavoro ha le sue <b>categorie</b>: ognuna mostra i materiali del catalogo la cui descrizione contiene una delle parole di "Cerca" (separate da <code>|</code>, es. <code>defangat|filtro magnetico</code>) e nessuna di "Escludi". <b>Principale</b>: il materiale scelto lì (es. la caldaia) decide la marca; <b>Stessa marca</b>: mostra prima i materiali di quella marca.</p>
      {errore && <p className="errore">{errore}</p>}
      <div className="elenco-lavori">
        {lavori.map((l) => (
          <div key={l.id} className={`lavoro-admin${l.attivo ? "" : " spenta"}`}>
            <div className="testa-lavoro-admin">
              <input className="icona-lavoro" defaultValue={l.icona ?? ""} aria-label="Icona" onBlur={(e) => e.target.value !== (l.icona ?? "") && salva("lavori_preventivo", l.id, { icona: e.target.value.trim() || null })} />
              <input defaultValue={l.nome} aria-label="Nome del lavoro" onBlur={(e) => e.target.value.trim() && e.target.value !== l.nome && salva("lavori_preventivo", l.id, { nome: e.target.value.trim() })} />
              <span className="piccolo">{l.categorie.length} categorie</span>
              <label className="piccolo"><input type="checkbox" checked={l.attivo} onChange={(e) => salva("lavori_preventivo", l.id, { attivo: e.target.checked })} /> attivo</label>
              <button className="btn grigio piccolo-btn" onClick={() => setAperto(aperto === l.id ? null : l.id)}>{aperto === l.id ? "Chiudi" : "Categorie"}</button>
              <button className="link rosso" title="Elimina il lavoro" onClick={() => confirm(`Eliminare il lavoro "${l.nome}" con tutte le sue categorie?`) && esegui(supabase.from("lavori_preventivo").delete().eq("id", l.id))}><Trash2 size={15} /></button>
            </div>
            {aperto === l.id && (
              <>
                <table className="griglia tabella-voci tabella-categorie">
                  <thead><tr><th>Categoria</th><th title="Materiali scelti uno per uno dall'elenco completo">Materiali scelti</th><th title="Facoltativo: parole da cercare nella descrizione">Cerca (parole)</th><th>Escludi</th><th title="Il materiale scelto qui decide la marca">Principale</th><th title="Mostra prima i materiali della stessa marca del principale">Stessa marca</th><th>Trovati</th><th /></tr></thead>
                  <tbody>
                    {l.categorie.map((c) => (
                      <tr key={c.id}>
                        <td><input defaultValue={c.nome} onBlur={(e) => e.target.value.trim() && e.target.value !== c.nome && salva("lavori_categorie", c.id, { nome: e.target.value.trim() })} /></td>
                        <td><button className="btn blu piccolo-btn" onClick={() => setMaterialiDi(c.id)}><Package size={14} /> {c.materiali.length ? `${c.materiali.length} scelti` : "Scegli"}</button></td>
                        <td><input className="espr" defaultValue={c.cerca ?? ""} placeholder="(nessuna)" onBlur={(e) => e.target.value.trim() !== (c.cerca ?? "") && salva("lavori_categorie", c.id, { cerca: e.target.value.trim() || null })} /></td>
                        <td><input className="espr" defaultValue={c.escludi ?? ""} onBlur={(e) => e.target.value !== (c.escludi ?? "") && salva("lavori_categorie", c.id, { escludi: e.target.value.trim() || null })} /></td>
                        <td><input type="checkbox" checked={c.principale} onChange={(e) => salva("lavori_categorie", c.id, { principale: e.target.checked })} /></td>
                        <td><input type="checkbox" checked={c.segue_marca} onChange={(e) => salva("lavori_categorie", c.id, { segue_marca: e.target.checked })} /></td>
                        <td className="destra" title={materiali ? materialiCategoria(materiali, c).slice(0, 15).map((m) => String(m.descrizione)).join("\n") : ""}>{materiali ? materialiCategoria(materiali, c).length : "…"}</td>
                        <td><button className="link rosso" title="Elimina la categoria" onClick={() => esegui(supabase.from("lavori_categorie").delete().eq("id", c.id))}><X size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn blu piccolo-btn" onClick={() => {
                  const nome = prompt("Nome della categoria (es. Valvole di zona):")?.trim();
                  if (!nome) return;
                  // Nasce vuota: si apre subito la scelta dei materiali
                  supabase.from("lavori_categorie").insert({ lavoro_id: l.id, nome, cerca: null, ordine: Math.max(0, ...l.categorie.map((c) => c.ordine)) + 10 }).select("id").single()
                    .then(async ({ data, error }) => { await esegui(Promise.resolve({ error })); if (data) setMaterialiDi(Number(data.id)); });
                }}><Plus size={14} /> Nuova categoria</button>
              </>
            )}
          </div>
        ))}
      </div>
      {categoriaAperta && <MaterialiCategoria c={categoriaAperta} materiali={materiali} esegui={esegui} onChiudi={() => setMaterialiDi(null)} />}
      <button className="btn blu" onClick={() => {
        const nome = prompt("Nome del lavoro (es. Solare termico, Videocitofono):")?.trim();
        if (nome) esegui(supabase.from("lavori_preventivo").insert({ tipo, nome, ordine: Math.max(0, ...lavori.map((x) => x.ordine)) + 10 }));
      }}><Plus size={15} /> Nuovo lavoro</button>
    </section>
  );
}

// Tariffe orarie dei preventivi: in ogni sezione del foglio si sceglie quale usare
function Tariffe() {
  const [tariffe, setTariffe] = useState<TariffaPreventivo[]>([]);
  const [errore, setErrore] = useState("");
  const carica = useCallback(() => {
    leggiTariffe().then(({ tariffe: t, manca }) => { setTariffe(manca ? [] : t); setErrore(manca ? "Esegui su Supabase lo script 0035_tariffe_preventivo.sql" : ""); });
  }, []);
  useEffect(() => { carica(); }, [carica]);
  const esegui = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) setErrore(error.message.includes("duplicate") ? "Esiste già una tariffa con questo nome" : error.message);
    carica();
  };
  const salva = (id: number, campi: Record<string, unknown>) => esegui(supabase.from("tariffe_preventivo").update(campi).eq("id", id));
  return (
    <section className="riquadro-chiamata">
      <h2>Tariffe orarie</h2>
      <p className="piccolo">Le tariffe della manodopera. Nel preventivo guidato ogni sezione (Camera, Caldaia…) può usare la sua; la <b>predefinita</b> è quella proposta per quel tipo di impianto. I preventivi già fatti tengono la tariffa di quando li hai fatti.</p>
      {errore && <p className="errore">{errore}</p>}
      <table className="griglia tabella-voci">
        <thead><tr><th>Tariffa</th><th>€ / ora</th><th>Per</th><th>Predefinita</th><th>Attiva</th><th /></tr></thead>
        <tbody>
          {tariffe.map((t) => (
            <tr key={t.id} className={t.attiva ? "" : "spenta"}>
              <td><input defaultValue={t.nome} onBlur={(e) => e.target.value.trim() && e.target.value !== t.nome && salva(t.id, { nome: e.target.value.trim() })} /></td>
              <td><input className="corto destra" inputMode="decimal" defaultValue={String(t.prezzo_ora).replace(".", ",")} onBlur={(e) => { const p = numero(e.target.value || "0"); if (!Number.isNaN(p) && p !== t.prezzo_ora) salva(t.id, { prezzo_ora: p }); }} /> €</td>
              <td>
                <select value={t.tipo ?? ""} onChange={(e) => salva(t.id, { tipo: e.target.value || null })}>
                  <option value="">Tutti gli impianti</option>
                  <option value="elettrico">Elettrico</option>
                  <option value="idraulico">Idraulico</option>
                </select>
              </td>
              <td><input type="checkbox" checked={t.predefinita} onChange={async (e) => {
                // Una sola predefinita per tipo di impianto
                if (e.target.checked) {
                  const altre = tariffe.filter((x) => x.id !== t.id && x.predefinita && (x.tipo ?? "") === (t.tipo ?? "")).map((x) => x.id);
                  if (altre.length) await supabase.from("tariffe_preventivo").update({ predefinita: false }).in("id", altre);
                }
                salva(t.id, { predefinita: e.target.checked });
              }} /></td>
              <td><input type="checkbox" checked={t.attiva} onChange={(e) => salva(t.id, { attiva: e.target.checked })} /></td>
              <td><button className="link rosso" title="Elimina la tariffa" onClick={() => confirm(`Eliminare la tariffa "${t.nome}"?`) && esegui(supabase.from("tariffe_preventivo").delete().eq("id", t.id))}><Trash2 size={15} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn blu" onClick={() => {
        const nome = prompt("Nome della tariffa (es. Tecnico specializzato, Reperibilità festiva):")?.trim();
        if (!nome) return;
        const prezzo = numero(prompt(`Prezzo all'ora di "${nome}" (€):`, "35") ?? "");
        if (!Number.isNaN(prezzo)) esegui(supabase.from("tariffe_preventivo").insert({ nome, prezzo_ora: prezzo, ordine: Math.max(0, ...tariffe.map((x) => x.ordine)) + 10 }));
      }}><Plus size={15} /> Nuova tariffa</button>
    </section>
  );
}

// Materiali di una categoria scelti uno per uno dall'elenco completo del catalogo
function MaterialiCategoria({ c, materiali, esegui, onChiudi }: {
  c: CategoriaLavoro; materiali: (Record<string, unknown> & { id: number })[] | null;
  esegui: (p: PromiseLike<{ error: { message: string } | null }>) => Promise<void>; onChiudi: () => void;
}) {
  const [cerca, setCerca] = useState(false);
  const [vediTrovati, setVediTrovati] = useState(false);
  const perId = new Map((materiali ?? []).map((m) => [m.id, m]));
  const scelti = c.materiali.map((id) => perId.get(id) ?? { id, descrizione: `Materiale n. ${id}`, prezzo_ricaricato: null });
  const trovati = materiali && c.cerca ? materialiCategoria(materiali, { cerca: c.cerca, escludi: c.escludi }).filter((m) => !c.materiali.includes(m.id)) : [];
  const aggiungi = (ids: number[]) => esegui(supabase.from("lavori_categorie_materiali").upsert(
    ids.map((id, i) => ({ categoria_id: c.id, materiale_id: id, ordine: c.materiali.length + i })), { onConflict: "categoria_id,materiale_id", ignoreDuplicates: true }));
  return (
    <div className="velo" onMouseDown={onChiudi}>
      <div className="finestra finestra-materiali-categoria" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">Materiali di "{c.nome}"<button className="chiudi" onClick={onChiudi}>×</button></div>
        <div className="finestra-corpo">
          <p className="piccolo">Questi materiali compaiono nella categoria del preventivo guidato. Aggiungili dall'elenco completo con <b>Aggiungi dal catalogo</b> (puoi sceglierne tanti di seguito).</p>
          <table className="griglia tabella-voci">
            <thead><tr><th>Materiale</th><th className="destra">Prezzo</th><th /></tr></thead>
            <tbody>
              {scelti.map((m) => (
                <tr key={m.id}>
                  <td>{String(m.descrizione ?? "")}</td>
                  <td className="destra">{m.prezzo_ricaricato != null ? euro(Number(m.prezzo_ricaricato)) : ""}</td>
                  <td><button className="link rosso" title="Togli dalla categoria" onClick={() => esegui(supabase.from("lavori_categorie_materiali").delete().eq("categoria_id", c.id).eq("materiale_id", m.id))}><X size={14} /></button></td>
                </tr>
              ))}
              {!scelti.length && <tr><td colSpan={3} className="piccolo">Nessun materiale scelto.</td></tr>}
            </tbody>
          </table>
          {c.cerca && (
            <div className="trovati-parole">
              <span className="piccolo">In più, con le parole di "Cerca" la categoria trova altri <b>{materiali ? trovati.length : "…"}</b> materiali.</span>
              <button className="link" onClick={() => setVediTrovati(!vediTrovati)}>{vediTrovati ? "nascondi" : "vedi"}</button>
              {trovati.length > 0 && (
                <button className="btn grigio piccolo-btn" title="Li aggiunge ai materiali scelti e svuota Cerca: poi togli quelli che non vuoi"
                  onClick={async () => {
                    if (!confirm(`Aggiungo i ${trovati.length} materiali trovati a quelli scelti e tolgo le parole di ricerca: poi potrai togliere uno per uno quelli che non vuoi. Procedo?`)) return;
                    await aggiungi(trovati.map((m) => m.id));
                    await esegui(supabase.from("lavori_categorie").update({ cerca: null, escludi: null }).eq("id", c.id));
                  }}>Prendi questi e scegli a mano</button>
              )}
              {vediTrovati && <ul className="elenco-trovati">{trovati.map((m) => <li key={m.id}>{String(m.descrizione ?? "")} <button className="link" onClick={() => aggiungi([m.id])}>+ scegli</button></li>)}</ul>}
            </div>
          )}
        </div>
        <div className="finestra-piede">
          <button className="btn blu" onClick={() => setCerca(true)}><Plus size={15} /> Aggiungi dal catalogo</button>
          <span style={{ flex: 1 }} />
          <button className="btn grigio" onClick={onChiudi}>Fatto</button>
        </div>
      </div>
      {cerca && (
        <div className="sopra-materiali" onMouseDown={(e) => e.stopPropagation()}>
          <CercaMateriale titolo={`Materiali per "${c.nome}"`} testoIniziale={c.nome.split(/[ /]/)[0].toLowerCase()} onChiudi={() => setCerca(false)} onScegli={(m) => aggiungi([m.id])} />
        </div>
      )}
    </div>
  );
}
