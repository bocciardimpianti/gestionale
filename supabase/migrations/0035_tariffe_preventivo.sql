-- Tariffe orarie del preventivo guidato (Tecnico elettricista, Idraulico, Apprendista…):
-- si sceglie in ogni sezione del foglio quale usare; "predefinita" è quella proposta per quel tipo di impianto.
-- Da eseguire dopo 0031. Si può rieseguire.

create table if not exists public.tariffe_preventivo (
  id bigint generated always as identity primary key,
  nome text not null unique,
  prezzo_ora numeric not null default 0,
  tipo text check (tipo in ('elettrico', 'idraulico')), -- vuoto = per tutti e due
  predefinita boolean not null default false,
  ordine int not null default 0,
  attiva boolean not null default true
);

alter table public.tariffe_preventivo enable row level security;
drop policy if exists tariffe_preventivo_lettura on public.tariffe_preventivo;
create policy tariffe_preventivo_lettura on public.tariffe_preventivo for select using (public.puo('preventivi', 'vedere'));
drop policy if exists tariffe_preventivo_admin on public.tariffe_preventivo;
create policy tariffe_preventivo_admin on public.tariffe_preventivo for all using (public.is_admin()) with check (public.is_admin());

-- Di partenza: il prezzo della tariffa "Standard" dei rapportini (o 35 €), da sistemare nelle impostazioni
insert into public.tariffe_preventivo (nome, prezzo_ora, tipo, predefinita, ordine)
select x.nome, coalesce((select t.tariffa_oraria from public.tariffe t where t.nome ilike 'standard%' and t.tariffa_oraria > 0 limit 1), 35) + x.piu, x.tipo, x.predefinita, x.ordine
from (values
  ('Tecnico elettricista', 0, 'elettrico', true, 10),
  ('Tecnico idraulico', 0, 'idraulico', true, 20),
  ('Frigorista / climatizzazione', 5, 'idraulico', false, 30),
  ('Aiutante / apprendista', -10, null, false, 40)
) as x(nome, piu, tipo, predefinita, ordine)
on conflict (nome) do nothing;

notify pgrst, 'reload schema';
