import { useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  Banknote, CalendarDays, CircleHelp, CirclePlus, ClipboardCheck, ClipboardList, Database, FileText,
  LogOut, MessageCircle, Monitor, Paperclip, PieChart, Puzzle, RefreshCw, Rocket, ScrollText,
  Settings, Smartphone, Star, User, UserRound, Users, Wrench, type LucideIcon,
} from "lucide-react";
import { useAuth } from "./auth";

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
  const admin = profilo?.ruolo === "admin";
  const [chiusi, setChiusi] = useState<Record<string, boolean>>({});

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
        { chiave: "admin/utenti", etichetta: "Utenti e permessi", gruppo: "", ordine: 0 },
        { chiave: "admin/registro", etichetta: "Registro attività", gruppo: "", ordine: 0 },
      ],
    });
  }
  const iconaAdmin: Record<string, LucideIcon> = { "admin/utenti": Users, "admin/registro": ScrollText };
  const percorso = (chiave: string) => (chiave === "home" ? "/" : chiave.startsWith("admin/") ? `/${chiave}` : `/s/${chiave}`);

  const scorciatoia = (chiave: string, Icona: LucideIcon, titolo: string) =>
    puo(chiave, "vedere") && (
      <Link to={percorso(chiave)} title={titolo}><Icona size={20} strokeWidth={1.5} /></Link>
    );

  return (
    <div className="app">
      <header className="barra-alta">
        <Logo />
        <div className="icone-alte">
          <button className="utente-alto" title="Esci per cambiare utente" onClick={esci}>
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

      <aside className="laterale">
        <div className="azienda">
          <span>Bocciardi Impianti</span>
          <Database size={22} strokeWidth={1.5} />
        </div>
        <nav>
          {gruppi.map((g) => (
            <div key={g.nome}>
              <button className="gruppo" onClick={() => setChiusi({ ...chiusi, [g.nome]: !chiusi[g.nome] })}>
                <span>{g.nome}</span>
                <span className={chiusi[g.nome] ? "freccia chiusa" : "freccia"}>▼</span>
              </button>
              {!chiusi[g.nome] &&
                g.voci.map((s) => {
                  const Icona = ICONE[s.chiave] ?? iconaAdmin[s.chiave] ?? FileText;
                  return (
                    <NavLink key={s.chiave} to={percorso(s.chiave)} end className="voce">
                      <Icona size={18} strokeWidth={1.3} />
                      {s.etichetta}
                    </NavLink>
                  );
                })}
            </div>
          ))}
        </nav>
        <div className="utente">
          <div>{profilo?.nome || profilo?.email}</div>
          <div className="ruolo">{admin ? "Amministratore" : "Utente standard"}</div>
          <button className="esci" onClick={esci}><LogOut size={15} /> Esci / Cambia utente</button>
        </div>
      </aside>

      <main className="centro">{children}</main>

      <footer className="barra-bassa">
        <div className="gruppo-icone">
          {admin && <Link to="/admin/utenti" title="Impostazioni"><Settings size={20} strokeWidth={1.5} /></Link>}
          <span title="Statistiche"><PieChart size={20} strokeWidth={1.5} /></span>
          <span title="Novità"><Rocket size={20} strokeWidth={1.5} /></span>
          <span title="Moduli"><Puzzle size={20} strokeWidth={1.5} /></span>
          <button title="Esci" onClick={esci}><LogOut size={20} strokeWidth={1.5} /></button>
        </div>
        <div className="gruppo-icone">
          {scorciatoia("clienti", User, "Clienti")}
          {scorciatoia("rapporti", FileText, "Rapporti di intervento")}
          {scorciatoia("preventivi", ClipboardList, "Preventivi")}
          {scorciatoia("materiali", Wrench, "Materiali")}
        </div>
      </footer>
    </div>
  );
}
