-- Preventivi: manodopera = ore di lavoro × numero di tecnici × tariffa oraria; entra nell'imponibile.
-- Si scrive nella scheda del preventivo, sotto i materiali accanto al codice a barre.
alter table public.preventivi add column if not exists ore_lavoro numeric(10,2);
alter table public.preventivi add column if not exists numero_tecnici int;
alter table public.preventivi add column if not exists tariffa_oraria numeric(12,2);
alter table public.preventivi add column if not exists manodopera numeric(12,2) not null default 0;
notify pgrst, 'reload schema';
