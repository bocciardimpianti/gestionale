-- =====================================================================
-- DDT di Acquisto letti dal PDF del fornitore
-- - abbinamenti: codice articolo del fornitore → materiale (scelto una volta, poi ricordato)
-- - PDF originale conservato con il DDT
-- =====================================================================

create table public.abbinamenti_fornitore (
  id            bigint generated always as identity primary key,
  fornitore_id  bigint not null references public.fornitori(id) on delete cascade,
  codice        text not null,
  materiale_id  bigint not null references public.materiali(id) on delete cascade,
  creato_il     timestamptz not null default now(),
  unique (fornitore_id, codice)
);

alter table public.abbinamenti_fornitore enable row level security;
create policy abbinamenti_vedere on public.abbinamenti_fornitore for select using (public.puo('ddt_acquisto', 'vedere'));
create policy abbinamenti_creare on public.abbinamenti_fornitore for insert
  with check (public.puo('ddt_acquisto', 'creare') or public.puo('ddt_acquisto', 'modificare'));
create policy abbinamenti_modificare on public.abbinamenti_fornitore for update
  using (public.puo('ddt_acquisto', 'creare') or public.puo('ddt_acquisto', 'modificare'));
create policy abbinamenti_eliminare on public.abbinamenti_fornitore for delete using (public.puo('ddt_acquisto', 'modificare'));

alter table public.ddt_acquisto add column if not exists pdf text;

insert into storage.buckets (id, name, public)
values ('ddt_acquisto', 'ddt_acquisto', false)
on conflict (id) do nothing;

create policy ddt_acquisto_file_vedere on storage.objects for select
  using (bucket_id = 'ddt_acquisto' and public.puo('ddt_acquisto', 'vedere'));
create policy ddt_acquisto_file_caricare on storage.objects for insert
  with check (bucket_id = 'ddt_acquisto' and (public.puo('ddt_acquisto', 'creare') or public.puo('ddt_acquisto', 'modificare')));
create policy ddt_acquisto_file_modificare on storage.objects for update
  using (bucket_id = 'ddt_acquisto' and public.puo('ddt_acquisto', 'modificare'));
create policy ddt_acquisto_file_eliminare on storage.objects for delete
  using (bucket_id = 'ddt_acquisto' and public.puo('ddt_acquisto', 'modificare'));
