import { useCallback, useEffect, useState, type FormEvent } from "react";
import { adminUtenti, AZIONI, supabase, type Azione, type Permesso, type Profilo } from "../../supabase";
import { useAuth } from "../../auth";

const ETICHETTE: Record<Azione, string> = {
  vedere: "Vedere",
  creare: "Creare",
  modificare: "Modificare",
  eliminare: "Eliminare",
  esportare: "Esportare",
};

export default function Utenti() {
  const { profilo: io, sezioni } = useAuth();
  const [utenti, setUtenti] = useState<Profilo[]>([]);
  const [selezionato, setSelezionato] = useState<Profilo | null>(null);
  const [nuovo, setNuovo] = useState(false);
  const [messaggio, setMessaggio] = useState("");

  const carica = useCallback(async () => {
    const { data } = await supabase.from("profili").select("*").order("email");
    setUtenti(data ?? []);
    setSelezionato((s) => (s ? (data ?? []).find((u) => u.id === s.id) ?? null : null));
  }, []);

  useEffect(() => {
    carica();
  }, [carica]);

  const esegui = async (fn: () => Promise<unknown>, ok: string) => {
    setMessaggio("");
    try {
      await fn();
      setMessaggio(ok);
      await carica();
    } catch (e) {
      setMessaggio("Errore: " + (e as Error).message);
    }
  };

  const aggiornaProfilo = (u: Profilo, campi: Partial<Profilo>) =>
    esegui(async () => {
      const { error } = await supabase.from("profili").update(campi).eq("id", u.id);
      if (error) throw error;
    }, "Utente aggiornato");

  return (
    <>
      <div className="barra-titolo">
        <h2>Utenti e permessi</h2>
        <button className="primario" onClick={() => setNuovo(true)}>+ Nuovo utente</button>
      </div>
      {messaggio && <p className={messaggio.startsWith("Errore") ? "errore" : "ok"}>{messaggio}</p>}

      {nuovo && <NuovoUtente onChiudi={() => setNuovo(false)} onCreato={() => { setNuovo(false); carica(); }} />}

      <table className="griglia">
        <thead>
          <tr><th>Nome</th><th>Email</th><th>Ruolo</th><th>Stato</th><th></th></tr>
        </thead>
        <tbody>
          {utenti.map((u) => (
            <tr key={u.id} className={selezionato?.id === u.id ? "selezionata" : ""}>
              <td>{u.nome}</td>
              <td>{u.email}</td>
              <td>
                <select value={u.ruolo} disabled={u.id === io?.id} onChange={(e) => aggiornaProfilo(u, { ruolo: e.target.value as Profilo["ruolo"] })}>
                  <option value="admin">Admin</option>
                  <option value="standard">Standard</option>
                </select>
              </td>
              <td>
                <label className="interruttore">
                  <input type="checkbox" checked={u.attivo} disabled={u.id === io?.id} onChange={(e) => aggiornaProfilo(u, { attivo: e.target.checked })} />
                  {u.attivo ? "Attivo" : "Disattivato"}
                </label>
              </td>
              <td className="azioni">
                {u.ruolo === "standard" && <button onClick={() => setSelezionato(u)}>Permessi</button>}
                <button onClick={() => {
                  const pw = prompt(`Nuova password per ${u.email} (minimo 10 caratteri):`);
                  if (pw) esegui(() => adminUtenti("password", { id: u.id, password: pw }), "Password reimpostata");
                }}>Password</button>
                <button onClick={() => {
                  if (confirm(`Reimpostare la 2FA di ${u.email}? Al prossimo accesso dovrà configurarla di nuovo.`))
                    esegui(() => adminUtenti("reset2fa", { id: u.id }), "2FA reimpostata");
                }}>Reset 2FA</button>
                {u.id !== io?.id && (
                  <button className="pericolo" onClick={() => {
                    if (confirm(`Eliminare definitivamente ${u.email}?`))
                      esegui(() => adminUtenti("elimina", { id: u.id }), "Utente eliminato");
                  }}>Elimina</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selezionato?.ruolo === "standard" && (
        <MatricePermessi utente={selezionato} sezioni={sezioni} onChiudi={() => setSelezionato(null)} />
      )}
    </>
  );
}

function NuovoUtente({ onChiudi, onCreato }: { onChiudi: () => void; onCreato: () => void }) {
  const [dati, setDati] = useState({ nome: "", email: "", password: "", ruolo: "standard" });
  const [errore, setErrore] = useState("");

  const invia = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await adminUtenti("crea", dati);
      onCreato();
    } catch (err) {
      setErrore((err as Error).message);
    }
  };

  const campo = (k: keyof typeof dati) => ({
    value: dati[k],
    onChange: (e: { target: { value: string } }) => setDati({ ...dati, [k]: e.target.value }),
  });

  return (
    <form className="pannello" onSubmit={invia}>
      <h3>Nuovo utente</h3>
      <div className="campi">
        <label>Nome<input {...campo("nome")} required /></label>
        <label>Email<input type="email" {...campo("email")} required /></label>
        <label>Password iniziale<input type="text" minLength={10} {...campo("password")} required /></label>
        <label>Ruolo
          <select {...campo("ruolo")}>
            <option value="standard">Standard</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </div>
      <p className="piccolo">Al primo accesso l'utente dovrà attivare la verifica in due passaggi.</p>
      {errore && <p className="errore">{errore}</p>}
      <button className="primario">Crea utente</button> <button type="button" onClick={onChiudi}>Annulla</button>
    </form>
  );
}

function MatricePermessi({ utente, sezioni, onChiudi }: {
  utente: Profilo;
  sezioni: { chiave: string; etichetta: string }[];
  onChiudi: () => void;
}) {
  const [permessi, setPermessi] = useState<Record<string, Permesso>>({});
  const [salvato, setSalvato] = useState("");

  useEffect(() => {
    supabase.from("permessi").select("*").eq("utente_id", utente.id).then(({ data }) => {
      const mappa: Record<string, Permesso> = {};
      for (const s of sezioni) {
        mappa[s.chiave] = data?.find((p) => p.sezione === s.chiave) ?? {
          utente_id: utente.id, sezione: s.chiave,
          vedere: false, creare: false, modificare: false, eliminare: false, esportare: false,
        };
      }
      setPermessi(mappa);
    });
  }, [utente.id, sezioni]);

  const cambia = (sezione: string, azione: Azione, valore: boolean) => {
    setSalvato("");
    setPermessi((p) => {
      const riga = { ...p[sezione], [azione]: valore };
      // Senza "vedere" nessun'altra azione ha senso; ogni altra azione implica "vedere"
      if (azione === "vedere" && !valore) AZIONI.forEach((a) => (riga[a] = false));
      if (azione !== "vedere" && valore) riga.vedere = true;
      return { ...p, [sezione]: riga };
    });
  };

  const salva = async () => {
    const { error } = await supabase.from("permessi").upsert(Object.values(permessi));
    if (!error) await supabase.from("registro").insert({
      utente_id: (await supabase.auth.getUser()).data.user?.id,
      azione: "permessi_modificati",
      dettagli: { utente: utente.email },
    });
    setSalvato(error ? "Errore: " + error.message : "Permessi salvati");
  };

  return (
    <div className="pannello">
      <h3>Permessi di {utente.nome || utente.email}</h3>
      <table className="griglia matrice">
        <thead>
          <tr><th>Sezione</th>{AZIONI.map((a) => <th key={a}>{ETICHETTE[a]}</th>)}</tr>
        </thead>
        <tbody>
          {sezioni.map((s) => (
            <tr key={s.chiave}>
              <td>{s.etichetta}</td>
              {AZIONI.map((a) => (
                <td key={a}>
                  <input type="checkbox" checked={!!permessi[s.chiave]?.[a]} onChange={(e) => cambia(s.chiave, a, e.target.checked)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {salvato && <p className={salvato.startsWith("Errore") ? "errore" : "ok"}>{salvato}</p>}
      <button className="primario" onClick={salva}>Salva permessi</button> <button onClick={onChiudi}>Chiudi</button>
    </div>
  );
}
