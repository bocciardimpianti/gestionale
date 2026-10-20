import { useEffect, useState } from "react";
import { supabase } from "../../supabase";

interface Voce {
  id: number;
  azione: string;
  dettagli: unknown;
  il: string;
  profili: { email: string } | null;
}

export default function Registro() {
  const [voci, setVoci] = useState<Voce[]>([]);

  useEffect(() => {
    supabase
      .from("registro")
      .select("id, azione, dettagli, il, profili(email)")
      .order("il", { ascending: false })
      .limit(500)
      .then(({ data }) => setVoci((data as unknown as Voce[]) ?? []));
  }, []);

  return (
    <>
      <h2>Registro attività</h2>
      <table className="griglia">
        <thead><tr><th>Data e ora</th><th>Utente</th><th>Azione</th><th>Dettagli</th></tr></thead>
        <tbody>
          {voci.map((v) => (
            <tr key={v.id}>
              <td>{new Date(v.il).toLocaleString("it-IT")}</td>
              <td>{v.profili?.email ?? "—"}</td>
              <td>{v.azione.replace(/_/g, " ")}</td>
              <td className="piccolo">{v.dettagli ? JSON.stringify(v.dettagli) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
