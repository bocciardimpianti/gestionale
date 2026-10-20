-- =====================================================================
-- Materiali (magazzino) + Unità di misura + scarico giacenza dai rapporti
-- =====================================================================

create table public.unita_misura (
  nome    text primary key,
  ordine  int not null default 0
);
insert into public.unita_misura (nome, ordine) values
  ('Pz', 10), ('Nr', 20), ('Mt', 30), ('Kg', 40), ('Gr', 50), ('Lt.', 60), ('Mq.', 70), ('Ore', 80);

alter table public.unita_misura enable row level security;
create policy unita_misura_lettura on public.unita_misura for select using (public.mfa_ok());
create policy unita_misura_admin   on public.unita_misura for all using (public.is_admin()) with check (public.is_admin());

create table public.materiali (
  id                  bigint generated always as identity primary key,
  foto                text,
  codice_interno      text,
  descrizione         text not null,
  nome_articolo       text,
  fornitore1          text,
  codice_fornitore1   text,
  fornitore2          text,
  codice_fornitore2   text,
  unita_misura        text,
  prezzo_base         numeric(12,4) not null default 0,
  ricarico            numeric(8,2) not null default 35,
  prezzo_ricaricato   numeric(12,4) not null default 0,
  codice_barre        text,
  giacenza            numeric(12,3) not null default 0,
  giacenza_minima     numeric(12,3) not null default 0,
  dettaglio           text,
  archivio_id         bigint references public.archivi(id) on delete set null,
  eliminato_il        timestamptz,
  creato_il           timestamptz not null default now(),
  modificato_il       timestamptz not null default now()
);

create index materiali_codice_barre_idx on public.materiali (codice_barre);
create index materiali_codice_interno_idx on public.materiali (codice_interno);
create index materiali_descrizione_idx on public.materiali (lower(descrizione));

create trigger materiali_modificato_il
  before update on public.materiali
  for each row execute function public.aggiorna_modificato_il();

create trigger materiali_cestino
  before update on public.materiali
  for each row execute function public.controlla_cestino('materiali');

alter table public.materiali enable row level security;
-- Chi compila i rapporti deve poter cercare i materiali anche senza accesso alla sezione Materiali
create policy materiali_vedere     on public.materiali for select using (public.puo('materiali', 'vedere') or public.puo('rapporti', 'vedere'));
create policy materiali_creare     on public.materiali for insert with check (public.puo('materiali', 'creare'));
create policy materiali_modificare on public.materiali for update using (public.puo('materiali', 'modificare')) with check (public.puo('materiali', 'modificare'));
create policy materiali_eliminare  on public.materiali for delete using (public.puo('materiali', 'eliminare'));

-- Archivio file privato per le fotografie dei materiali
insert into storage.buckets (id, name, public)
values ('materiali', 'materiali', false)
on conflict (id) do nothing;

create policy materiali_file_vedere on storage.objects for select
  using (bucket_id = 'materiali' and (public.puo('materiali', 'vedere') or public.puo('rapporti', 'vedere')));
create policy materiali_file_caricare on storage.objects for insert
  with check (bucket_id = 'materiali' and (public.puo('materiali', 'creare') or public.puo('materiali', 'modificare')));
create policy materiali_file_modificare on storage.objects for update
  using (bucket_id = 'materiali' and public.puo('materiali', 'modificare'));
create policy materiali_file_eliminare on storage.objects for delete
  using (bucket_id = 'materiali' and public.puo('materiali', 'modificare'));

-- Le righe dei rapporti si collegano al materiale e ne scaricano la giacenza
alter table public.righe_rapporto
  add column materiale_id bigint references public.materiali(id) on delete set null;

create index righe_rapporto_materiale_idx on public.righe_rapporto (materiale_id);

create or replace function public.scarica_giacenza() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.materiale_id is not null then
    update public.materiali set giacenza = giacenza + coalesce(old.quantita, 0) where id = old.materiale_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.materiale_id is not null then
    update public.materiali set giacenza = giacenza - coalesce(new.quantita, 0) where id = new.materiale_id;
  end if;
  return null;
end $$;

create trigger righe_rapporto_giacenza
  after insert or update or delete on public.righe_rapporto
  for each row execute function public.scarica_giacenza();
