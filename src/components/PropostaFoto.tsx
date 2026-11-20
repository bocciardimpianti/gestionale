import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Search, Sparkles } from "lucide-react";
import { supabase } from "../supabase";
import { riduci } from "./CampoImmagine";
import { ricercheFoto } from "../testoFoto";

// Foto automatica: cerca su internet (funzione server "cerca-foto"), propone una foto alla volta
// e con "Usa questa" la scarica, la riduce e la mette nel materiale.

type Risultato = { immagine: string; miniatura: string; titolo: string; fonte: string; larghezza?: number; altezza?: number };

// Nella vista "Senza foto": se attivo, la proposta si apre da sola anche sul materiale successivo
let proponiAncheAlSuccessivo = false;
export const proponiSubito = () => proponiAncheAlSuccessivo;

async function chiama(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("cerca-foto", { body });
  if (error) {
    const msg = await error.context?.json?.().then((j: { errore?: string }) => j.errore).catch(() => null);
    throw new Error(msg ?? (/fetch|Failed to send/i.test(error.message)
      ? "Ricerca foto non raggiungibile: va pubblicata su Supabase la funzione \"cerca-foto\""
      : error.message));
  }
  return data;
}

const dominio = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

export default function PropostaFoto({ testo, onScelta, onChiudi, fotoVeloce }: {
  testo: string;
  onScelta: (b: Blob) => void;
  onChiudi: () => void;
  fotoVeloce?: boolean;
}) {
  const [ricerca, setRicerca] = useState(testo);
  const [risultati, setRisultati] = useState<Risultato[] | null>(null);
  const [indice, setIndice] = useState(0);
  const [errore, setErrore] = useState("");
  const [scarico, setScarico] = useState(false);
  const [continua, setContinua] = useState(proponiAncheAlSuccessivo);
  // Foto che non si caricano nell'anteprima: si saltano
  const [rotte, setRotte] = useState<Set<string>>(new Set());
  const [nota, setNota] = useState("");

  const cerca = async (t: string) => {
    setRisultati(null); setErrore(""); setIndice(0); setRotte(new Set());
    try {
      // Alcuni materiali si cercano in più modi (es. raccordi multistrato con inserto blu e con inserto giallo):
      // i risultati si alternano e quelli che nel titolo citano il colore salgono in cima
      const { testi, preferisci, nota: n } = ricercheFoto(t);
      setNota(n);
      const elenchi = await Promise.all(testi.map((x) => chiama({ azione: "cerca", testo: x }).then((d) => (d as { risultati: Risultato[] }).risultati).catch((e) => { if (testi.length === 1) throw e; return [] as Risultato[]; })));
      const visti = new Set<string>();
      const uniti: Risultato[] = [];
      for (let i = 0; i < Math.max(...elenchi.map((e) => e.length)); i++) {
        for (const e of elenchi) if (e[i] && !visti.has(e[i].immagine)) { visti.add(e[i].immagine); uniti.push(e[i]); }
      }
      const r = preferisci ? [...uniti.filter((x) => preferisci.test(x.titolo)), ...uniti.filter((x) => !preferisci.test(x.titolo))] : uniti;
      setRisultati(r);
      if (!r.length) setErrore("Nessuna foto trovata: prova a cambiare le parole della ricerca");
    } catch (e) {
      setRisultati([]); setErrore((e as Error).message);
    }
  };
  useEffect(() => { cerca(testo); }, [testo]); // eslint-disable-line react-hooks/exhaustive-deps

  const validi = (risultati ?? []).filter((r) => !rotte.has(r.immagine));
  const attuale = validi[Math.min(indice, validi.length - 1)];

  const usa = async (r: Risultato) => {
    setScarico(true); setErrore("");
    // Prima la foto grande; se il sito non la dà, la miniatura del motore di ricerca
    for (const u of [r.immagine, r.miniatura]) {
      try {
        const b = await chiama({ azione: "scarica", url: u });
        if (b instanceof Blob && b.size > 500) {
          const foto = await riduci(new File([b], "foto", { type: b.type || "image/jpeg" }));
          proponiAncheAlSuccessivo = !!fotoVeloce && continua;
          setScarico(false);
          onScelta(foto);
          return;
        }
      } catch (e) {
        setErrore((e as Error).message);
      }
    }
    setScarico(false);
    setErrore("Questa foto non si riesce a scaricare: scegline un'altra");
  };

  const chiudi = () => { proponiAncheAlSuccessivo = false; onChiudi(); };

  return (
    <div className="velo" onMouseDown={(e) => { e.stopPropagation(); chiudi(); }}>
      <div className="finestra finestra-proposta-foto" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo"><Sparkles size={16} /> Foto proposta<button type="button" className="chiudi" onClick={chiudi}>×</button></div>
        <div className="finestra-corpo">
          <form className="ricerca-proposta" onSubmit={(e) => { e.preventDefault(); cerca(ricerca); }}>
            <input value={ricerca} onChange={(e) => setRicerca(e.target.value)} aria-label="Testo della ricerca" />
            <button type="submit" className="btn grigio"><Search size={14} /> Cerca</button>
          </form>
          {nota && <p className="piccolo nota-ricerca">Cerco anche con: <b>{nota}</b></p>}
          {!risultati && <p className="piccolo attesa-foto">Cerco le foto…</p>}
          {attuale && (
            <>
              <div className="foto-proposta">
                <button type="button" className="freccia" disabled={indice === 0} onClick={() => setIndice(indice - 1)} aria-label="Foto precedente"><ChevronLeft size={26} /></button>
                <img key={attuale.immagine} src={attuale.immagine} alt={attuale.titolo} referrerPolicy="no-referrer"
                  onError={(e) => {
                    // Anteprima grande non disponibile: si mostra la miniatura, e se manca anche quella si salta
                    const img = e.currentTarget;
                    if (!img.dataset.ripiego && attuale.miniatura && attuale.miniatura !== attuale.immagine) { img.dataset.ripiego = "1"; img.src = attuale.miniatura; }
                    else setRotte((s) => new Set(s).add(attuale.immagine));
                  }} />
                <button type="button" className="freccia" disabled={indice >= validi.length - 1} onClick={() => setIndice(indice + 1)} aria-label="Foto successiva"><ChevronRight size={26} /></button>
              </div>
              <div className="info-proposta piccolo">
                {indice + 1} di {validi.length} · {dominio(attuale.fonte) || dominio(attuale.immagine)}
                {attuale.larghezza ? ` · ${attuale.larghezza}×${attuale.altezza}` : ""}
                {attuale.titolo ? <> · <span title={attuale.titolo}>{attuale.titolo.slice(0, 70)}</span></> : null}
              </div>
              <div className="griglia-proposte">
                {validi.map((r, i) => (
                  <button type="button" key={r.immagine} className={i === indice ? "scelta" : ""} onClick={() => setIndice(i)}>
                    <img src={r.miniatura} alt="" referrerPolicy="no-referrer" loading="lazy" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
                  </button>
                ))}
              </div>
            </>
          )}
          {errore && <p className="errore">{errore}</p>}
        </div>
        <div className="finestra-piede">
          {fotoVeloce && <label className="piccolo riga-continua"><input type="checkbox" checked={continua} onChange={(e) => setContinua(e.target.checked)} /> Proponi subito anche per il materiale successivo</label>}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn grigio" disabled={!attuale || indice >= validi.length - 1} onClick={() => setIndice(indice + 1)}>Un'altra <ChevronRight size={15} /></button>
          <button type="button" className="btn blu" disabled={!attuale || scarico} onClick={() => attuale && usa(attuale)}>
            <Check size={16} /> {scarico ? "Scarico…" : "Usa questa"}
          </button>
        </div>
      </div>
    </div>
  );
}
