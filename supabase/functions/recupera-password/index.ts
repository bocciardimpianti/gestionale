// Funzione server pubblica: chi ha dimenticato la password inserisce la propria email,
// viene generata una password provvisoria e inviata agli amministratori attivi.
// L'utente dovrà cambiarla al primo accesso; la verifica 2FA resta comunque obbligatoria.
//
// Pubblicare con "Verify JWT" disattivato. Segreti richiesti:
// SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.16";

const AZIONE = "password_recupero";
const ATTESA_PER_UTENTE_MINUTI = 15;
const MASSIMO_ALL_ORA = 10;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const risposta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// La risposta è la stessa per ogni email, così non si scopre quali sono registrate
const RICHIESTA_PRESA_IN_CARICO = { ok: true };

function generaPassword(lunghezza = 16) {
  // Senza caratteri ambigui (0/O, 1/l/I): va letta e ricopiata da una mail
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const limite = 256 - (256 % alfabeto.length); // evita sbilanciamenti tra i caratteri
  let esito = "";
  while (esito.length < lunghezza) {
    for (const byte of crypto.getRandomValues(new Uint8Array(lunghezza))) {
      if (byte < limite && esito.length < lunghezza) esito += alfabeto[byte % alfabeto.length];
    }
  }
  return esito;
}

const minutiFa = (minuti: number) => new Date(Date.now() - minuti * 60_000).toISOString();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return risposta({ errore: "Metodo non consentito" }, 405);

  const host = Deno.env.get("SMTP_HOST");
  const utenteSmtp = Deno.env.get("SMTP_USER");
  const passwordSmtp = Deno.env.get("SMTP_PASS");
  if (!host || !utenteSmtp || !passwordSmtp) return risposta({ errore: "Invio mail non configurato" }, 503);

  const corpo = await req.json().catch(() => null);
  const email = typeof corpo?.email === "string" ? corpo.email.trim().toLowerCase() : "";
  if (!email || email.length > 254) return risposta({ errore: "Email non valida" }, 400);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Limite generale, per evitare invii a raffica agli amministratori
    const { count: recenti, error: errRecenti } = await admin.from("registro")
      .select("id", { count: "exact", head: true })
      .eq("azione", AZIONE).gte("il", minutiFa(60));
    if (errRecenti) throw errRecenti;
    if ((recenti ?? 0) >= MASSIMO_ALL_ORA) return risposta(RICHIESTA_PRESA_IN_CARICO);

    const { data: profilo, error: errProfilo } = await admin.from("profili")
      .select("id, email, nome").ilike("email", email.replace(/[\\%_]/g, "\\$&")).eq("attivo", true).maybeSingle();
    if (errProfilo) throw errProfilo;
    if (!profilo) return risposta(RICHIESTA_PRESA_IN_CARICO);

    // Limite per utente: impedisce di cambiargli la password di continuo
    const { count: perUtente, error: errUtente } = await admin.from("registro")
      .select("id", { count: "exact", head: true })
      .eq("azione", AZIONE).eq("utente_id", profilo.id).gte("il", minutiFa(ATTESA_PER_UTENTE_MINUTI));
    if (errUtente) throw errUtente;
    if ((perUtente ?? 0) > 0) return risposta(RICHIESTA_PRESA_IN_CARICO);

    const { data: amministratori, error: errAdmin } = await admin.from("profili")
      .select("email").eq("ruolo", "admin").eq("attivo", true);
    if (errAdmin) throw errAdmin;
    if (!amministratori?.length) throw new Error("Nessun amministratore attivo");

    const { data: { user }, error: errUser } = await admin.auth.admin.getUserById(profilo.id);
    if (errUser || !user) throw errUser ?? new Error("Utente non trovato");

    const provvisoria = generaPassword();

    // Prima la mail: se l'invio fallisce la password attuale resta valida
    const posta = nodemailer.createTransport({
      host,
      port: Number(Deno.env.get("SMTP_PORT") ?? 465),
      secure: true,
      auth: { user: utenteSmtp, pass: passwordSmtp },
    });
    await posta.sendMail({
      from: `Gestionale Bocciardi <${utenteSmtp}>`,
      to: amministratori.map((a) => a.email).join(", "),
      subject: `Gestionale: password provvisoria per ${profilo.email}`,
      text: [
        `È stato richiesto il recupero della password per l'utente ${profilo.nome ?? ""} <${profilo.email}>.`,
        "",
        `Password provvisoria: ${provvisoria}`,
        "",
        "Comunicala all'utente: dovrà sostituirla al primo accesso, dopo il codice dell'Authenticator.",
        "La password precedente non è più valida.",
        "",
        "Se l'utente non ha fatto questa richiesta, qualcun altro ha inserito la sua email nella pagina di accesso:",
        "comunicagli comunque la nuova password e controlla il registro attività.",
      ].join("\n"),
    });

    const { error: errAggiorna } = await admin.auth.admin.updateUserById(profilo.id, {
      password: provvisoria,
      user_metadata: { ...user.user_metadata, password_provvisoria: true },
    });
    if (errAggiorna) throw errAggiorna;

    await admin.from("registro").insert({ utente_id: profilo.id, azione: AZIONE, dettagli: { email: profilo.email } });
    return risposta(RICHIESTA_PRESA_IN_CARICO);
  } catch (e) {
    console.error("recupera-password:", (e as Error).message);
    return risposta({ errore: "Richiesta non riuscita" }, 500);
  }
});
