-- =====================================================================
-- Registro materiali per tecnico: spostamenti dei materiali rimasti (non installati)
-- tra un tecnico e il Magazzino (o un altro tecnico).
-- "da_tecnico_id" / "a_tecnico_id" vuoti = Magazzino.
-- Si può eseguire anche più volte.
-- =====================================================================
create table if not exists public.movimenti_materiali (
  id            bigint generated always as identity primary key,
  data          date not null default current_date,
  materiale_id  bigint references public.materiali(id) on delete set null,
  descrizione   text,
  unita_misura  text,
  quantita      numeric(12,3) not null check (quantita > 0),
  da_tecnico_id bigint references public.tecnici(id) on delete set null,
  a_tecnico_id  bigint references public.tecnici(id) on delete set null,
  note          text,
  creato_da     uuid references public.profili(id) on delete set null default auth.uid(),
  creato_il     timestamptz not null default now(),
  check (da_tecnico_id is distinct from a_tecnico_id)
);
create index if not exists movimenti_materiali_data_idx on public.movimenti_materiali (data);

alter table public.movimenti_materiali enable row level security;
drop policy if exists movimenti_materiali_lettura on public.movimenti_materiali;
create policy movimenti_materiali_lettura on public.movimenti_materiali for select using (public.is_admin());
drop policy if exists movimenti_materiali_admin on public.movimenti_materiali;
create policy movimenti_materiali_admin on public.movimenti_materiali for all using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
