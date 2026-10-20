// Funzione server (Supabase Edge Function) per operazioni riservate all'admin:
// creare utenti, eliminarli, reimpostare password e 2FA.
// La chiave di servizio resta sul server e non arriva mai al browser.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const risposta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const chiamante = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  // Verifica: utente loggato, con 2FA, e admin
  const { data: ok, error: errAdmin } = await chiamante.rpc("is_admin");
  if (errAdmin || ok !== true) return risposta({ errore: "Non autorizzato" }, 403);
  const { data: { user: io } } = await chiamante.auth.getUser();

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { azione, ...p } = await req.json();

  try {
    switch (azione) {
      case "crea": {
        const { data, error } = await admin.auth.admin.createUser({
          email: p.email,
          password: p.password,
          email_confirm: true,
          user_metadata: { nome: p.nome },
        });
        if (error) throw error;
        if (p.ruolo === "admin") {
          await admin.from("profili").update({ ruolo: "admin" }).eq("id", data.user.id);
        }
        await registra(admin, io?.id, "utente_creato", { email: p.email, ruolo: p.ruolo });
        return risposta({ id: data.user.id });
      }
      case "elimina": {
        if (p.id === io?.id) throw new Error("Non puoi eliminare te stesso");
        const { error } = await admin.auth.admin.deleteUser(p.id);
        if (error) throw error;
        await registra(admin, io?.id, "utente_eliminato", { id: p.id });
        return risposta({ ok: true });
      }
      case "password": {
        const { error } = await admin.auth.admin.updateUserById(p.id, { password: p.password });
        if (error) throw error;
        await registra(admin, io?.id, "password_reimpostata", { id: p.id });
        return risposta({ ok: true });
      }
      case "reset2fa": {
        const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: p.id });
        if (error) throw error;
        for (const f of data.factors) {
          await admin.auth.admin.mfa.deleteFactor({ userId: p.id, id: f.id });
        }
        await registra(admin, io?.id, "2fa_reimpostata", { id: p.id });
        return risposta({ ok: true });
      }
      default:
        return risposta({ errore: "Azione sconosciuta" }, 400);
    }
  } catch (e) {
    return risposta({ errore: (e as Error).message }, 400);
  }
});

// deno-lint-ignore no-explicit-any
async function registra(admin: any, utente: string | undefined, azione: string, dettagli: unknown) {
  await admin.from("registro").insert({ utente_id: utente, azione, dettagli });
}
