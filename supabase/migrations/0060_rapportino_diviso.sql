-- Rapportino diviso: materiali e servizi "da fatturare" oppure nei "Preventivi non approvati" del rapportino.
-- Le righe restano tutte nel rapportino: il magazzino si muove come sempre per tutti i materiali.
alter table public.righe_rapporto add column if not exists non_approvato boolean not null default false;
alter table public.rapporti add column if not exists servizi_non_approvati text;
alter table public.rapporti add column if not exists totale_non_approvato numeric(12,2) not null default 0;
