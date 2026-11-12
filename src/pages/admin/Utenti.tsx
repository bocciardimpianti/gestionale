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

export const MANSIONI = ["Titolare", "Tecnico", "Commerciale", "Amministrativo", "Magazzino"];
type Livello = "V" | "VC" | "VCM" | "VCME" | "tutto";
const AZIONI_DI: Record<Livello, Azione[]> = {
  V: ["vedere"], VC: ["vedere", "creare"], VCM: ["vedere", "creare", "modificare"],
  VCME: ["vedere", "creare", "modificare", "esportare"], tutto: ["vedere", "creare", "modificare", "eliminare", "esportare"],
};
// Permessi tipici di ogni mansione (proposti scegliendo la mansione di un utente standard, poi modificabili)
const PERMESSI_TIPICI: Record<string, Record<string, Livello>> = {
  Tecnico: { home: "V", clienti: "VC", impianti: "VCM", rapporti: "VCM", agenda: "V", richieste: "V", materiali: "V" },
  Commerciale: { home: "V", clienti: "VCM", impianti: "V", rapporti: "V", agenda: "V", preventivi: "VCME", richieste: "VCM", materiali: "V" },
  Amministrativo: {
    home: "V", clienti: "VCME", fornitori: "VCME", tecnici: "VCM", impianti: "VCM", rapporti: "VCME", agenda: "V", preventivi: "VCME",
    richieste: "VCM", ddt_acquisto: "VCME", materiali: "VCME", scadenziario: "VCME", conti_clienti: "VCME",
  },
  Magazzino: { home: "V", fornitori: "V", rapporti: "V", ddt_acquisto: "VCM", materiali: "VCME" },
  Titolare: Object.fromEntries(["home", "clienti", "fornitori", "tecnici", "impianti", "rapporti", "agenda", "preventivi", "richieste", "ddt_acquisto", "materiali", "scadenziario", "conti_clienti"].map((k) => [k, "tutto" as Livello])),
};

// Parole di un nome in ordine (per abbinare "Michael Gronchi" a "Gronchi Michael")
const paroleNome = (t: unknown) => String(t ?? "").toLowerCase().split(/[^a-zà-ú]+/).filter((w) => w.length >= 2).sort().join(" ");

export default function Utenti() {
  const { profilo: io, sezioni } = useAuth();
  const [utenti, setUtenti] = useState<Profilo[]>([]);
  const [selezionato, setSelezionato] = useState<Profilo | null>(null);
  const [nuovo, setNuovo] = useState(false);
  const [inModifica, setInModifica] = useState<Profilo | null>(null);
  const [messaggio, setMessaggio] = useState("");
  // Tecnici collegati agli utenti (chi "fa interventi" compare nei rapportini, prende in carico le richieste, riceve le notifiche)
  const [tecnici, setTecnici] = useState<{ id: number; nome: string; utente_id: string | null }[]>([]);

  const carica = useCallback(async () => {
    const [{ data }, { data: tec }] = await Promise.all([
      supabase.from("profili").select("*").order("email"),
      supabase.from("tecnici").select("id, nome, utente_id").is("eliminato_il", null).order("nome"),
    ]);
    setTecnici(tec ?? []);
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

  // "Fa interventi": collega l'utente al tecnico con lo stesso nome, oppure crea il tecnico; togliendo la spunta lo scollega
  const impostaTecnico = (u: Profilo, attivo: boolean) =>
    esegui(async () => {
      if (!attivo) {
        const { error } = await supabase.from("tecnici").update({ utente_id: null }).eq("utente_id", u.id);
        if (error) throw error;
        return;
      }
      if (tecnici.some((t) => t.utente_id === u.id)) return;
      const nome = u.nome || u.email;
      const libero = tecnici.find((t) => !t.utente_id && paroleNome(t.nome) === paroleNome(nome));
      if (libero) {
        const { error } = await supabase.from("tecnici").update({ utente_id: u.id }).eq("id", libero.id);
        if (error) throw error;
      } else {
        const scelto = prompt(`Nome del tecnico per ${u.email} (come comparirà nei rapportini e in agenda):`, nome);
        if (!scelto?.trim()) return;
        const esistente = tecnici.find((t) => !t.utente_id && paroleNome(t.nome) === paroleNome(scelto));
        const { error } = esistente
          ? await supabase.from("tecnici").update({ utente_id: u.id }).eq("id", esistente.id)
          : await supabase.from("tecnici").insert({ nome: scelto.trim(), utente_id: u.id });
        if (error) throw error;
      }
    }, attivo ? "Utente collegato come tecnico" : "Utente non più tecnico (lo storico dei suoi rapportini resta)");

  // Mansione: per un utente standard si propongono i permessi tipici
  const impostaMansione = (u: Profilo, mansione: string) =>
    esegui(async () => {
      const { error } = await supabase.from("profili").update({ mansione: mansione || null }).eq("id", u.id);
      if (error) throw error;
      if (u.ruolo === "standard" && PERMESSI_TIPICI[mansione] && confirm(`Applicare a ${u.nome || u.email} i permessi tipici di "${mansione}"?\n\nPotrai modificarli dopo con il pulsante Permessi.`)) {
        const righe = sezioni.map((s) => {
          const consentite = AZIONI_DI[PERMESSI_TIPICI[mansione][s.chiave]] ?? [];
          return { utente_id: u.id, sezione: s.chiave, ...Object.fromEntries(AZIONI.map((a) => [a, consentite.includes(a)])) };
        });
        const { error: e2 } = await supabase.from("permessi").upsert(righe);
        if (e2) throw e2;
      }
      if (mansione === "Tecnico" && !tecnici.some((t) => t.utente_id === u.id) && confirm(`${u.nome || u.email} fa interventi? Verrà collegato come tecnico (rapportini, presa in carico delle richieste, notifiche).`)) {
        await impostaTecnico(u, true);
      }
    }, "Mansione salvata");

  const aggiornaProfilo = (u: Profilo, campi: Partial<Profilo>) =>
    esegui(async () => {
      const { error } = await supabase.from("profili").update(campi).eq("id", u.id);
      if (error) throw error;
    }, "Utente aggiornato");

  return (
    <>
      <div className="barra-titolo">
        <h2>Utenti, permessi e tecnici</h2>
        <button className="primario" onClick={() => setNuovo(true)}>+ Nuovo utente</button>
      </div>
      {messaggio && <p className={messaggio.startsWith("Errore") ? "errore" : "ok"}>{messaggio}</p>}

      {inModifica && (
        <ModificaUtente utente={inModifica} onChiudi={() => setInModifica(null)}
          onSalvato={(m) => { setInModifica(null); setMessaggio(m); carica(); }} />
      )}
      {nuovo && <NuovoUtente sezioni={sezioni} tecnici={tecnici} onChiudi={() => setNuovo(false)}
        onCreato={(avvisi) => { setNuovo(false); setMessaggio(avvisi.length ? "Errore: utente creato, ma " + avvisi.join("; ") : "Utente creato"); carica(); }} />}

      <table className="griglia">
        <thead>
          <tr><th>Nome</th><th>Email</th><th>Ruolo</th><th>Mansione</th><th>Fa interventi (tecnico)</th><th>Stato</th><th>WhatsApp</th><th>Totali</th><th></th></tr>
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
                <select value={u.mansione ?? ""} onChange={(e) => impostaMansione(u, e.target.value)}>
                  <option value="">—</option>
                  {MANSIONI.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </td>
              <td>
                {(() => {
                  const t = tecnici.find((x) => x.utente_id === u.id);
                  return (
                    <label className="interruttore" title="Compare nei rapportini e in agenda, prende in carico le richieste, riceve le notifiche">
                      <input type="checkbox" checked={!!t} onChange={(e) => impostaTecnico(u, e.target.checked)} />
                      {t ? t.nome : "No"}
                    </label>
                  );
                })()}
              </td>
              <td>
                <label className="interruttore">
                  <input type="checkbox" checked={u.attivo} disabled={u.id === io?.id} onChange={(e) => aggiornaProfilo(u, { attivo: e.target.checked })} />
                  {u.attivo ? "Attivo" : "Disattivato"}
                </label>
              </td>
              <td>
                <label className="interruttore">
                  <input type="checkbox" checked={u.ruolo === "admin" || !!u.whatsapp} disabled={u.ruolo === "admin"}
                    onChange={(e) => aggiornaProfilo(u, { whatsapp: e.target.checked })} />
                  {u.ruolo === "admin" ? "Sempre" : u.whatsapp ? "Sì" : "No"}
                </label>
              </td>
              <td>
                <label className="interruttore" title="Vede totali dei documenti, imponibili e importi (i prezzi dei materiali li vedono tutti)">
                  <input type="checkbox" checked={u.ruolo === "admin" || !!u.prezzi} disabled={u.ruolo === "admin"}
                    onChange={(e) => aggiornaProfilo(u, { prezzi: e.target.checked })} />
                  {u.ruolo === "admin" ? "Sempre" : u.prezzi ? "Visibili" : "Nascosti"}
                </label>
              </td>
              <td className="azioni">
                <button onClick={() => { setNuovo(false); setInModifica(u); }}>Modifica</button>
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

function NuovoUtente({ sezioni, tecnici, onChiudi, onCreato }: {
  sezioni: { chiave: string }[];
  tecnici: { id: number; nome: string; utente_id: string | null }[];
  onChiudi: () => void;
  onCreato: (avvisi: string[]) => void;
}) {
  const [dati, setDati] = useState({ nome: "", email: "", password: "", ruolo: "standard" });
  const [whatsapp, setWhatsapp] = useState(false);
  const [prezzi, setPrezzi] = useState(false);
  const [mansione, setMansione] = useState("");
  const [faInterventi, setFaInterventi] = useState(false);
  const [errore, setErrore] = useState("");

  const invia = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const creato = await adminUtenti("crea", dati) as { id?: string } | null;
      // Utente creato: i passaggi successivi vanno avanti anche se uno non riesce (gli avvisi compaiono nell'elenco)
      const avvisi: string[] = [];
      const id = creato?.id;
      if (id && whatsapp && dati.ruolo === "standard") {
        const { error } = await supabase.from("profili").update({ whatsapp: true }).eq("id", id);
        if (error) avvisi.push(`il permesso WhatsApp non è stato salvato (${error.message})`);
      }
      if (id && prezzi && dati.ruolo === "standard") {
        const { error } = await supabase.from("profili").update({ prezzi: true }).eq("id", id);
        if (error) avvisi.push(`il permesso Totali non è stato salvato (esegui su Supabase lo script 0024_prezzi_utenti.sql: ${error.message})`);
      }
      if (id && mansione) {
        const { error } = await supabase.from("profili").update({ mansione }).eq("id", id);
        if (error) avvisi.push(/mansione/.test(error.message) ? "la mansione non è stata salvata: esegui su Supabase lo script 0023_mansioni_utenti.sql" : `la mansione non è stata salvata (${error.message})`);
        // Utente standard: permessi tipici della mansione (modificabili dopo)
        if (dati.ruolo === "standard" && PERMESSI_TIPICI[mansione]) {
          const righe = sezioni.map((s) => {
            const consentite = AZIONI_DI[PERMESSI_TIPICI[mansione][s.chiave]] ?? [];
            return { utente_id: id, sezione: s.chiave, ...Object.fromEntries(AZIONI.map((a) => [a, consentite.includes(a)])) };
          });
          const { error: e2 } = await supabase.from("permessi").upsert(righe);
          if (e2) avvisi.push(`i permessi non sono stati salvati (${e2.message})`);
        }
      }
      // Fa interventi: collegato al tecnico con lo stesso nome, oppure nuovo tecnico
      if (id && faInterventi) {
        const libero = tecnici.find((t) => !t.utente_id && paroleNome(t.nome) === paroleNome(dati.nome));
        const { error } = libero
          ? await supabase.from("tecnici").update({ utente_id: id }).eq("id", libero.id)
          : await supabase.from("tecnici").insert({ nome: dati.nome.trim(), utente_id: id });
        if (error) avvisi.push(`non è stato collegato come tecnico (${error.message})`);
      }
      onCreato(avvisi);
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
      <div className="campi">
        <label>Mansione
          <select value={mansione} onChange={(e) => { setMansione(e.target.value); if (e.target.value === "Tecnico") setFaInterventi(true); }}>
            <option value="">—</option>
            {MANSIONI.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>
      <label className="interruttore">
        <input type="checkbox" checked={faInterventi} onChange={(e) => setFaInterventi(e.target.checked)} />
        Fa interventi (tecnico): compare nei rapportini e in agenda, prende in carico le richieste, riceve le notifiche
      </label>
      {dati.ruolo === "standard" && mansione && PERMESSI_TIPICI[mansione] && <p className="piccolo">Verranno impostati i permessi tipici di "{mansione}", modificabili dopo con il pulsante Permessi.</p>}
      <label className="interruttore">
        <input type="checkbox" checked={dati.ruolo === "admin" || whatsapp} disabled={dati.ruolo === "admin"} onChange={(e) => setWhatsapp(e.target.checked)} />
        Può scrivere su WhatsApp a clienti e fornitori{dati.ruolo === "admin" ? " (sempre attivo per gli admin)" : ""}
      </label>
      <label className="interruttore">
        <input type="checkbox" checked={dati.ruolo === "admin" || prezzi} disabled={dati.ruolo === "admin"} onChange={(e) => setPrezzi(e.target.checked)} />
        Vede totali dei documenti, imponibili e importi{dati.ruolo === "admin" ? " (sempre per gli admin)" : ""}
      </label>
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

// Modifica di nome ed email di accesso (l'email passa dalla funzione server, che aggiorna anche l'accesso)
function ModificaUtente({ utente, onChiudi, onSalvato }: { utente: Profilo; onChiudi: () => void; onSalvato: (messaggio: string) => void }) {
  const [nome, setNome] = useState(utente.nome ?? "");
  const [email, setEmail] = useState(utente.email);
  const [errore, setErrore] = useState("");
  const [inCorso, setInCorso] = useState(false);

  const salva = async (e: FormEvent) => {
    e.preventDefault();
    setErrore("");
    setInCorso(true);
    try {
      if (email.trim().toLowerCase() !== utente.email.toLowerCase()) {
        await adminUtenti("modifica", { id: utente.id, email: email.trim(), nome: nome.trim() });
      } else {
        const { error } = await supabase.from("profili").update({ nome: nome.trim() || null }).eq("id", utente.id);
        if (error) throw error;
      }
      onSalvato("Utente modificato");
    } catch (err) {
      const m = (err as Error).message;
      setErrore(/azione|sconosciut|non riconosciut|400/i.test(m)
        ? `Per cambiare l'email va ripubblicata la funzione "admin-utenti" su Supabase (${m})`
        : m);
    }
    setInCorso(false);
  };

  return (
    <form className="pannello" onSubmit={salva}>
      <h3>Modifica utente</h3>
      <div className="campi">
        <label>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} required /></label>
        <label>Email di accesso<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      </div>
      <p className="piccolo">
        Ruolo, mansione, "fa interventi", stato, WhatsApp e totali si cambiano direttamente nella riga dell'utente; i permessi con il pulsante Permessi.
        Cambiando l'email, l'utente entrerà con quella nuova (password e verifica in due passaggi restano le stesse).
      </p>
      {errore && <p className="errore">{errore}</p>}
      <button className="primario" disabled={inCorso}>{inCorso ? "Salvataggio…" : "Salva"}</button> <button type="button" onClick={onChiudi}>Annulla</button>
    </form>
  );
}
