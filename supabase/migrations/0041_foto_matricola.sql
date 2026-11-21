-- =====================================================================
-- Rapportini: foto della matricola dell'unità esterna del climatizzatore.
-- Quando si monta un'unità esterna il gestionale chiede la foto della targhetta;
-- si può rimandare ("da fare") e i rapportini con la foto mancante si ritrovano nei Filtri.
-- Si può eseguire anche più volte.
-- =====================================================================
alter table public.rapporti add column if not exists foto_matricola text;
alter table public.rapporti add column if not exists matricola_da_fare boolean not null default false;
notify pgrst, 'reload schema';
