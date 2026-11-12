-- Permesso "Vede prezzi e importi" degli utenti standard (gli admin li vedono sempre).
-- Senza questo permesso prezzi, ricarichi, costi, tariffe e totali non compaiono nel gestionale.
-- Si può eseguire anche più volte.
alter table public.profili add column if not exists prezzi boolean not null default false;
