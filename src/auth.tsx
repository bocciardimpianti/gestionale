import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Azione, type Permesso, type Profilo, type Sezione } from "./supabase";

// Stato dell'accesso:
//  caricamento -> anonimo -> (login) -> mfa_attivazione | mfa_verifica -> [cambio_password] -> pronto
type Stato = "caricamento" | "anonimo" | "mfa_attivazione" | "mfa_verifica" | "cambio_password" | "pronto" | "disattivato";

interface Auth {
  stato: Stato;
  sessione: Session | null;
  profilo: Profilo | null;
  sezioni: Sezione[];
  puo: (sezione: string, azione: Azione) => boolean;
  puoWhatsapp: boolean;
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
  // Ultimo stato raggiunto: se si era già dentro, un problema momentaneo del server non deve far uscire
  const statoAttuale = useRef<Stato>("caricamento");
  useEffect(() => { statoAttuale.current = stato; }, [stato]);
  const riprova = useRef(0);

  const aggiorna = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSessione(session);
    if (!session) {
      setProfilo(null);
      setStato("anonimo");
      return;
    }
    const giaDentro = statoAttuale.current === "pronto";
    // Server momentaneamente non raggiungibile: si resta dentro e si ricontrolla tra poco
    const problemaServer = () => {
      if (!giaDentro) return false;
      clearTimeout(riprova.current);
      riprova.current = window.setTimeout(() => aggiornaRif.current(), 15000);
      return true;
    };

    const { data: prof, error: errProf } = await supabase.from("profili").select("*").eq("id", session.user.id).single();
    if (errProf && problemaServer()) return;
    setProfilo(prof);
    if (prof && !prof.attivo) {
      setStato("disattivato");
      return;
    }

    // 2FA obbligatoria: se non configurata va attivata, se configurata va verificata
    const { data: aal, error: errAal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if ((errAal || !aal) && problemaServer()) return;
    if (aal?.currentLevel !== "aal2") {
      setStato(aal?.nextLevel === "aal2" ? "mfa_verifica" : "mfa_attivazione");
      return;
    }

    if (session.user.user_metadata?.password_provvisoria) {
      setStato("cambio_password");
      return;
    }

    const [{ data: sez, error: errSez }, { data: per, error: errPer }] = await Promise.all([
      supabase.from("sezioni").select("*").order("ordine"),
      supabase.from("permessi").select("*").eq("utente_id", session.user.id),
    ]);
    if ((errSez || errPer) && problemaServer()) return;
    // "Start Tecnici" non viene usato: non compare nel menu né nei permessi
    setSezioni((sez ?? []).filter((s) => s.chiave !== "start_tecnici"));
    setPermessi(per ?? []);
    setStato("pronto");
  }, []);
  const aggiornaRif = useRef(aggiorna);
  aggiornaRif.current = aggiorna;

  useEffect(() => {
    aggiorna();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === "SIGNED_OUT" || evento === "SIGNED_IN") setTimeout(aggiorna, 0);
    });
    return () => subscription.unsubscribe();
  }, [aggiorna]);

  const puo = (sezione: string, azione: Azione) =>
    profilo?.ruolo === "admin" || !!permessi.find((p) => p.sezione === sezione)?.[azione];

  // L'uscita deve riuscire sempre: se il server non risponde o l'operazione resta bloccata,
  // la sessione viene cancellata da questo browser e la pagina ricaricata.
  const esci = async () => {
    const riuscita = await Promise.race([
      supabase.auth.signOut().then(({ error }) => !error).catch(() => false),
      new Promise<boolean>((fine) => setTimeout(() => fine(false), 5000)),
    ]);
    if (riuscita) return;
    Object.keys(localStorage).filter((k) => k.startsWith("sb-")).forEach((k) => localStorage.removeItem(k));
    location.reload();
  };

  return (
    <Ctx.Provider value={{ stato, sessione, profilo, sezioni, puo, puoWhatsapp: profilo?.ruolo === "admin" || !!profilo?.whatsapp, aggiorna, esci }}>
      {children}
    </Ctx.Provider>
  );
}
