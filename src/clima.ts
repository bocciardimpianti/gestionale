// Unità esterne dei climatizzatori (anche i kit completi interna + esterna), riconosciute dalla descrizione del materiale:
// quando un tecnico ne monta una, nel rapportino serve la foto della matricola.
const ESTERNA = /unit[aà]'?\s+est|macchina esterna|\bu\.?e\.?\b|\bmuz-?|\bsuz-?|\bmxz-?|\bpumy|\baoe[ghl]|\bpuhz|\brxm|\barxm|\b2mxm|\b3mxm|mono ?split.*(\+|\bue\b)|(dual|trial|quadri|multi) ?split.*(esterna|\bue\b|inverter)|pompa di calore.*(esterna|monoblocco)/i;
const ACCESSORIO = /staff|supporto|piedin|antivibr|\bbase\b|copertur|cover|tubo|canalin|telecomando|distributor|giunto|sonda|filtro|kit (install|stagione|spray)|staffa|griglia|pompa (condensa|scarico)|resistenza/i;

export const eUnitaEsterna = (descrizione: unknown) => {
  const d = String(descrizione ?? "");
  return ESTERNA.test(d) && !ACCESSORIO.test(d);
};
