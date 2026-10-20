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
