import { supabase } from "./supabase";

// Notifiche sul telefono (Web Push) delle richieste di intervento.
// Il dispositivo si iscrive una volta (serve il permesso dell'utente); poi gli avvisi arrivano anche a gestionale chiuso.

export type StatoNotifiche = "non-supportate" | "iphone-da-installare" | "bloccate" | "attive" | "da-attivare";

const iPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installata = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

async function registrazione() {
  return navigator.serviceWorker.register("./sw.js", { scope: "./" });
}

export async function statoNotifiche(): Promise<StatoNotifiche> {
  if (iPhone() && !installata()) return "iphone-da-installare";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "non-supportate";
  if (Notification.permission === "denied") return "bloccate";
  if (Notification.permission !== "granted") return "da-attivare";
  const reg = await navigator.serviceWorker.getRegistration("./");
  const iscrizione = await reg?.pushManager.getSubscription();
  return iscrizione ? "attive" : "da-attivare";
}

const base64InByte = (s: string) => {
  const b = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

const nomeDispositivo = () => {
  const ua = navigator.userAgent;
  return /android/i.test(ua) ? "Android" : iPhone() ? "iPhone/iPad" : /windows/i.test(ua) ? "PC Windows" : /mac/i.test(ua) ? "Mac" : "Dispositivo";
};

// Motivo leggibile quando la funzione server "notifiche" non risponde come dovrebbe
async function motivoErrore(error: unknown) {
  const risposta = (error as { context?: Response }).context;
  const codice = risposta?.status;
  let dettaglio = "";
  try { dettaglio = (await risposta?.clone().json())?.errore ?? ""; } catch { /* risposta non in formato JSON */ }
  if (codice === 401 || codice === 403) return `La funzione "notifiche" rifiuta l'accesso (${codice}): su Supabase apri la funzione e disattiva "Verify JWT"${dettaglio ? ` (${dettaglio})` : ""}`;
  if (codice === 404) return `Funzione "notifiche" non trovata (404): su Supabase deve chiamarsi esattamente notifiche`;
  if (codice) return `La funzione "notifiche" ha dato un errore (${codice})${dettaglio ? `: ${dettaglio}` : ""}`;
  return `Funzione "notifiche" non raggiungibile: ${(error as Error)?.message ?? "nessuna risposta"}`;
}

// Da chiamare con un tocco dell'utente (il browser chiede il permesso)
export async function attivaNotifiche() {
  const permesso = await Notification.requestPermission();
  if (permesso !== "granted") throw new Error("Permesso per le notifiche non concesso");
  const reg = await registrazione();
  await navigator.serviceWorker.ready;
  let iscrizione = await reg.pushManager.getSubscription();
  if (!iscrizione) {
    const { data, error } = await supabase.functions.invoke("notifiche", { body: { azione: "chiave" } });
    if (error) throw new Error(await motivoErrore(error));
    if (!data?.chiave) throw new Error(`La funzione "notifiche" non ha restituito la chiave${data?.errore ? `: ${data.errore}` : ""}`);
    iscrizione = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64InByte(data.chiave) });
  }
  await salvaIscrizione(iscrizione);
  await supabase.functions.invoke("notifiche", { body: { azione: "prova" } });
}

async function salvaIscrizione(iscrizione: PushSubscription) {
  const j = iscrizione.toJSON();
  const { error } = await supabase.rpc("iscrivi_notifiche", {
    p_endpoint: iscrizione.endpoint, p_p256dh: j.keys?.p256dh ?? "", p_auth: j.keys?.auth ?? "", p_dispositivo: nomeDispositivo(),
  });
  if (error) throw error;
}

export async function disattivaNotifiche() {
  const reg = await navigator.serviceWorker.getRegistration("./");
  const iscrizione = await reg?.pushManager.getSubscription();
  if (!iscrizione) return;
  await supabase.rpc("disiscrivi_notifiche", { p_endpoint: iscrizione.endpoint });
  await iscrizione.unsubscribe();
}

// All'avvio: se le notifiche erano già attive, l'iscrizione viene ricollegata all'utente entrato (telefono condiviso o cambio utente)
export async function ricollegaNotifiche() {
  try {
    if (!("serviceWorker" in navigator) || !("Notification" in window) || Notification.permission !== "granted") return;
    const reg = await registrazione();
    const iscrizione = await reg.pushManager.getSubscription();
    if (iscrizione) await salvaIscrizione(iscrizione);
  } catch { /* nessun problema: si riattivano a mano */ }
}

// Avvisa chi deve sapere della richiesta (tecnico assegnato, oppure tutti i tecnici); restituisce un messaggio per l'utente
export async function avvisaRichiesta(id: number): Promise<string> {
  const { data, error } = await supabase.functions.invoke("notifiche", { body: { azione: "richiesta", id } });
  if (error) return "Avviso ai tecnici non inviato. " + (await motivoErrore(error));
  if (data?.motivo) return "";
  const nomi: string[] = data?.destinatari ?? [];
  if (!nomi.length) return "Nessun tecnico da avvisare: collega gli utenti ai tecnici e attiva le notifiche sui loro telefoni";
  return data.inviate ? `Avviso inviato a ${nomi.join(", ")}` : `${nomi.join(", ")}: notifiche non ancora attivate sul telefono`;
}
