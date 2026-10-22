-- =====================================================================
-- DDT di Acquisto + righe (le righe nuove caricano la giacenza del materiale)
-- =====================================================================

create table public.ddt_acquisto (
  id                       bigint generated always as identity primary key,
  data                     date not null default current_date,
  numero                   text,
  fornitore_id             bigint references public.fornitori(id) on delete set null,
  numero_ddt               text,
  email                    text,
  stato                    text,
  tipologia_pagamento      text,
  pagato                   boolean not null default false,
  prezzo                   numeric(12,2) not null default 0,
  note                     text,
  totale_materiali         numeric(12,2) not null default 0,
  totale_servizi           numeric(12,2) not null default 0,
  totale_materiali_servizi numeric(12,2) not null default 0,
  imponibile               numeric(12,2) not null default 0,
  sconto_totale            numeric(12,2) not null default 0,
  iva_totale               numeric(12,2) not null default 0,
  totale                   numeric(12,2) not null default 0,
  gguid_reportone          text unique,
  archivio_id              bigint references public.archivi(id) on delete set null,
  eliminato_il             timestamptz,
  creato_il                timestamptz not null default now(),
  modificato_il            timestamptz not null default now()
);

create index ddt_acquisto_data_idx on public.ddt_acquisto (data desc);
create index ddt_acquisto_fornitore_idx on public.ddt_acquisto (fornitore_id);

-- Numero automatico (progressivo) se non indicato
create or replace function public.numera_ddt_acquisto() returns trigger
language plpgsql as $$
begin
  if new.numero is null or btrim(new.numero) = '' then
    perform pg_advisory_xact_lock(hashtext('numera_ddt_acquisto'));
    select coalesce(max(numero::int), 0) + 1 into new.numero
    from public.ddt_acquisto where numero ~ '^[0-9]{1,9}$';
  end if;
  return new;
end $$;

create trigger ddt_acquisto_numero
  before insert on public.ddt_acquisto
  for each row execute function public.numera_ddt_acquisto();

create trigger ddt_acquisto_modificato_il
  before update on public.ddt_acquisto
  for each row execute function public.aggiorna_modificato_il();

create trigger ddt_acquisto_cestino
  before update on public.ddt_acquisto
  for each row execute function public.controlla_cestino('ddt_acquisto');

alter table public.ddt_acquisto enable row level security;
create policy ddt_acquisto_vedere     on public.ddt_acquisto for select using (public.puo('ddt_acquisto', 'vedere'));
create policy ddt_acquisto_creare     on public.ddt_acquisto for insert with check (public.puo('ddt_acquisto', 'creare'));
create policy ddt_acquisto_modificare on public.ddt_acquisto for update using (public.puo('ddt_acquisto', 'modificare')) with check (public.puo('ddt_acquisto', 'modificare'));
create policy ddt_acquisto_eliminare  on public.ddt_acquisto for delete using (public.puo('ddt_acquisto', 'eliminare'));

create table public.righe_ddt_acquisto (
  id               bigint generated always as identity primary key,
  ddt_id           bigint not null references public.ddt_acquisto(id) on delete cascade,
  ordine           int not null default 0,
  materiale_id     bigint references public.materiali(id) on delete set null,
  codice_barre     text,
  descrizione      text,
  unita_misura     text,
  quantita         numeric(12,3),
  costo            numeric(12,4),
  sconto           numeric(6,2),
  iva              numeric(6,2),
  servizio         boolean not null default false,
  totale           numeric(12,4),
  totale_scontato  numeric(12,4),
  totale_iva       numeric(12,4),
  totale_ivato     numeric(12,4),
  importata        boolean not null default false
);

create index righe_ddt_acquisto_idx on public.righe_ddt_acquisto (ddt_id, ordine);

alter table public.righe_ddt_acquisto enable row level security;
create policy righe_ddt_acquisto_vedere on public.righe_ddt_acquisto for select using (public.puo('ddt_acquisto', 'vedere'));
create policy righe_ddt_acquisto_creare on public.righe_ddt_acquisto for insert
  with check (public.puo('ddt_acquisto', 'creare') or public.puo('ddt_acquisto', 'modificare'));
create policy righe_ddt_acquisto_modificare on public.righe_ddt_acquisto for update
  using (public.puo('ddt_acquisto', 'modificare')) with check (public.puo('ddt_acquisto', 'modificare'));
create policy righe_ddt_acquisto_eliminare on public.righe_ddt_acquisto for delete using (public.puo('ddt_acquisto', 'modificare'));

-- Il materiale acquistato entra in magazzino (le righe importate da ReportOne sono già nella giacenza)
create or replace function public.carica_giacenza() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.materiale_id is not null and not old.importata and not old.servizio then
    update public.materiali set giacenza = giacenza - coalesce(old.quantita, 0) where id = old.materiale_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.materiale_id is not null and not new.importata and not new.servizio then
    update public.materiali set giacenza = giacenza + coalesce(new.quantita, 0) where id = new.materiale_id;
  end if;
  return null;
end $$;

create trigger righe_ddt_acquisto_giacenza
  after insert or update or delete on public.righe_ddt_acquisto
  for each row execute function public.carica_giacenza();

-- Stato "Chiuso" usato dai DDT
insert into public.stati_documento (nome, ordine) values ('Chiuso', 30) on conflict (nome) do nothing;
