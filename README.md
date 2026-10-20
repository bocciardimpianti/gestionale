# Gestionale

Applicazione web: React + Vite, ospitata su **GitHub Pages**. Dati, login e 2FA sono gestiti da **Supabase**.

## Sicurezza
- Login con email e password, poi **verifica in due passaggi obbligatoria** con un'app Authenticator (codice TOTP a 6 cifre). Va attivata al primo accesso.
- Il database rifiuta qualsiasi lettura o scrittura se la sessione non ha superato la 2FA (`aal2`). Il controllo è fatto con Row Level Security sul server, quindi non si aggira modificando il browser.
- **Admin**: vede e fa tutto, gestisce utenti e permessi, consulta il registro attività.
- **Standard**: per ogni sezione l'admin concede Vedere / Creare / Modificare / Eliminare / Esportare.
- Il primo utente registrato diventa automaticamente admin.

## Installazione (una volta sola)

### 1. Supabase
1. Nel progetto Supabase apri **SQL Editor**, incolla `supabase/migrations/0001_accessi.sql` ed esegui.
2. In **Authentication → Providers → Email** disattiva "Allow new users to sign up". Gli utenti li crea solo l'admin.
3. In **Authentication → Multi-Factor** verifica che **TOTP** sia abilitato.
4. Pubblica la funzione server: `supabase functions deploy admin-utenti`.
5. Crea il primo utente (sarà l'admin) da **Authentication → Users → Add user**.

### 2. GitHub
1. URL e chiave pubblica (publishable) di Supabase sono in `.env.production`.
2. In **Settings → Pages → Source** scegli **GitHub Actions**.
3. Ogni modifica su `main` viene pubblicata automaticamente.

## Sviluppo locale
```
cp .env.example .env   # inserisci URL e chiave anon
npm install
npm run dev
```

## Script del database (da eseguire in ordine nel SQL Editor di Supabase)
| Script | Contenuto |
|---|---|
| 0001_accessi | Utenti, ruoli, permessi, 2FA, registro |
| 0002_menu_reportone | Menu come ReportOne, note dashboard |
| 0003_clienti | Clienti, tipologie di pagamento |
| 0004_archivi_cestino | Archivi e cestino |
| 0005_fornitori | Fornitori, province, nazioni, modalità pagamento, banche |
| 0006_tecnici | Tecnici collegati agli utenti |
| 0007_impianti | Impianti, periodi |
| 0008_rapporti | Rapporti di intervento e righe |
| 0009_foto_tariffe | Firma e foto dei rapporti, tariffe |
| 0010_materiali | Materiali, unità di misura, scarico giacenza |

## Stato dei lavori
Fatte: Dashboard, Clienti, Fornitori, Tecnici, Impianti, Rapporti di intervento, Materiali, pannello utenti e permessi.
Da fare: Start Tecnici, Agenda, Preventivi, Richieste di Intervento, DDT di Acquisto, Scadenziario, Conti Clienti, valori dei riquadri della dashboard.
