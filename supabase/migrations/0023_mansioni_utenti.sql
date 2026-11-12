-- =====================================================================
-- Mansione degli utenti (Titolare, Tecnico, Commerciale, Amministrativo, Magazzino)
-- scelta in "Utenti e permessi". Il collegamento utente → tecnico resta nella tabella tecnici.
-- Si può eseguire anche più volte.
-- =====================================================================
alter table public.profili add column if not exists mansione text;
