import { useState } from "react";
import { FileClock, Receipt, X } from "lucide-react";
import { euro } from "./Griglia";
import { serviziRapporto, totaliDivisi, type ChiaveServizio } from "../dividiRapportino";

// Finestra "Dividi rapportino": per ogni materiale e servizio si sceglie se va fatturato oppure se resta
// nei "Preventivi non approvati" del rapportino. Cambia solo il rapportino (le righe restano tutte lì:
// magazzino e materiali non vengono toccati); si conferma salvando il rapportino.

type Riga = Record<string, unknown>;

export default function DividiRapportino({ dati, righe, onChiudi, onApplica }: {
  dati: Record<string, unknown>; righe: Riga[];
  onChiudi: () => void;
  onApplica: (nonApprovate: boolean[], serviziNo: ChiaveServizio[]) => void;
}) {
  const [no, setNo] = useState<boolean[]>(() => righe.map((r) => !!r.non_approvato));
  const [serviziNo, setServiziNo] = useState<Set<ChiaveServizio>>(() => new Set(serviziRapporto(dati).filter((s) => s.nonApprovato).map((s) => s.chiave)));
  const servizi = serviziRapporto({ ...dati, servizi_non_approvati: [...serviziNo].join(",") });
  const t = totaliDivisi({ ...dati, servizi_non_approvati: [...serviziNo].join(",") }, righe.map((r, i) => ({ ...r, non_approvato: no[i] })));
  const valide = righe.map((r, i) => ({ r, i })).filter(({ r }) => String(r.descrizione ?? r.nome_articolo ?? "").trim() || Number(r.totale));

  const scelta = (fatturare: boolean, cambia: (f: boolean) => void) => (
    <span className="dr-scelta" role="group">
      <button type="button" className={fatturare ? "attiva fattura" : ""} onClick={() => cambia(true)}><Receipt size={15} /> Fatturare</button>
      <button type="button" className={!fatturare ? "attiva prev" : ""} onClick={() => cambia(false)}><FileClock size={15} /> Prev. non approvato</button>
    </span>
  );
  const tutto = (fatturare: boolean) => { setNo(righe.map(() => !fatturare)); setServiziNo(new Set(fatturare ? [] : servizi.map((s) => s.chiave))); };

  return (
    <div className="velo" onMouseDown={onChiudi}>
      <div className="finestra finestra-dividi" onMouseDown={(e) => e.stopPropagation()}>
        <div className="finestra-titolo">
          Dividi rapportino{dati.numero ? ` n. ${dati.numero}` : ""}
          <button type="button" className="chiudi" onClick={onChiudi}><X size={20} /></button>
        </div>
        <div className="dr-totali">
          <div className="dr-tot fattura"><span>Da fatturare</span><b>{euro(t.daFatturare) || "0,00 €"}</b></div>
          <div className="dr-tot prev"><span>Preventivi non approvati</span><b>{euro(t.nonApprovato) || "0,00 €"}</b></div>
        </div>
        <div className="finestra-corpo">
          <p className="piccolo">Scegli per ogni voce se va <b>fatturata</b> o se resta nei <b>preventivi non approvati</b> del rapportino.
            Cambia solo il rapportino: magazzino e materiali non vengono toccati.</p>
          <div className="dr-rapidi">
            <button type="button" className="link" onClick={() => tutto(true)}>Tutto da fatturare</button>
            <button type="button" className="link" onClick={() => tutto(false)}>Tutto nei preventivi non approvati</button>
          </div>
          {!!valide.length && <div className="dr-gruppo">Materiali</div>}
          {valide.map(({ r, i }) => (
            <div key={i} className={`dr-voce${no[i] ? " no" : ""}`}>
              <span className="dr-testi">
                <span className="dr-descr">{String(r.descrizione || r.nome_articolo || "Riga senza descrizione")}</span>
                <span className="piccolo">{Number(r.quantita ?? 0).toLocaleString("it-IT")} {String(r.unita_misura ?? "")}{r.prezzo_finale != null ? ` × ${euro(r.prezzo_finale)}` : ""}</span>
              </span>
              <b className="dr-importo">{euro(r.totale) || "0,00 €"}</b>
              {scelta(!no[i], (f) => setNo((v) => v.map((x, j) => (j === i ? !f : x))))}
            </div>
          ))}
          {!!servizi.length && <div className="dr-gruppo">Servizi</div>}
          {servizi.map((s) => (
            <div key={s.chiave} className={`dr-voce${serviziNo.has(s.chiave) ? " no" : ""}`}>
              <span className="dr-testi"><span className="dr-descr">{s.nome}</span>{s.dettaglio && <span className="piccolo">{s.dettaglio}</span>}</span>
              <b className="dr-importo">{euro(s.importo)}</b>
              {scelta(!serviziNo.has(s.chiave), (f) => setServiziNo((v) => { const x = new Set(v); if (f) x.delete(s.chiave); else x.add(s.chiave); return x; }))}
            </div>
          ))}
          {!valide.length && !servizi.length && <p className="vuoto-linguetta">Il rapportino non ha ancora materiali né servizi.</p>}
        </div>
        <div className="finestra-piede">
          <button type="button" className="btn grigio" onClick={onChiudi}>Annulla</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn blu" onClick={() => onApplica(no, [...serviziNo])}>Applica</button>
        </div>
      </div>
    </div>
  );
}
