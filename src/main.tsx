import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Login from "./pages/Login";
import DueFattori from "./pages/DueFattori";
import Utenti from "./pages/admin/Utenti";
import Registro from "./pages/admin/Registro";
import Dashboard from "./pages/Dashboard";
import Layout from "./Layout";
import PaginaArchivio from "./pages/PaginaArchivio";
import { ARCHIVI } from "./archivi";
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
  const { profilo, puo } = useAuth();
  const admin = profilo?.ruolo === "admin";

  return (
    <Layout>
      <Routes>
        <Route path="/" element={puo("home", "vedere") ? <Dashboard /> : <Benvenuto />} />
        <Route path="/s/:chiave" element={<PaginaSezione />} />
        {admin && <Route path="/admin/utenti" element={<Utenti />} />}
        {admin && <Route path="/admin/registro" element={<Registro />} />}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}

function Benvenuto() {
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
  if (ARCHIVI[chiave]) return <PaginaArchivio key={chiave} cfg={ARCHIVI[chiave]} />;
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
