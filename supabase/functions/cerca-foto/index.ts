// Funzione server: cerca le foto dei materiali su internet (DuckDuckGo Immagini, altrimenti Bing) e le scarica.
// Il browser non può farlo da solo perché quei siti non permettono le richieste dirette dalle pagine web.
// Non usa chiavi a pagamento: legge le stesse pagine dei risultati che apre una persona.
//
// - { azione: "cerca", testo }  → { risultati: [{ immagine, miniatura, titolo, fonte, larghezza, altezza }] }
// - { azione: "scarica", url }  → l'immagine (application/octet-stream)
//
// Pubblicare con "Verify JWT" disattivato (la verifica dell'utente è fatta qui).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const BROWSER = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
};

type Risultato = { immagine: string; miniatura: string; titolo: string; fonte: string; larghezza?: number; altezza?: number };

const conTempo = (ms: number) => AbortSignal.timeout(ms);

async function duckduckgo(testo: string): Promise<Risultato[]> {
  const q = encodeURIComponent(testo);
  const pagina = await fetch(`https://duckduckgo.com/?q=${q}&iax=images&ia=images`, { headers: BROWSER, signal: conTempo(10000) });
  const html = await pagina.text();
  const vqd = html.match(/vqd=["']?([\d-]+)["']?/)?.[1];
  if (!vqd) return [];
  const r = await fetch(`https://duckduckgo.com/i.js?l=it-it&o=json&q=${q}&vqd=${vqd}&f=,,,,,&p=1`, {
    headers: { ...BROWSER, Referer: "https://duckduckgo.com/", Accept: "application/json, text/javascript, */*; q=0.01" },
    signal: conTempo(10000),
  });
  if (!r.ok) return [];
  const dati = await r.json().catch(() => null) as { results?: { image: string; thumbnail: string; title: string; url: string; width: number; height: number }[] } | null;
  return (dati?.results ?? []).map((x) => ({ immagine: x.image, miniatura: x.thumbnail, titolo: x.title, fonte: x.url, larghezza: x.width, altezza: x.height }));
}

const decodifica = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");

async function bing(testo: string): Promise<Risultato[]> {
  const r = await fetch(`https://www.bing.com/images/async?q=${encodeURIComponent(testo)}&first=0&count=30&mmasync=1&setlang=it`, { headers: BROWSER, signal: conTempo(10000) });
  if (!r.ok) return [];
  const html = await r.text();
  const out: Risultato[] = [];
  for (const m of html.matchAll(/\sm="(\{[^"]+\})"/g)) {
    try {
      const x = JSON.parse(decodifica(m[1])) as { murl?: string; turl?: string; t?: string; purl?: string };
      if (x.murl) out.push({ immagine: x.murl, miniatura: x.turl ?? x.murl, titolo: x.t ?? "", fonte: x.purl ?? "" });
    } catch { /* risultato non leggibile */ }
  }
  return out;
}

// Indirizzi da non scaricare mai (rete interna del server)
function indirizzoPermesso(u: string) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return false;
    const h = url.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal") return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.includes(":") || h === "[::1]") return false;
    return true;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Solo utenti collegati con la verifica in due passaggi
  const chiamante = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await chiamante.auth.getUser();
  if (!user) return json({ errore: "Accesso richiesto" }, 401);
  const { data: ok } = await chiamante.rpc("mfa_ok");
  if (ok !== true) return json({ errore: "Serve la verifica in due passaggi" }, 403);

  const { azione, testo, url } = await req.json().catch(() => ({}));

  if (azione === "cerca") {
    const t = String(testo ?? "").trim().slice(0, 200);
    if (!t) return json({ errore: "Manca il testo da cercare" }, 400);
    let risultati: Risultato[] = [];
    try { risultati = await duckduckgo(t); } catch { /* si prova con Bing */ }
    if (!risultati.length) {
      try { risultati = await bing(t); } catch { /* nessun risultato */ }
    }
    // Senza doppioni e solo indirizzi normali
    const visti = new Set<string>();
    risultati = risultati.filter((r) => r.immagine && indirizzoPermesso(r.immagine) && !visti.has(r.immagine) && visti.add(r.immagine)).slice(0, 20);
    return json({ risultati });
  }

  if (azione === "scarica") {
    const u = String(url ?? "");
    if (!indirizzoPermesso(u)) return json({ errore: "Indirizzo non valido" }, 400);
    try {
      const r = await fetch(u, { headers: { ...BROWSER, Accept: "image/avif,image/webp,image/*,*/*;q=0.8", Referer: new URL(u).origin + "/" }, signal: conTempo(15000) });
      if (!r.ok) return json({ errore: `Il sito della foto ha risposto ${r.status}` }, 502);
      const tipo = r.headers.get("content-type") ?? "";
      if (tipo && !tipo.startsWith("image/") && !tipo.startsWith("application/octet-stream") && !tipo.startsWith("binary/")) return json({ errore: "Non è un'immagine" }, 415);
      const dati = new Uint8Array(await r.arrayBuffer());
      if (dati.length > 10 * 1024 * 1024) return json({ errore: "Immagine troppo grande" }, 413);
      return new Response(dati, { headers: { ...cors, "Content-Type": "application/octet-stream" } });
    } catch (e) {
      return json({ errore: "Foto non scaricabile: " + (e as Error).message }, 502);
    }
  }

  return json({ errore: "Azione sconosciuta" }, 400);
});
