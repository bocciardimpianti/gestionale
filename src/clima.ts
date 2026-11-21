// Unità esterne dei climatizzatori (anche i kit completi interna + esterna), riconosciute dalla descrizione del materiale:
// quando un tecnico ne monta una, nel rapportino serve la foto della matricola.
const ESTERNA = /unit[aà]'?\s+est|macchina esterna|\bu\.?e\.?\b|\bmuz-?|\bsuz-?|\bmxz-?|\bpumy|\baoe[ghl]|\bpuhz|\brxm|\barxm|\b2mxm|\b3mxm|mono ?split.*(\+|\bue\b)|(dual|trial|quadri|multi) ?split.*(esterna|\bue\b|inverter)|pompa di calore.*(esterna|monoblocco)/i;
const ACCESSORIO = /staff|supporto|piedin|antivibr|\bbase\b|copertur|cover|tubo|canalin|telecomando|distributor|giunto|sonda|filtro|kit (install|stagione|spray)|staffa|griglia|pompa (condensa|scarico)|resistenza/i;

export const eUnitaEsterna = (descrizione: unknown) => {
  const d = String(descrizione ?? "");
  return ESTERNA.test(d) && !ACCESSORIO.test(d);
};

// Unità interne (a parete, console, pavimento, canalizzabili, cassette): vanno nel documento F-gas con l'esterna
const INTERNA = /unit[aà]'?\s+int|\bu\.?i\.?\b|\bmsz-?|\bmfz-?|\bsfz-?|\bslz-?|\bpead-?|\basyg|\baseh|\basyh|\bfxsq|\bftxm|\bftxj|cassetta 4 ?vie|split a parete|\bconsole\b/i;
export const eUnitaInterna = (descrizione: unknown) => {
  const d = String(descrizione ?? "");
  return INTERNA.test(d) && !ACCESSORIO.test(d) && !eUnitaEsterna(d);
};

/** Testo per il documento F-gas: "2 × UNITA' INTERNA …; 1 × …" (quantità sommate per descrizione) */
export function testoUnitaInterne(righe: { descrizione?: unknown; quantita?: unknown }[]) {
  const per = new Map<string, number>();
  for (const r of righe) if (eUnitaInterna(r.descrizione)) {
    const d = String(r.descrizione).trim();
    per.set(d, (per.get(d) ?? 0) + (Number(r.quantita) || 1));
  }
  return [...per.entries()].map(([d, q]) => `${q.toLocaleString("it-IT")} × ${d}`).join("; ");
}
