// Foto dei materiali per gli elenchi che hanno solo l'id del materiale (righe dei rapportini, materiali di un DDT…).
// Le foto già lette restano in memoria: si chiedono al database solo quelle nuove.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

const lette = new Map<number, string | null>();

export function useFotoMateriali(ids: (number | null | undefined)[]) {
  const chiave = [...new Set(ids.filter((v): v is number => !!v))].sort((a, b) => a - b).join(",");
  const [, setVersione] = useState(0);
  useEffect(() => {
    const mancanti = chiave ? chiave.split(",").map(Number).filter((id) => !lette.has(id)) : [];
    if (!mancanti.length) return;
    let attivo = true;
    supabase.from("materiali").select("id, foto").in("id", mancanti).then(({ data }) => {
      for (const id of mancanti) lette.set(id, null);
      for (const m of data ?? []) lette.set(Number(m.id), (m.foto as string | null) || null);
      if (attivo) setVersione((v) => v + 1);
    });
    return () => { attivo = false; };
  }, [chiave]);
  return (id: number | null | undefined) => (id ? lette.get(id) ?? null : null);
}
