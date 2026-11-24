// Funzione server: controlla la cartella Google Drive dei DDT e mette i PDF nuovi tra i "DDT in arrivo"
// (tabella ddt_in_arrivo, file nell'archivio "ddt_acquisto/in-arrivo"). L'import vero lo fa il gestionale aperto.
// La chiama Supabase ogni 5 minuti (script 0057) e il gestionale quando si apre la sezione DDT di Acquisto.
//
// Segreti su Supabase (Edge Functions → Secrets):
//   GOOGLE_SERVICE_ACCOUNT  = il file JSON della chiave del service account Google (tutto il contenuto)
//   DDT_DRIVE_CARTELLA      = (facoltativo) l'ID della cartella Drive; senza, vale quella "DDT BOCCIARDI IMPIANTI"
// La cartella Drive va condivisa (come Visualizzatore) con l'e-mail del service account.
//
// Pubblicare con "Verify JWT" disattivato: la funzione legge solo la cartella e non restituisce dati dei DDT.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const CARTELLA = Deno.env.get("DDT_DRIVE_CARTELLA") || "1hWqYSfkbZvu3kzrp8EGm5V3F_tkadM0t";

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const testo64 = (s: string) => b64url(new TextEncoder().encode(s));

// Accesso a Drive con il service account (JWT firmato con la sua chiave privata)
async function tokenGoogle(sa: { client_email: string; private_key: string }) {
  const ora = Math.floor(Date.now() / 1000);
  const testa = testo64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = testo64(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: ora, exp: ora + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const chiave = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chiave, new TextEncoder().encode(`${testa}.${corpo}`)));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${testa}.${corpo}.${b64url(firma)}` }),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error("Accesso a Google non riuscito: " + (d.error_description ?? d.error ?? r.status));
  return d.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const grezzo = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
    if (!grezzo) return json({ errore: "Manca il segreto GOOGLE_SERVICE_ACCOUNT su Supabase" }, 500);
    const sa = JSON.parse(grezzo);
    const token = await tokenGoogle(sa);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // PDF nella cartella (anche Drive condivisi)
    const q = encodeURIComponent(`'${CARTELLA}' in parents and mimeType = 'application/pdf' and trashed = false`);
    const elenco = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&pageSize=200&orderBy=createdTime&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } });
    const dati = await elenco.json();
    if (!elenco.ok) throw new Error("Cartella Drive non leggibile (è condivisa con " + sa.client_email + "?): " + (dati.error?.message ?? elenco.status));
    const files = (dati.files ?? []) as { id: string; name: string }[];
    if (!files.length) return json({ nuovi: 0, cartella: 0 });

    const { data: gia, error: e1 } = await db.from("ddt_in_arrivo").select("drive_id").in("drive_id", files.map((f) => f.id));
    if (e1) throw new Error(e1.message);
    const visti = new Set((gia ?? []).map((x) => x.drive_id));
    let nuovi = 0;
    const errori: string[] = [];
    for (const f of files.filter((f) => !visti.has(f.id))) {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { errori.push(`${f.name}: download non riuscito (${r.status})`); continue; }
      const pdf = new Uint8Array(await r.arrayBuffer());
      const percorso = `in-arrivo/${f.id}.pdf`;
      const up = await db.storage.from("ddt_acquisto").upload(percorso, pdf, { contentType: "application/pdf", upsert: true });
      if (up.error) { errori.push(`${f.name}: ${up.error.message}`); continue; }
      const { error } = await db.from("ddt_in_arrivo").insert({ drive_id: f.id, nome_file: f.name, percorso });
      if (error && !/duplicate|unique/i.test(error.message)) { errori.push(`${f.name}: ${error.message}`); continue; }
      if (!error) nuovi++;
    }
    return json({ nuovi, cartella: files.length, errori });
  } catch (e) {
    return json({ errore: (e as Error).message }, 500);
  }
});
