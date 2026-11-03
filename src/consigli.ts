// Materiali consigliati: nessun servizio esterno, solo i rapportini già salvati.
// Se nei lavori con i materiali scelti compare spesso un altro materiale, viene proposto.
// Ogni nuovo rapportino salvato entra nel conto, quindi i consigli migliorano con l'uso.

export interface RigaStorico { rapporto_id: number; materiale_id: number | null; quantita: number | null }
export interface Consiglio { materialeId: number; volte: number; su: number; quantita: number; punteggio: number }

// Parole troppo generiche per dire che due materiali sono dello stesso tipo
const GENERICHE = new Set(["tubo", "raccordo", "valvola", "kit", "per", "con", "materiale", "materiali", "vari", "varie", "pezzo", "serie", "nuovo"]);

// Prima parola che descrive il tipo di materiale (es. "CALDAIA" in "CALDAIA RIELLO 24 KW")
export function parolaChiave(descrizione: unknown) {
  const parole = String(descrizione ?? "").toLowerCase().split(/[^a-zàèéìòù]+/).filter((p) => p.length >= 4);
  return parole.find((p) => !GENERICHE.has(p)) ?? "";
}

const mediana = (valori: number[]) => {
  const v = valori.filter((x) => x > 0).sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : 1;
};

export function calcolaConsigli(storico: RigaStorico[], semi: number[], escludi: number[] = [], massimo = 15): Consiglio[] {
  const semiSet = new Set(semi);
  const fuori = new Set([...semi, ...escludi]);
  const perRapporto = new Map<number, Map<number, number>>();
  const usi = new Map<number, number>();
  for (const r of storico) {
    if (!r.materiale_id) continue;
    let materiali = perRapporto.get(r.rapporto_id);
    if (!materiali) perRapporto.set(r.rapporto_id, (materiali = new Map()));
    if (!materiali.has(r.materiale_id)) usi.set(r.materiale_id, (usi.get(r.materiale_id) ?? 0) + 1);
    materiali.set(r.materiale_id, (materiali.get(r.materiale_id) ?? 0) + Number(r.quantita ?? 0));
  }
  const totaleRapporti = perRapporto.size;
  const candidati = new Map<number, { volte: number; peso: number; quantita: number[] }>();
  let simili = 0;
  for (const materiali of perRapporto.values()) {
    const presenti = [...materiali.keys()].filter((id) => semiSet.has(id)).length;
    if (!presenti) continue;
    simili++;
    // Un rapportino con più materiali in comune con quello attuale conta di più
    const peso = presenti / Math.max(semiSet.size, 1);
    for (const [id, quantita] of materiali) {
      if (fuori.has(id)) continue;
      const c = candidati.get(id) ?? { volte: 0, peso: 0, quantita: [] };
      c.volte++;
      c.peso += peso;
      c.quantita.push(quantita);
      candidati.set(id, c);
    }
  }
  const minimo = simili >= 3 ? 2 : 1;
  return [...candidati.entries()]
    .filter(([, c]) => c.volte >= minimo)
    .map(([materialeId, c]) => {
      const frequenza = c.volte / simili;
      const generale = (usi.get(materialeId) ?? 0) / Math.max(totaleRapporti, 1);
      // I materiali presenti in quasi tutti i lavori (es. minuteria) valgono meno di quelli tipici di questo lavoro
      const tipico = generale > 0 ? Math.min(frequenza / generale, 3) : 1;
      return { materialeId, volte: c.volte, su: simili, quantita: mediana(c.quantita), punteggio: (c.peso / simili) * tipico };
    })
    .sort((a, b) => b.punteggio - a.punteggio || b.volte - a.volte)
    .slice(0, massimo);
}
