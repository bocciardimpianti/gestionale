// Apre WhatsApp sul numero indicato: il messaggio si scrive e si invia da WhatsApp, con l'account di chi lo usa.
// Un campo può contenere più numeri ("0585 123456 / 333 1234567"): vale il primo cellulare, altrimenti il primo numero.
export function linkWhatsapp(testo: unknown): string | null {
  const numeri = String(testo ?? "")
    .split(/[/;,]|\s-\s/)
    .map((n) => {
      const pulito = n.replace(/[^\d+]/g, "");
      if (pulito.startsWith("+")) return pulito.slice(1);
      if (pulito.startsWith("00")) return pulito.slice(2);
      if (pulito.length === 12 && pulito.startsWith("39")) return pulito;
      return pulito ? `39${pulito}` : "";
    })
    .filter((n) => n.length >= 10 && n.length <= 15);
  const scelto = numeri.find((n) => n.startsWith("393")) ?? numeri[0];
  return scelto ? `https://wa.me/${scelto}` : null;
}
