import { useState } from "react";
import { Mail, MessageSquareText, X } from "lucide-react";
import type { MailFile } from "../progettiClienti";

// Accanto a un progetto o preventivo arrivato per e-mail: "Testo" mostra sotto il file il testo della mail,
// "Mail completa" apre la mail intera (mittente, destinatari, data, oggetto, testo, allegati).

const pulito = (t: string | undefined) => String(t ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
// Il testo senza le note legali in fondo (privacy, riservatezza…)
const senzaNoteLegali = (t: string) => t.split(/\n\s*(Ai sensi|Questa (e-)?mail|Confidential|Informativa|Il presente messaggio|This (e-)?mail)/i)[0].trim();

export default function MailProgetto({ mail }: { mail?: MailFile | null }) {
  const [testo, setTesto] = useState(false);
  const [completa, setCompleta] = useState(false);
  if (!mail) return null;
  const corpo = pulito(mail.testo);
  const data = mail.data ? new Date(mail.data).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "";
  return (
    <>
      {corpo && <button type="button" className={`btn grigio piccolo-btn mail-btn${testo ? " attivo" : ""}`} title="Mostra il testo della mail" onClick={() => setTesto(!testo)}>
        <MessageSquareText size={14} /> Testo
      </button>}
      <button type="button" className="btn grigio piccolo-btn mail-btn" title="Apri la mail da cui arriva il file" onClick={() => setCompleta(true)}>
        <Mail size={14} /> Mail completa
      </button>
      {testo && <div className="mail-testo">{senzaNoteLegali(corpo) || corpo}</div>}
      {completa && (
        <div className="velo" onMouseDown={() => setCompleta(false)}>
          <div className="finestra finestra-mail" onMouseDown={(e) => e.stopPropagation()}>
            <div className="finestra-titolo">{mail.oggetto || "(senza oggetto)"}
              <button type="button" className="chiudi" onClick={() => setCompleta(false)}><X size={20} /></button>
            </div>
            <div className="finestra-corpo">
              <dl className="mail-intestazione">
                <dt>Da</dt><dd>{mail.da}</dd>
                {mail.a && <><dt>A</dt><dd>{mail.a}</dd></>}
                {mail.cc && <><dt>Cc</dt><dd>{mail.cc}</dd></>}
                {data && <><dt>Data</dt><dd>{data}</dd></>}
                {!!mail.allegati?.length && <><dt>Allegati</dt><dd>{mail.allegati.join(" · ")}</dd></>}
              </dl>
              <div className="mail-corpo">{corpo || "(mail senza testo)"}</div>
            </div>
            <div className="finestra-piede"><span style={{ flex: 1 }} /><button type="button" className="btn grigio" onClick={() => setCompleta(false)}>Chiudi</button></div>
          </div>
        </div>
      )}
    </>
  );
}
