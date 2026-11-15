import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Banknote, CalendarDays, CircleHelp, CirclePlus, ClipboardCheck, ClipboardList, Database, FileText,
  LogOut, Menu, MessageCircle, Monitor, Paperclip, PieChart, Puzzle, RefreshCw, Rocket, ScrollText,
  Search, Settings, Smartphone, Star, Type, User, UserRound, Users, Wrench, X, type LucideIcon,
  ChevronDown, PanelLeftClose, PanelLeftOpen, Plus,
} from "lucide-react";
import TavolozzaComandi, { type Comando } from "./components/TavolozzaComandi";
import { ARCHIVI } from "./archivi";
import { supabase } from "./supabase";
import FinestraAspetto from "./components/FinestraAspetto";
import { useAuth } from "./auth";
import UscitaBackup from "./components/UscitaBackup";
import PulsanteVoce from "./components/PulsanteVoce";
import { ricollegaNotifiche } from "./notifiche";
import { useIndietroChiude } from "./telefono";

// Icone delle voci di menu, come nel programma originale
export const ICONE: Record<string, LucideIcon> = {
  home: Monitor,
  start_tecnici: Star,
  clienti: User,
  fornitori: UserRound,
  tecnici: User,
  impianti: Paperclip,
  rapporti: FileText,
  agenda: CalendarDays,
  preventivi: ClipboardList,
  richieste: Smartphone,
  ddt_acquisto: ClipboardCheck,
  materiali: Wrench,
  scadenziario: Banknote,
  conti_clienti: Banknote,
};

// Iniziali per l'avatar (es. "Michael Gronchi" → "MG")
const iniziali = (nome: string) => nome.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export function Logo() {
  return (
    <span className="logo">
      GESTION<span className="arancio">ALE</span>
    </span>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { profilo, sezioni, puo, esci } = useAuth();
  const naviga = useNavigate();
  const inHome = useLocation().pathname === "/";
  const admin = profilo?.ruolo === "admin";
  // Gruppi del menu chiusi e menu ridotto a icone (PC): ricordati su questo dispositivo
  const [chiusi, setChiusiStato] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("menu-gruppi-chiusi") ?? "{}"); } catch { return {}; }
  });
  const setChiusi = (v: Record<string, boolean>) => {
    setChiusiStato(v);
    try { localStorage.setItem("menu-gruppi-chiusi", JSON.stringify(v)); } catch { /* non salvato */ }
  };
  const [stretto, setStrettoStato] = useState(() => { try { return localStorage.getItem("menu-stretto") === "1"; } catch { return false; } });
  const setStretto = (v: boolean) => {
    setStrettoStato(v);
    try { localStorage.setItem("menu-stretto", v ? "1" : "0"); } catch { /* non salvato */ }
  };
  // "Vai a…" (Ctrl+K)
  const [tavolozza, setTavolozza] = useState(false);
  useEffect(() => {
    const tasto = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setTavolozza((v) => !v); }
    };
    window.addEventListener("keydown", tasto);
    return () => window.removeEventListener("keydown", tasto);
  }, []);
  // Richieste di intervento ancora aperte: contatore accanto alla voce del menu
  const [richiesteAperte, setRichiesteAperte] = useState(0);
  const percorsoAttuale = useLocation().pathname;
  const vedeRichieste = puo("richieste", "vedere");
  useEffect(() => {
    if (!vedeRichieste) return;
    let attivo = true;
    const conta = () => supabase.from("richieste").select("id", { count: "exact", head: true })
      .is("eliminato_il", null).not("stato", "in", "(Completata,Annullata)")
      .then(({ count }) => { if (attivo) setRichiesteAperte(count ?? 0); });
    conta();
    const t = setInterval(conta, 120_000);
    return () => { attivo = false; clearInterval(t); };
  }, [vedeRichieste, percorsoAttuale]);
  // Sul cellulare il menu laterale si apre e chiude con il pulsante ☰
  const [menuAperto, setMenuAperto] = useState(false);
  useIndietroChiude(menuAperto, () => setMenuAperto(false));
  // All'uscita l'admin che usa un PC (mouse) può salvare il backup completo
  const [finestraBackup, setFinestraBackup] = useState<"" | "uscita" | "backup">("");
  const [aspetto, setAspetto] = useState(false);
  const daPc = typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
  const richiediUscita = () => (admin && daPc ? setFinestraBackup("uscita") : esci());
  // Notifiche: il dispositivo resta collegato all'utente entrato; toccando una notifica si apre la richiesta
  useEffect(() => { if (profilo?.id) ricollegaNotifiche(); }, [profilo?.id]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const apri = (e: MessageEvent) => {
      if (e.data?.tipo !== "apri" || typeof e.data.url !== "string") return;
      const hash = e.data.url.split("#")[1];
      if (hash) location.hash = hash;
    };
    navigator.serviceWorker.addEventListener("message", apri);
    return () => navigator.serviceWorker.removeEventListener("message", apri);
  }, []);

  // Raggruppa le sezioni visibili mantenendo l'ordine
  const gruppi: { nome: string; voci: typeof sezioni }[] = [];
  for (const s of sezioni.filter((s) => puo(s.chiave, "vedere"))) {
    const g = gruppi.find((g) => g.nome === s.gruppo);
    if (g) g.voci.push(s);
    else gruppi.push({ nome: s.gruppo, voci: [s] });
  }
  if (admin) {
    gruppi.push({
      nome: "AMMINISTRAZIONE",
      voci: [
        { chiave: "admin/utenti", etichetta: "Utenti, permessi e tecnici", gruppo: "", ordine: 0 },
        { chiave: "admin/registro", etichetta: "Registro attività", gruppo: "", ordine: 0 },
      ],
    });
  }
  const iconaAdmin: Record<string, LucideIcon> = { "admin/utenti": Users, "admin/registro": ScrollText };
  const percorso = (chiave: string) => (chiave === "home" ? "/" : chiave.startsWith("admin/") ? `/${chiave}` : `/s/${chiave}`);

  // Voci di "Vai a…": tutte le sezioni del menu, i "Nuovo…" permessi e alcune azioni
  const comandi: Comando[] = [
    ...gruppi.flatMap((g) => g.voci.map((s) => ({
      id: `vai:${s.chiave}`, titolo: s.etichetta, gruppo: "Vai a", Icona: ICONE[s.chiave] ?? iconaAdmin[s.chiave] ?? FileText,
      parole: g.nome, esegui: () => naviga(percorso(s.chiave)),
    }))),
    ...Object.values(ARCHIVI).filter((c) => c.titoloNuovo && puo(c.sezione, "creare") && sezioni.some((s) => s.chiave === c.sezione)).map((c) => ({
      id: `nuovo:${c.sezione}`, titolo: c.titoloNuovo!, gruppo: "Crea", Icona: Plus, parole: `nuovo crea aggiungi ${c.titolo}`,
      esegui: () => naviga(`/s/${c.sezione}?nuovo=1`),
    })),
    { id: "cerca", titolo: "Cerca ovunque", gruppo: "Azioni", Icona: Search, parole: "trova ricerca", esegui: () => naviga("/cerca") },
    { id: "aspetto", titolo: "Aspetto e dimensioni", gruppo: "Azioni", Icona: Type, parole: "grandezza testo zoom", esegui: () => setAspetto(true) },
    ...(admin ? [{ id: "backup", titolo: "Backup completo", gruppo: "Azioni", Icona: Database, parole: "salva copia", esegui: () => setFinestraBackup("backup") }] : []),
    { id: "esci", titolo: "Esci / Cambia utente", gruppo: "Azioni", Icona: LogOut, parole: "logout", esegui: richiediUscita },
  ];

  const scorciatoia = (chiave: string, Icona: LucideIcon, titolo: string) =>
    puo(chiave, "vedere") && (
      <NavLink to={percorso(chiave)} title={titolo} className="scorciatoia"><Icona size={20} strokeWidth={1.5} /><span className="etichetta-telefono">{titolo}</span></NavLink>
    );

  return (
    <div className="app">
      <header className="barra-alta">
        <button className="apri-menu" title="Menu" onClick={() => setMenuAperto(!menuAperto)}>
          {menuAperto ? <X size={24} /> : <Menu size={24} />}
          <span>Menu</span>
        </button>
        <Logo />
        {import.meta.env.VITE_PROVA && <span className="etichetta-prova">PROVA</span>}
        <div className="icone-alte">
          <button className="cerca-alto" title="Cerca ovunque (impianti, clienti, rapportini…)" onClick={() => naviga("/cerca")}>
            <Search size={20} strokeWidth={1.8} /><span>Cerca</span>
          </button>
          <button className="utente-alto" title="Esci per cambiare utente" onClick={richiediUscita}>
            <span>{profilo?.nome || profilo?.email}</span>
            <LogOut size={20} strokeWidth={1.5} />
            <span>Esci</span>
          </button>
          <button title="Nuovo" onClick={() => naviga("/")}><CirclePlus size={26} strokeWidth={1.3} /></button>
          <button title="Aggiorna" onClick={() => location.reload()}><RefreshCw size={24} strokeWidth={1.3} /></button>
          <button title="Aiuto"><CircleHelp size={26} strokeWidth={1.3} /></button>
          <button title="Messaggi"><MessageCircle size={26} strokeWidth={1.3} /></button>
        </div>
      </header>

      {menuAperto && <div className="velo-menu" onClick={() => setMenuAperto(false)} />}
      <aside className={`laterale${menuAperto ? " aperto" : ""}${stretto ? " stretto" : ""}`} onClick={(e) => {
        // Scelta una voce, il menu del cellulare si chiude
        if ((e.target as HTMLElement).closest("a, .chiude-menu")) setMenuAperto(false);
      }}>
        <div className="azienda">
          <span className="marchio" aria-hidden>B</span>
          <span className="nome-azienda">Bocciardi Impianti</span>
          <button type="button" className="riduci-menu" title={stretto ? "Allarga il menu" : "Riduci il menu a icone"} onClick={() => setStretto(!stretto)}>
            {stretto ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <div className="azioni-menu">
          <button type="button" className="vai-a chiude-menu" title="Vai a una sezione o un'azione (Ctrl+K)" onClick={() => setTavolozza(true)}>
            <Search size={16} /><span className="testo-voce">Vai a…</span><kbd>Ctrl K</kbd>
          </button>
          {puo("rapporti", "creare") && (
            <button type="button" className="nuovo-rapido chiude-menu" title="Nuovo rapportino di intervento" onClick={() => naviga("/s/rapporti?nuovo=1")}>
              <Plus size={17} strokeWidth={2.4} /><span className="testo-voce">Nuovo rapportino</span>
            </button>
          )}
        </div>
        <nav>
          {gruppi.map((g) => (
            <div key={g.nome} className="gruppo-menu">
              <button className="gruppo" onClick={() => setChiusi({ ...chiusi, [g.nome]: !chiusi[g.nome] })} title={g.nome}>
                <span>{g.nome}</span>
                <ChevronDown size={14} className={chiusi[g.nome] ? "freccia chiusa" : "freccia"} />
              </button>
              {(!chiusi[g.nome] || stretto) &&
                g.voci.map((s) => {
                  const Icona = ICONE[s.chiave] ?? iconaAdmin[s.chiave] ?? FileText;
                  const contatore = s.chiave === "richieste" ? richiesteAperte : 0;
                  return (
                    <NavLink key={s.chiave} to={percorso(s.chiave)} end className="voce" title={s.etichetta}>
                      <Icona size={18} strokeWidth={1.6} />
                      <span className="testo-voce">{s.etichetta}</span>
                      {contatore > 0 && <span className="contatore" title={`${contatore} richieste aperte`}>{contatore > 99 ? "99+" : contatore}</span>}
                    </NavLink>
                  );
                })}
            </div>
          ))}
        </nav>
        <div className="utente">
          <div className="scheda-utente">
            <span className="avatar" aria-hidden>{iniziali(profilo?.nome || profilo?.email || "")}</span>
            <span className="testo-voce">
              <b>{profilo?.nome || profilo?.email}</b>
              <span className="ruolo">{admin ? "Amministratore" : profilo?.mansione || "Utente"}</span>
            </span>
          </div>
          <div className="comandi-utente">
            {admin && <button type="button" className="chiude-menu" title="Backup completo" onClick={() => setFinestraBackup("backup")}><Database size={16} /><span className="testo-voce">Backup</span></button>}
            <button type="button" className="chiude-menu" title="Aspetto e dimensioni" onClick={() => setAspetto(true)}><Type size={16} /><span className="testo-voce">Aspetto</span></button>
            <button type="button" className="esci-menu" title="Esci / Cambia utente" onClick={richiediUscita}><LogOut size={16} /><span className="testo-voce">Esci</span></button>
          </div>
        </div>
      </aside>
      {tavolozza && <TavolozzaComandi comandi={comandi} onChiudi={() => setTavolozza(false)} cercaOvunque={(t) => naviga(`/cerca?q=${encodeURIComponent(t)}`)} />}

      <main className="centro">{children}</main>

      <footer className="barra-bassa">
        <div className="gruppo-icone">
          {admin && <Link to="/admin/utenti" title="Impostazioni"><Settings size={20} strokeWidth={1.5} /></Link>}
          <span title="Statistiche"><PieChart size={20} strokeWidth={1.5} /></span>
          <span title="Novità"><Rocket size={20} strokeWidth={1.5} /></span>
          <span title="Moduli"><Puzzle size={20} strokeWidth={1.5} /></span>
          <button title="Esci" onClick={richiediUscita}><LogOut size={20} strokeWidth={1.5} /></button>
        </div>
        <div className="gruppo-icone">
          {scorciatoia("clienti", User, "Clienti")}
          {scorciatoia("rapporti", FileText, "Rapporti")}
          {scorciatoia("preventivi", ClipboardList, "Preventivi")}
          {scorciatoia("materiali", Wrench, "Materiali")}
        </div>
      </footer>
      {/* Microfono mobile dei comandi vocali solo nella Home; le ricerche hanno il loro microfono fisso */}
      {inHome && <PulsanteVoce />}
      {aspetto && <FinestraAspetto onChiudi={() => setAspetto(false)} />}
      {finestraBackup && (
        <UscitaBackup
          soloBackup={finestraBackup === "backup"}
          onEsci={() => { setFinestraBackup(""); esci(); }}
          onAnnulla={() => setFinestraBackup("")}
        />
      )}
    </div>
  );
}
