// Funzione server: notifiche sul telefono (Web Push) per le richieste di intervento.
// - "chiave": chiave pubblica per iscrivere il dispositivo (la coppia di chiavi viene creata la prima volta e resta sul server)
// - "richiesta": avvisa il tecnico assegnato, oppure tutti i tecnici se la richiesta non è assegnata
// - "prova": manda una notifica di prova ai dispositivi di chi la chiede
//
// Pubblicare con "Verify JWT" disattivato (la verifica dell'utente è fatta qui). Nessun segreto da impostare.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const risposta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Indirizzo del gestionale: identifica chi invia verso i servizi di notifica e si apre toccando la notifica
const SITO = "https://bocciardimpianti.github.io/gestionale/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const chiamante = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user: io } } = await chiamante.auth.getUser();
  if (!io) return risposta({ errore: "Accesso richiesto" }, 401);
  const servizio = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Chiavi di invio: create alla prima richiesta
  let { data: chiavi, error: errChiavi } = await servizio.from("chiavi_notifiche").select("pubblica, privata").eq("id", 1).maybeSingle();
  if (errChiavi) return risposta({ errore: `Esegui su Supabase lo script 0022_notifiche.sql (${errChiavi.message})` }, 500);
  if (!chiavi) {
    const nuove = webpush.generateVAPIDKeys();
    const { error: errNuove } = await servizio.from("chiavi_notifiche").insert({ id: 1, pubblica: nuove.publicKey, privata: nuove.privateKey });
    if (errNuove && !/duplicate/i.test(errNuove.message)) return risposta({ errore: `Chiavi non salvate: ${errNuove.message}` }, 500);
    ({ data: chiavi } = await servizio.from("chiavi_notifiche").select("pubblica, privata").eq("id", 1).single());
  }
  webpush.setVapidDetails(SITO, chiavi!.pubblica, chiavi!.privata);

  const { azione, id } = await req.json().catch(() => ({}));

  // Invio a tutti i dispositivi degli utenti indicati; le iscrizioni scadute vengono tolte
  const invia = async (utenti: string[], messaggio: Record<string, unknown>) => {
    if (!utenti.length) return 0;
    const { data: iscrizioni } = await servizio.from("push_iscrizioni").select("id, endpoint, p256dh, auth").in("utente_id", utenti);
    let inviate = 0;
    await Promise.all((iscrizioni ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(messaggio), { TTL: 86400, urgency: "high" });
        inviate++;
        await servizio.from("push_iscrizioni").update({ ultimo_invio: new Date().toISOString() }).eq("id", s.id);
      } catch (e) {
        const codice = (e as { statusCode?: number }).statusCode;
        if (codice === 404 || codice === 410) await servizio.from("push_iscrizioni").delete().eq("id", s.id);
      }
    }));
    return inviate;
  };

  try {
    switch (azione) {
      case "chiave":
        return risposta({ chiave: chiavi!.pubblica });

      case "prova": {
        const inviate = await invia([io.id], { titolo: "Notifiche attive", testo: "Su questo dispositivo arriveranno gli avvisi delle richieste di intervento.", url: SITO });
        return risposta({ inviate });
      }

      case "richiesta": {
        const { data: puo } = await chiamante.rpc("puo", { p_sezione: "richieste", p_azione: "vedere" });
        if (puo !== true) return risposta({ errore: "Non autorizzato" }, 403);
        const { data: r } = await servizio.from("richieste")
          .select("id, descrizione, nominativo, urgente, stato, tecnico_id, notificata_il, notificato_tecnico_id, eliminato_il, cliente:clienti(nome)")
          .eq("id", id).maybeSingle();
        if (!r || r.eliminato_il || ["Completata", "Annullata"].includes(r.stato)) return risposta({ inviate: 0, motivo: "chiusa" });
        // Già avvisato chi doveva: niente doppioni modificando la richiesta
        if (r.tecnico_id ? r.notificato_tecnico_id === r.tecnico_id : r.notificata_il) return risposta({ inviate: 0, motivo: "già notificata" });

        let tecnici = servizio.from("tecnici").select("id, nome, utente_id").is("eliminato_il", null).not("utente_id", "is", null);
        if (r.tecnico_id) tecnici = tecnici.eq("id", r.tecnico_id);
        const { data: elenco } = await tecnici;
        const destinatari = [...new Set((elenco ?? []).map((t) => t.utente_id as string))].filter((u) => u !== io.id || r.tecnico_id);
        const { data: attivi } = await servizio.from("profili").select("id").in("id", destinatari.length ? destinatari : ["00000000-0000-0000-0000-000000000000"]).eq("attivo", true);
        const cliente = (r.cliente as { nome?: string } | null)?.nome || r.nominativo || "Cliente";
        const inviate = await invia((attivi ?? []).map((p) => p.id), {
          titolo: `${r.urgente ? "URGENTE – " : ""}${r.tecnico_id ? "Richiesta assegnata a te" : "Nuova richiesta di intervento"}`,
          testo: `${cliente}: ${String(r.descrizione ?? "").slice(0, 140)}`,
          url: `${SITO}#/s/richieste?apri=${r.id}`,
          tag: `richiesta-${r.id}`,
        });
        await servizio.from("richieste").update({ notificata_il: new Date().toISOString(), notificato_tecnico_id: r.tecnico_id }).eq("id", r.id);
        await servizio.from("registro").insert({ utente_id: io.id, azione: "richieste_notificata", dettagli: { id: r.id, tecnico_id: r.tecnico_id, dispositivi: inviate } });
        return risposta({ inviate, destinatari: (elenco ?? []).filter((t) => destinatari.includes(t.utente_id as string)).map((t) => t.nome) });
      }
    }
    return risposta({ errore: "Azione sconosciuta" }, 400);
  } catch (e) {
    return risposta({ errore: (e as Error).message }, 500);
  }
});
