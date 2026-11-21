// Nomi dei tecnici sempre in blu.
// TestoConTecnici: testo come "rapportino n. 101 – Rossi Mario (Gronchi Luciano)", con il nome tra parentesi in blu.
export function TestoConTecnici({ testo }: { testo: string }) {
  const pezzi = testo.split(/(\([^()]+\))/);
  return <>{pezzi.map((p, i) => (/^\(.+\)$/.test(p) ? <span key={i}>(<span className="nome-tecnico">{p.slice(1, -1)}</span>)</span> : p))}</>;
}
