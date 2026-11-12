// Funzione server: assistente per la ricerca dei materiali, con Claude (Anthropic).
// La chiave API resta qui sul server (segreto ANTHROPIC_API_KEY su Supabase) e non arriva mai al browser.
//
// - "parole": dalla richiesta a parole del tecnico ("quel gomito per il multistrato da 16")
//             propone alcune ricerche brevi da fare nel magazzino
// - "scegli": tra i materiali trovati con quelle ricerche, sceglie i più adatti e spiega perché
//
// Pubblicare con "Verify JWT" disattivato (la verifica dell'utente è fatta qui).
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const risposta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODELLO = "claude-opus-5-5";

const ISTRUZIONI = `Sei l'assistente del magazzino di una ditta italiana di impianti idraulici, elettrici, termici e di climatizzazione.
I tecnici descrivono a parole, spesso in modo vago o dialettale, il materiale che cercano.
Le descrizioni del magazzino sono brevi e tecniche, spesso con abbreviazioni (es. "curva 90° ø16 ff rame a saldare", "manicotto innesto htb ø 50", "interr. magnetotermico 2p 16a").`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const chiave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!chiave) return risposta({ errore: "Manca la chiave: su Supabase aggiungi il segreto ANTHROPIC_API_KEY (Edge Functions → Secrets)" }, 500);

  // Solo utenti collegati con la verifica in due passaggi
  const chiamante = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await chiamante.auth.getUser();
  if (!user) return risposta({ errore: "Accesso richiesto" }, 401);
  const { data: ok } = await chiamante.rpc("mfa_ok");
  if (ok !== true) return risposta({ errore: "Serve la verifica in due passaggi" }, 403);

  const { azione, domanda, candidati } = await req.json().catch(() => ({}));
  const testo = String(domanda ?? "").trim().slice(0, 300);
  if (!testo) return risposta({ errore: "Scrivi cosa cerchi" }, 400);

  const client = new Anthropic({ apiKey: chiave });

  // Una richiesta a Claude con risposta in JSON secondo lo schema
  const chiedi = async (messaggio: string, schema: Record<string, unknown>) => {
    const r = await client.beta.messages.create({
      model: MODELLO,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system: ISTRUZIONI,
      messages: [{ role: "user", content: messaggio }],
    });
    if (r.stop_reason === "refusal") throw new Error("L'assistente non ha potuto rispondere a questa richiesta");
    const blocco = r.content.find((b) => b.type === "text");
    if (!blocco || blocco.type !== "text") throw new Error("Risposta vuota dall'assistente");
    return JSON.parse(blocco.text);
  };

  try {
    if (azione === "parole") {
      const r = await chiedi(
        `Il tecnico cerca: "${testo}"
Proponi da 3 a 6 ricerche brevi (1-3 parole ciascuna, in italiano, come compaiono nelle descrizioni di magazzino) che trovino quel materiale.
Usa i termini tecnici, i sinonimi del mestiere e le misure utili (es. "gomito 16", "curva multistrato", "raccordo pressare 16").`,
        {
          type: "object",
          properties: { ricerche: { type: "array", items: { type: "string" } } },
          required: ["ricerche"],
          additionalProperties: false,
        },
      );
      const ricerche = (r.ricerche as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 6);
      return risposta({ ricerche });
    }

    if (azione === "scegli") {
      const elenco = (Array.isArray(candidati) ? candidati : [])
        .slice(0, 80)
        .map((c: { id: unknown; testo: unknown }) => `${Number(c.id)}: ${String(c.testo ?? "").slice(0, 160)}`)
        .join("\n");
      if (!elenco) return risposta({ scelti: [] });
      const r = await chiedi(
        `Il tecnico cerca: "${testo}"
Materiali del magazzino (id: descrizione):
${elenco}

Scegli fino a 8 materiali dell'elenco più adatti a quello che cerca, dal più adatto al meno adatto.
Per ognuno scrivi un motivo brevissimo (massimo 10 parole). Se nessuno è adatto, restituisci un elenco vuoto.`,
        {
          type: "object",
          properties: {
            scelti: {
              type: "array",
              items: {
                type: "object",
                properties: { id: { type: "integer" }, motivo: { type: "string" } },
                required: ["id", "motivo"],
                additionalProperties: false,
              },
            },
          },
          required: ["scelti"],
          additionalProperties: false,
        },
      );
      return risposta({ scelti: (r.scelti as { id: number; motivo: string }[]).slice(0, 8) });
    }

    return risposta({ errore: "Azione sconosciuta" }, 400);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return risposta({ errore: "Chiave Anthropic non valida: controlla il segreto ANTHROPIC_API_KEY" }, 500);
    if (e instanceof Anthropic.RateLimitError) return risposta({ errore: "Troppe richieste all'assistente, riprova tra poco" }, 429);
    if (e instanceof Anthropic.APIError) return risposta({ errore: `Errore dell'assistente (${e.status}): ${e.message}` }, 502);
    return risposta({ errore: (e as Error).message }, 500);
  }
});
