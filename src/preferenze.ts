import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

// Preferenze dell'utente (es. scelte fatte nei grafici): subito dal dispositivo, poi da Supabase (script 0054)
// così sono uguali su tablet e computer. Senza lo script restano salvate solo sul dispositivo.

const locale = (chiave: string) => `pref:${chiave}`;
function leggiLocale<T>(chiave: string): T | undefined {
  try { const t = localStorage.getItem(locale(chiave)); return t === null ? undefined : (JSON.parse(t) as T); } catch { return undefined; }
}
function scriviLocale(chiave: string, v: unknown) {
  try { localStorage.setItem(locale(chiave), JSON.stringify(v)); } catch { /* spazio pieno o bloccato: pazienza */ }
}

export function usePreferenza<T>(chiave: string, iniziale: T): [T, (v: T | ((x: T) => T)) => void] {
  const [valore, setValore] = useState<T>(() => ({ ...(iniziale as object), ...(leggiLocale<T>(chiave) as object) }) as T);
  const timer = useRef<number>();
  const toccato = useRef(false);

  // Quelle salvate sul server vincono (ultime scelte fatte, anche da un altro dispositivo)
  useEffect(() => {
    let attivo = true;
    supabase.from("preferenze_utente").select("valore").eq("chiave", chiave).maybeSingle().then(({ data, error }) => {
      if (!attivo || error || !data?.valore || toccato.current) return;
      setValore((v) => ({ ...(v as object), ...(data.valore as object) }) as T);
      scriviLocale(chiave, data.valore);
    });
    return () => { attivo = false; };
  }, [chiave]);

  const imposta = useCallback((v: T | ((x: T) => T)) => {
    toccato.current = true;
    setValore((prima) => {
      const nuovo = typeof v === "function" ? (v as (x: T) => T)(prima) : v;
      scriviLocale(chiave, nuovo);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        supabase.from("preferenze_utente").upsert({ chiave, valore: nuovo, modificato_il: new Date().toISOString() }, { onConflict: "utente_id,chiave" }).then(() => {});
      }, 700);
      return nuovo;
    });
  }, [chiave]);

  return [valore, imposta];
}
