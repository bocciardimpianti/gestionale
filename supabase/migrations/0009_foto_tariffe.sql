-- =====================================================================
-- Rapporti: firma e 4 foto (archivio file privato) + archivio Tariffe
-- =====================================================================

create table public.tariffe (
  nome              text primary key,
  ordine            int not null default 0,
  diritto_chiamata  numeric(12,2),
  tariffa_fissa     numeric(12,2),
  tariffa_oraria    numeric(12,2),
  tariffa_km        numeric(12,2)
);

alter table public.tariffe enable row level security;
create policy tariffe_lettura on public.tariffe for select using (public.mfa_ok());
create policy tariffe_admin   on public.tariffe for all using (public.is_admin()) with check (public.is_admin());

alter table public.rapporti
  add column tariffa text,
  add column firma text,
  add column foto1 text,
  add column foto2 text,
  add column foto3 text,
  add column foto4 text;

-- Archivio file privato: i file si vedono solo con i permessi della sezione Rapporti
insert into storage.buckets (id, name, public)
values ('rapporti', 'rapporti', false)
on conflict (id) do nothing;

create policy rapporti_file_vedere on storage.objects for select
  using (bucket_id = 'rapporti' and public.puo('rapporti', 'vedere'));
create policy rapporti_file_caricare on storage.objects for insert
  with check (bucket_id = 'rapporti' and (public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare')));
create policy rapporti_file_modificare on storage.objects for update
  using (bucket_id = 'rapporti' and public.puo('rapporti', 'modificare'));
create policy rapporti_file_eliminare on storage.objects for delete
  using (bucket_id = 'rapporti' and public.puo('rapporti', 'modificare'));
