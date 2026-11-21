// Funzione server: l'IA (Claude) controlla quali materiali di un rapportino formano un impianto
// (Clima, Caldaie, Allarmi, Automatismi, TVCC) e che ruolo ha ognuno.
// Riceve SOLO le descrizioni dei materiali (mai nomi o dati dei clienti).
// Le correzioni fatte a mano nella linguetta Materiali degli impianti (script 0048) vengono passate come esempi,
// così l'IA impara dalle scelte della ditta.
//
// Pubblicare con "Verify JWT" disattivato (la verifica dell'utente è fatta qui). Usa il segreto ANTHROPIC_API_KEY.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const risposta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODELLO = "claude-opus-5-5";
const CATEGORIE = ["Clima", "Caldaie", "Allarmi", "Automatismi", "TVCC"];
const RUOLI = [
  "caldaia", "defangatore", "sdoppiatore", "dosatore", "pompe_valvole", "canna_fumaria",
  "unita_esterna", "unita_interna", "tubo_rame",
  "motore", "componente_automatismo",
  "centrale", "componente_allarme",
  "registratore", "telecamera", "componente_tvcc",
];
const TERMICI = ["Radiante a pavimento", "Termosifoni in alluminio", "Termosifoni in acciaio", "Termosifoni in ghisa",
  "Termosifoni misti", "Misto (radiante + termosifoni)", "Ventilconvettori"];

const ISTRUZIONI = `Lavori per una ditta italiana di impianti termoidraulici, elettrici, di climatizzazione, allarme e automazione.
Ricevi i materiali usati in alcuni rapportini di intervento (descrizioni brevi del magazzino, spesso abbreviate: "CALD.", "COND.", "DEF.", "U.E.", "MOT.").
Per ogni rapportino individua gli impianti INSTALLATI o SOSTITUITI, al massimo uno per categoria, e i soli materiali che ne fanno parte.

Categorie e materiali da tenere (tutto il resto va escluso: raccordi generici, multistrato, cavi, viti, tasselli, silicone, scatole, canaline, manodopera, ricambi minori):
- Caldaie: c'è una caldaia (anche a condensazione, murale, a basamento, termocamino a gas). Ruoli: caldaia (il generatore), defangatore (anche filtro magnetico), sdoppiatore (kit sdoppiato fumi), dosatore (dosatore di polifosfati; non le ricariche), pompe_valvole (circolatori, gruppi di miscelazione o rilancio, valvole miscelatrici, deviatrici o a 3 vie), canna_fumaria (tubi, prolunghe, curve, terminali, camini dei fumi). Non sono caldaie: scaldabagni elettrici, ricambi o schede di caldaia, accessori "per caldaia".
- Clima: c'è un'unità esterna o un climatizzatore completo. Ruoli: unita_esterna, unita_interna, tubo_rame (solo tubo in rame 1/4" 3/8" 1/2" 5/8" 7/8", non raccordi, curve o isolante a parte). Non sono clima: staffe, supporti, pompe di scarico condensa, telecomandi, canaline.
- Automatismi: c'è un motore per cancello, serranda, basculante o barriera. Ruoli: motore (motori, motoriduttori, kit di automazione), componente_automatismo (solo fotocellule, lampeggianti, selettori, cremagliere, radiocomandi/trasmettitori, riceventi, schede e centrali di comando).
- Allarmi: c'è una centrale di allarme/antifurto. Ruoli: centrale, componente_allarme (solo sensori/rilevatori, contatti, sirene, tastiere/inseritori, telecamere).
- TVCC: videosorveglianza (telecamere, videoregistratori NVR/DVR/XVR). Ruoli: registratore, telecamera, componente_tvcc (solo hard disk, switch PoE, monitor, alimentatori per telecamere).
Una semplice manutenzione o riparazione con soli ricambi NON crea un impianto.

Per ogni impianto indica:
- principale: il numero del materiale principale (la caldaia, l'unità esterna, il motore, la centrale, il registratore o la prima telecamera);
- materiali: numero e ruolo di ogni materiale da tenere (principale compreso);
- canna_fumaria_m: metri totali di canna fumaria (somma lunghezze × quantità dei soli tubi/prolunghe), se si capisce; altrimenti null;
- canna_fumaria_sezione: es. "Ø 80" o "Ø 60/100", se si capisce; altrimenti null;
- impianto_termico: tipo di riscaldamento solo se i materiali lo dicono chiaramente (radiatori, pannelli radianti), altrimenti null. Attenzione: RADIANT è anche una marca di caldaie;
- tipo_gas: gas refrigerante dell'unità esterna (es. R32), se scritto; altrimenti null.
Se un rapportino non contiene impianti, restituisci un elenco vuoto.`;

const nullabile = (t: Record<string, unknown>) => ({ anyOf: [t, { type: "null" }] });
const SCHEMA = {
  type: "object",
  properties: {
    rapportini: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          impianti: {
            type: "array",
            items: {
              type: "object",
              properties: {
                categoria: { type: "string", enum: CATEGORIE },
                principale: { type: "integer" },
                materiali: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { n: { type: "integer" }, ruolo: { type: "string", enum: RUOLI } },
                    required: ["n", "ruolo"],
                    additionalProperties: false,
                  },
                },
                canna_fumaria_m: nullabile({ type: "number" }),
                canna_fumaria_sezione: nullabile({ type: "string" }),
                impianto_termico: nullabile({ type: "string", enum: TERMICI }),
                tipo_gas: nullabile({ type: "string" }),
              },
              required: ["categoria", "principale", "materiali", "canna_fumaria_m", "canna_fumaria_sezione", "impianto_termico", "tipo_gas"],
              additionalProperties: false,
            },
          },
        },
        required: ["id", "impianti"],
        additionalProperties: false,
      },
    },
  },
  required: ["rapportini"],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const chiave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!chiave) return risposta({ errore: "Manca la chiave: su Supabase aggiungi il segreto ANTHROPIC_API_KEY (Edge Functions → Secrets)" }, 500);

  const chiamante = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await chiamante.auth.getUser();
  if (!user) return risposta({ errore: "Accesso richiesto" }, 401);
  const { data: ok } = await chiamante.rpc("mfa_ok");
  if (ok !== true) return risposta({ errore: "Serve la verifica in due passaggi" }, 403);

  const { rapportini } = await req.json().catch(() => ({}));
  const elenco = (Array.isArray(rapportini) ? rapportini : []).slice(0, 15)
    .map((r: { id: unknown; righe: unknown }) => ({
      id: Number(r.id),
      righe: (Array.isArray(r.righe) ? r.righe : []).slice(0, 200).map((x) => String(x ?? "").slice(0, 200)),
    }))
    .filter((r) => Number.isFinite(r.id) && r.righe.length);
  if (!elenco.length) return risposta({ rapportini: [] });

  // Correzioni fatte a mano (script 0048): esempi di cosa tenere o togliere, per categoria
  const { data: correzioni } = await chiamante.from("correzioni_impianti")
    .select("categoria, descrizione, incluso").order("id").limit(400);
  const esempi = (correzioni ?? []).map((c) => `- ${c.categoria}: "${c.descrizione}" → ${c.incluso ? "DA TENERE" : "DA ESCLUDERE"}`).join("\n");
  const sistema = esempi
    ? `${ISTRUZIONI}\n\nCorrezioni fatte dalla ditta (hanno la precedenza, valgono anche per materiali molto simili):\n${esempi}`
    : ISTRUZIONI;

  const testo = elenco.map((r) => `Rapportino id ${r.id}:\n${r.righe.map((d, i) => `${i}: ${d}`).join("\n")}`).join("\n\n");

  try {
    const client = new Anthropic({ apiKey: chiave });
    const r = await client.beta.messages.create({
      model: MODELLO,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      // Istruzioni ed esempi uguali per tutti i gruppi di una stessa analisi: restano in cache
      system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Materiali (numero: descrizione):\n\n${testo}` }],
    });
    if (r.stop_reason === "refusal") return risposta({ errore: "L'IA non ha potuto rispondere per questo gruppo di rapportini" }, 502);
    if (r.stop_reason === "max_tokens") return risposta({ errore: "Risposta dell'IA troppo lunga: riprova" }, 502);
    const blocco = r.content.find((b) => b.type === "text");
    if (!blocco || blocco.type !== "text") return risposta({ errore: "Risposta vuota dall'IA" }, 502);
    const dati = JSON.parse(blocco.text);
    return risposta({ rapportini: dati.rapportini ?? [], uso: r.usage });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return risposta({ errore: "Chiave Anthropic non valida: controlla il segreto ANTHROPIC_API_KEY" }, 500);
    if (e instanceof Anthropic.RateLimitError) return risposta({ errore: "Troppe richieste all'IA, riprova tra poco" }, 429);
    if (e instanceof Anthropic.APIError) return risposta({ errore: `Errore dell'IA (${e.status}): ${e.message}` }, 502);
    return risposta({ errore: (e as Error).message }, 500);
  }
});
