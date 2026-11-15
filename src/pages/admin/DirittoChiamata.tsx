import { useEffect, useRef, useState } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { supabase, leggiTutto } from "../../supabase";
import { AZIENDA } from "../../stampe";
import { distanzaKm, fasciaPer, leggiFasce, leggiSede, trovaPosizione, type Fascia } from "../../distanze";

// Diritto di chiamata per distanza: sede, fasce di km con il prezzo, posizione dei clienti sulla mappa.
type Cliente = { id: number; nome: string; indirizzo_fatturazione: string | null; lat: number | null; lon: number | null; geo_indirizzo: string | null; geo_precisione: string | null };

const euro = (v: number) => v.toLocaleString("it-IT", { style: "currency", currency: "EUR" });

export default function DirittoChiamata() {
  const [sede, setSede] = useState<{ lat: number; lon: number; indirizzo: string } | null>(null);
  const [indirizzoSede, setIndirizzoSede] = useState(AZIENDA.indirizzo.replace(/\s+-\s+/, ", "));
  const [fasce, setFasce] = useState<Fascia[]>([]);
  const [clienti, setClienti] = useState<Cliente[] | null>(null);
  const [messaggio, setMessaggio] = useState("");
  const [inCorso, setInCorso] = useState("");
  const ferma = useRef(false);
  const [mancaScript, setMancaScript] = useState(false);

  const carica = async () => {
    const [s, f] = await Promise.all([leggiSede(), leggiFasce()]);
    const prova = await supabase.from("fasce_chiamata").select("km_fino").limit(1);
    setMancaScript(!!prova.error);
    setSede(s);
    if (s) setIndirizzoSede(s.indirizzo);
    setFasce(f);
    try {
      setClienti((await leggiTutto("clienti", "id, nome, indirizzo_fatturazione, lat, lon, geo_indirizzo, geo_precisione", true)) as unknown as Cliente[]);
    } catch {
      setClienti([]);
    }
  };
  useEffect(() => { carica(); }, []);

  const salvaSede = async () => {
    setInCorso("sede"); setMessaggio("");
    try {
      const p = await trovaPosizione(indirizzoSede);
      if (!p) throw new Error("Indirizzo della sede non trovato sulla mappa: controlla via e comune");
      const { error } = await supabase.from("impostazioni").upsert({ chiave: "sede", valore: { lat: p.lat, lon: p.lon, indirizzo: indirizzoSede } });
      if (error) throw error;
      setSede({ lat: p.lat, lon: p.lon, indirizzo: indirizzoSede });
      setMessaggio(`Sede trovata${p.precisione === "comune" ? " (solo il comune: posizione approssimativa)" : ""}`);
    } catch (e) {
      setMessaggio("Errore: " + (e as Error).message);
    }
    setInCorso("");
  };

  const salvaFasce = async (nuove: Fascia[]) => {
    setFasce(nuove);
    const { error: e1 } = await supabase.from("fasce_chiamata").delete().gt("km_fino", 0);
    const { error: e2 } = nuove.length ? await supabase.from("fasce_chiamata").insert(nuove) : { error: null };
    setMessaggio(e1 || e2 ? "Errore: " + (e1 ?? e2)!.message : "Fasce salvate");
  };

  const generaFasce = () => {
    const fino = Number(prompt("Fasce ogni 10 km fino a quanti km?", "60"));
    if (!(fino > 0)) return;
    const vecchie = new Map(fasce.map((f) => [f.km_fino, f.importo]));
    const nuove: Fascia[] = [];
    for (let km = 10; km <= Math.ceil(fino / 10) * 10; km += 10) nuove.push({ km_fino: km, importo: vecchie.get(km) ?? 0 });
    salvaFasce(nuove);
  };

  // Posizione dei clienti senza posizione (o con l'indirizzo cambiato): una richiesta al secondo
  const calcolaPosizioni = async (anche_non_trovati = false) => {
    if (!clienti) return;
    const daFare = clienti.filter((c) => {
      const ind = (c.indirizzo_fatturazione ?? "").trim();
      if (!ind) return false;
      if (c.geo_indirizzo !== ind) return true;
      return anche_non_trovati && c.geo_precisione === "non trovato";
    });
    if (!daFare.length) return setMessaggio("Tutti i clienti con indirizzo hanno già la posizione");
    if (!confirm(`Cerco la posizione di ${daFare.length} clienti su OpenStreetMap (circa ${Math.ceil(daFare.length * 1.2 / 60)} minuti, uno al secondo).\n\nViene inviato solo l'indirizzo, non il nome. Puoi continuare a usare il gestionale in un'altra scheda.`)) return;
    ferma.current = false;
    let trovati = 0, approssimati = 0, no = 0;
    for (let i = 0; i < daFare.length; i++) {
      if (ferma.current) break;
      const c = daFare[i];
      const ind = (c.indirizzo_fatturazione ?? "").trim();
      setInCorso(`Posizione ${i + 1} di ${daFare.length}: ${c.nome}`);
      let p = null;
      try { p = await trovaPosizione(ind); } catch (e) { setMessaggio("Errore: " + (e as Error).message); break; }
      const valori = { lat: p?.lat ?? null, lon: p?.lon ?? null, geo_indirizzo: ind, geo_precisione: p?.precisione ?? "non trovato" };
      await supabase.rpc("salva_posizione_cliente", { p_id: c.id, p_lat: valori.lat, p_lon: valori.lon, p_indirizzo: ind, p_precisione: valori.geo_precisione });
      Object.assign(c, valori);
      if (!p) no++; else if (p.precisione === "comune") approssimati++; else trovati++;
      if (i % 10 === 0) setClienti([...clienti]);
    }
    setClienti([...clienti]);
    setInCorso("");
    setMessaggio(`Fatto: ${trovati} trovati con la via, ${approssimati} solo con il comune, ${no} non trovati`);
  };

  const conPosizione = clienti?.filter((c) => c.lat != null) ?? [];
  const nonTrovati = clienti?.filter((c) => c.geo_precisione === "non trovato" && c.geo_indirizzo === (c.indirizzo_fatturazione ?? "").trim()) ?? [];
  const senza = clienti?.filter((c) => (c.indirizzo_fatturazione ?? "").trim() && c.geo_indirizzo !== (c.indirizzo_fatturazione ?? "").trim()) ?? [];
  const perFascia = new Map<number, number>();
  if (sede && fasce.length) for (const c of conPosizione) {
    const f = fasciaPer(distanzaKm(sede, { lat: c.lat!, lon: c.lon! }), fasce);
    if (f) perFascia.set(f.km_fino, (perFascia.get(f.km_fino) ?? 0) + 1);
  }
  const ordinate = [...fasce].sort((a, b) => a.km_fino - b.km_fino);

  return (
    <div className="pagina-chiamata">
      <div className="testata"><h1>Diritto di chiamata</h1></div>
      <p className="piccolo">Nel rapportino, scelto il cliente, il <b>diritto di chiamata</b> si compila da solo in base alla distanza in linea d'aria tra la sede e il cliente. Lo puoi sempre correggere a mano.</p>
      {mancaScript && <p className="errore">Esegui su Supabase lo script 0029_diritto_chiamata_distanza.sql</p>}
      {messaggio && <p className={messaggio.startsWith("Errore") ? "errore" : "ok"}>{messaggio}</p>}

      <section className="riquadro-chiamata">
        <h2>1. Sede</h2>
        <div className="riga-sede">
          <input value={indirizzoSede} onChange={(e) => setIndirizzoSede(e.target.value)} placeholder="Via, numero, comune (provincia)" />
          <button className="btn blu" disabled={!!inCorso} onClick={salvaSede}><MapPin size={16} /> {sede ? "Aggiorna posizione" : "Trova posizione"}</button>
        </div>
        {sede && (
          <p className="piccolo">Posizione: {sede.lat.toFixed(5)}, {sede.lon.toFixed(5)} ·{" "}
            <a href={`https://www.openstreetmap.org/?mlat=${sede.lat}&mlon=${sede.lon}#map=16/${sede.lat}/${sede.lon}`} target="_blank" rel="noreferrer">controlla sulla mappa</a></p>
        )}
      </section>

      <section className="riquadro-chiamata">
        <h2>2. Fasce di distanza e prezzo</h2>
        <table className="griglia fasce-chiamata">
          <thead><tr><th>Distanza</th><th>Diritto di chiamata</th><th>Clienti</th><th /></tr></thead>
          <tbody>
            {ordinate.map((f, i) => (
              <tr key={f.km_fino}>
                <td>da {i ? ordinate[i - 1].km_fino : 0} a {f.km_fino} km{i === ordinate.length - 1 ? " e oltre" : ""}</td>
                <td>
                  <input type="text" inputMode="decimal" defaultValue={String(f.importo).replace(".", ",")} aria-label={`Prezzo fino a ${f.km_fino} km`}
                    onBlur={(e) => {
                      const v = Number(e.target.value.replace(",", "."));
                      if (!Number.isNaN(v) && v !== f.importo) salvaFasce(fasce.map((x) => (x.km_fino === f.km_fino ? { ...x, importo: v } : x)));
                    }} /> €
                </td>
                <td>{perFascia.get(f.km_fino) ?? 0}</td>
                <td><button className="link rosso" title="Togli questa fascia" onClick={() => salvaFasce(fasce.filter((x) => x.km_fino !== f.km_fino))}><Trash2 size={15} /></button></td>
              </tr>
            ))}
            {!ordinate.length && <tr><td colSpan={4} className="piccolo">Nessuna fascia: crea le fasce ogni 10 km.</td></tr>}
          </tbody>
        </table>
        <div className="riga-sede">
          <button className="btn blu" onClick={generaFasce}><Plus size={16} /> {ordinate.length ? "Rifai le fasce ogni 10 km" : "Crea le fasce ogni 10 km"}</button>
          <button className="btn grigio" onClick={() => {
            const km = Number(prompt("Nuova fascia: fino a quanti km?", ""));
            if (km > 0 && !fasce.some((f) => f.km_fino === km)) salvaFasce([...fasce, { km_fino: Math.round(km), importo: 0 }]);
          }}>Aggiungi una fascia</button>
        </div>
        {ordinate.length > 0 && <p className="piccolo">Esempio: un cliente a 14 km paga {euro(fasciaPer(14, fasce)?.importo ?? 0)}. Oltre l'ultima fascia vale il prezzo dell'ultima.</p>}
      </section>

      <section className="riquadro-chiamata">
        <h2>3. Posizione dei clienti</h2>
        {!clienti ? <p className="piccolo">Caricamento…</p> : (
          <>
            <p>
              <b>{conPosizione.length}</b> clienti con la posizione · <b>{senza.length}</b> da cercare · <b>{nonTrovati.length}</b> con indirizzo non trovato
            </p>
            <p className="piccolo">Le posizioni si cercano su OpenStreetMap inviando solo l'indirizzo (non il nome). Nel rapportino un cliente senza posizione viene cercato al momento, quindi questo passaggio serve solo a fare tutto subito.</p>
            {inCorso && inCorso !== "sede" ? (
              <div className="riga-sede"><span>{inCorso}</span><button className="btn grigio" onClick={() => { ferma.current = true; }}>Ferma</button></div>
            ) : (
              <div className="riga-sede">
                <button className="btn blu" disabled={!senza.length} onClick={() => calcolaPosizioni()}><MapPin size={16} /> Cerca le posizioni mancanti ({senza.length})</button>
                {nonTrovati.length > 0 && <button className="btn grigio" onClick={() => calcolaPosizioni(true)}>Riprova anche i non trovati</button>}
              </div>
            )}
            {nonTrovati.length > 0 && (
              <details>
                <summary>Indirizzi non trovati ({nonTrovati.length}): correggili nella scheda del cliente</summary>
                <ul className="non-trovati">{nonTrovati.slice(0, 300).map((c) => <li key={c.id}><b>{c.nome}</b> – {c.indirizzo_fatturazione}</li>)}</ul>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}
