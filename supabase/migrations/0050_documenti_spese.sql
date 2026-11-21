-- =====================================================================
-- Spese aziendali: caricamento dei file (PDF, Excel, CSV, foto) da cui poi estrarre le spese.
-- I file restano nell'archivio privato "spese"; ogni file ha uno stato: Da elaborare / Elaborato.
-- Si può eseguire anche più volte.
-- =====================================================================
create table if not exists public.documenti_spese (
  id            bigint generated always as identity primary key,
  nome_file     text not null,
  percorso      text not null unique,
  tipo_file     text,
  dimensione    bigint,
  tipo_spesa    text,                       -- Salari dipendenti / Spese fisse / Spese extra (facoltativo)
  stato         text not null default 'Da elaborare' check (stato in ('Da elaborare', 'Elaborato')),
  spese_create  int not null default 0,     -- quante spese sono state ricavate dal file
  note          text,
  caricato_da   uuid default auth.uid(),
  eliminato_il  timestamptz,
  creato_il     timestamptz not null default now(),
  modificato_il timestamptz not null default now()
);
drop trigger if exists documenti_spese_modificato_il on public.documenti_spese;
create trigger documenti_spese_modificato_il before update on public.documenti_spese
  for each row execute function public.aggiorna_modificato_il();

alter table public.documenti_spese enable row level security;
drop policy if exists documenti_spese_vedere on public.documenti_spese;
create policy documenti_spese_vedere on public.documenti_spese for select using (public.puo('spese_aziendali', 'vedere'));
drop policy if exists documenti_spese_creare on public.documenti_spese;
create policy documenti_spese_creare on public.documenti_spese for insert with check (public.puo('spese_aziendali', 'creare'));
drop policy if exists documenti_spese_modificare on public.documenti_spese;
create policy documenti_spese_modificare on public.documenti_spese for update
  using (public.puo('spese_aziendali', 'modificare') or public.puo('spese_aziendali', 'creare'))
  with check (public.puo('spese_aziendali', 'modificare') or public.puo('spese_aziendali', 'creare'));
drop policy if exists documenti_spese_eliminare on public.documenti_spese;
create policy documenti_spese_eliminare on public.documenti_spese for delete using (public.puo('spese_aziendali', 'eliminare'));

-- Archivio privato dei file
insert into storage.buckets (id, name, public) values ('spese', 'spese', false) on conflict (id) do nothing;
drop policy if exists spese_file_vedere on storage.objects;
create policy spese_file_vedere on storage.objects for select using (bucket_id = 'spese' and public.puo('spese_aziendali', 'vedere'));
drop policy if exists spese_file_caricare on storage.objects;
create policy spese_file_caricare on storage.objects for insert with check (bucket_id = 'spese' and public.puo('spese_aziendali', 'creare'));
drop policy if exists spese_file_eliminare on storage.objects;
create policy spese_file_eliminare on storage.objects for delete using (bucket_id = 'spese' and public.puo('spese_aziendali', 'eliminare'));

notify pgrst, 'reload schema';
