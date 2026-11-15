// Tecnico che ha ordinato/ritirato il materiale, riconosciuto dal testo del DDT del fornitore
// (es. Palagini "RITIRA, DA VOI AUTORIZZATO: Luciano", MEF "VOSTRO RIFERIMENTO: Stefano", CLLAT "CLAUDIO").
// Valgono le parole del nome del tecnico e i suoi "altri nomi" (es. "Maicol"); le parole comuni a più tecnici
// (es. lo stesso cognome) non bastano a riconoscerlo.

export type TecnicoDdt = { id: number; nome: string; altri_nomi?: string | null };

const parole = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).filter((w) => w.length >= 3);

// Una lettera sbagliata/mancante/in più è tollerata nelle parole lunghe (es. "Lucano")
function vicine(a: string, b: string) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

export function tecnicoDaTesto(testo: string, tecnici: TecnicoDdt[]): { tecnico: TecnicoDdt; parola: string } | null {
  const perParola = new Map<string, Set<number>>();
  // "Amministrazione" non è una persona: non si cerca sui DDT
  for (const t of tecnici.filter((x) => !/amministrazione/i.test(x.nome))) for (const w of parole(`${t.nome} ${t.altri_nomi ?? ""}`)) perParola.set(w, (perParola.get(w) ?? new Set()).add(t.id));
  // Solo le parole che indicano un tecnico preciso
  const uniche = [...perParola.entries()].filter(([, ids]) => ids.size === 1).map(([w, ids]) => [w, [...ids][0]] as const);
  const trovati = new Map<number, string>();
  for (const w of parole(testo)) for (const [p, id] of uniche) if (vicine(w, p)) trovati.set(id, w);
  if (trovati.size !== 1) return null;
  const [[id, parola]] = [...trovati.entries()];
  return { tecnico: tecnici.find((t) => t.id === id)!, parola };
}
