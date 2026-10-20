import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Navigate, NavLink, Route, Routes, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Login from "./pages/Login";
import DueFattori from "./pages/DueFattori";
import Utenti from "./pages/admin/Utenti";
import Registro from "./pages/admin/Registro";
import "./styles.css";

function App() {
  const { stato, esci } = useAuth();

  switch (stato) {
    case "caricamento":
      return <div className="schermo-accesso">Caricamento…</div>;
    case "anonimo":
      return <Login />;
    case "mfa_attivazione":
      return <DueFattori attivazione />;
    case "mfa_verifica":
      return <DueFattori attivazione={false} />;
    case "disattivato":
      return (
        <div className="schermo-accesso">
          <div className="riquadro">
            <p>Il tuo account è disattivato. Contatta l'amministratore.</p>
            <button onClick={esci}>Esci</button>
          </div>
        </div>
      );
  }

  return (
    <HashRouter>
      <Struttura />
    </HashRouter>
  );
}

function Struttura() {
  const { profilo, sezioni, puo, esci } = useAuth();
  const admin = profilo?.ruolo === "admin";
  const visibili = sezioni.filter((s) => puo(s.chiave, "vedere"));

  return (
    <div className="struttura">
      <aside className="menu">
        <div className="marchio">Gestionale</div>
        <nav>
          <NavLink to="/" end>Home</NavLink>
          {visibili.map((s) => (
            <NavLink key={s.chiave} to={`/s/${s.chiave}`}>{s.etichetta}</NavLink>
          ))}
          {admin && (
            <>
              <div className="gruppo">Pannello di controllo</div>
              <NavLink to="/admin/utenti">Utenti e permessi</NavLink>
              <NavLink to="/admin/registro">Registro attività</NavLink>
            </>
          )}
        </nav>
        <div className="utente">
          <div>{profilo?.nome || profilo?.email}</div>
          <div className="piccolo">{admin ? "Amministratore" : "Utente standard"}</div>
          <button className="collegamento" onClick={esci}>Esci</button>
        </div>
      </aside>
      <main className="contenuto">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/s/:chiave" element={<PaginaSezione />} />
          {admin && <Route path="/admin/utenti" element={<Utenti />} />}
          {admin && <Route path="/admin/registro" element={<Registro />} />}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

function Home() {
  const { profilo } = useAuth();
  return (
    <>
      <h2>Benvenuto, {profilo?.nome || profilo?.email}</h2>
      <p>Seleziona una sezione dal menu.</p>
    </>
  );
}

// Segnaposto: ogni sezione verrà ricostruita fedelmente dalle schermate del programma originale
function PaginaSezione() {
  const { chiave = "" } = useParams();
  const { sezioni, puo } = useAuth();
  const sezione = sezioni.find((s) => s.chiave === chiave);
  if (!sezione || !puo(chiave, "vedere")) return <p className="errore">Non hai accesso a questa sezione.</p>;
  return (
    <>
      <h2>{sezione.etichetta}</h2>
      <p className="piccolo">Sezione in preparazione: verrà ricreata dalle schermate del programma originale.</p>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);
