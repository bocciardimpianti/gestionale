import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Azione, type Permesso, type Profilo, type Sezione } from "./supabase";

// Stato dell'accesso:
//  caricamento -> anonimo -> (login) -> mfa_attivazione | mfa_verifica -> pronto
type Stato = "caricamento" | "anonimo" | "mfa_attivazione" | "mfa_verifica" | "pronto" | "disattivato";

interface Auth {
  stato: Stato;
  sessione: Session | null;
  profilo: Profilo | null;
  sezioni: Sezione[];
  puo: (sezione: string, azione: Azione) => boolean;
  aggiorna: () => Promise<void>;
  esci: () => Promise<void>;
}

const Ctx = createContext<Auth>(null as unknown as Auth);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [stato, setStato] = useState<Stato>("caricamento");
  const [sessione, setSessione] = useState<Session | null>(null);
  const [profilo, setProfilo] = useState<Profilo | null>(null);
  const [sezioni, setSezioni] = useState<Sezione[]>([]);
  const [permessi, setPermessi] = useState<Permesso[]>([]);

  const aggiorna = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSessione(session);
    if (!session) {
      setProfilo(null);
      setStato("anonimo");
      return;
    }

    const { data: prof } = await supabase.from("profili").select("*").eq("id", session.user.id).single();
    setProfilo(prof);
    if (prof && !prof.attivo) {
      setStato("disattivato");
      return;
    }

    // 2FA obbligatoria: se non configurata va attivata, se configurata va verificata
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      setStato(aal?.nextLevel === "aal2" ? "mfa_verifica" : "mfa_attivazione");
      return;
    }

    const [{ data: sez }, { data: per }] = await Promise.all([
      supabase.from("sezioni").select("*").order("ordine"),
      supabase.from("permessi").select("*").eq("utente_id", session.user.id),
    ]);
    // "Start Tecnici" non viene usato: non compare nel menu né nei permessi
    setSezioni((sez ?? []).filter((s) => s.chiave !== "start_tecnici"));
    setPermessi(per ?? []);
    setStato("pronto");
  }, []);

  useEffect(() => {
    aggiorna();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === "SIGNED_OUT" || evento === "SIGNED_IN") setTimeout(aggiorna, 0);
    });
    return () => subscription.unsubscribe();
  }, [aggiorna]);

  const puo = (sezione: string, azione: Azione) =>
    profilo?.ruolo === "admin" || !!permessi.find((p) => p.sezione === sezione)?.[azione];

  const esci = async () => {
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ stato, sessione, profilo, sezioni, puo, aggiorna, esci }}>
      {children}
    </Ctx.Provider>
  );
}
