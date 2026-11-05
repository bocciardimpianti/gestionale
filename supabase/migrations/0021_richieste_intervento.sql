-- =====================================================================
-- Richieste di intervento
-- - Cliente dall'anagrafica oppure solo il nominativo (cliente nuovo)
-- - Tecnico assegnato; "Prendi in carico" assegna la richiesta al tecnico collegato all'utente che la prende
-- - Stato: Da assegnare, Assegnata, In carico, Completata, Annullata
-- - Collegamento al rapportino creato dalla richiesta
-- =====================================================================

create table public.richieste (
  id                   bigint generated always as identity primary key,
  data_richiesta       timestamptz not null default now(),
  cliente_id           bigint references public.clienti(id) on delete set null,
  nominativo           text,
  telefono             text,
  indirizzo            text,
  descrizione          text,
  urgente              boolean not null default false,
  stato                text not null default 'Da assegnare',
  tecnico_id           bigint references public.tecnici(id) on delete set null,
  presa_in_carico_il   timestamptz,
  presa_in_carico_da   uuid references public.profili(id) on delete set null,
  rapporto_id          bigint references public.rapporti(id) on delete set null,
  note                 text,
  gguid_reportone      text unique,
  archivio_id          bigint references public.archivi(id) on delete set null,
  eliminato_il         timestamptz,
  creato_il            timestamptz not null default now(),
  modificato_il        timestamptz not null default now()
);

create index richieste_data_idx on public.richieste (data_richiesta desc);
create index richieste_tecnico_idx on public.richieste (tecnico_id);

create trigger richieste_modificato_il
  before update on public.richieste
  for each row execute function public.aggiorna_modificato_il();

create trigger richieste_cestino
  before update on public.richieste
  for each row execute function public.controlla_cestino('richieste');

-- Stato coerente con il tecnico: senza tecnico "Da assegnare", con un tecnico almeno "Assegnata"
create or replace function public.stato_richiesta() returns trigger
language plpgsql as $$
begin
  if new.stato is null or btrim(new.stato) = '' then new.stato := 'Da assegnare'; end if;
  if new.tecnico_id is not null and new.stato = 'Da assegnare' then new.stato := 'Assegnata'; end if;
  if new.tecnico_id is null and new.stato in ('Assegnata', 'In carico') then
    new.stato := 'Da assegnare';
    new.presa_in_carico_il := null;
    new.presa_in_carico_da := null;
  end if;
  return new;
end $$;

create trigger richieste_stato
  before insert or update on public.richieste
  for each row execute function public.stato_richiesta();

alter table public.richieste enable row level security;
create policy richieste_vedere     on public.richieste for select using (public.puo('richieste', 'vedere'));
create policy richieste_creare     on public.richieste for insert with check (public.puo('richieste', 'creare'));
create policy richieste_modificare on public.richieste for update using (public.puo('richieste', 'modificare')) with check (public.puo('richieste', 'modificare'));
create policy richieste_eliminare  on public.richieste for delete using (public.puo('richieste', 'eliminare'));

-- Presa in carico: basta poter vedere le richieste; il tecnico è quello collegato all'utente.
-- Una richiesta già in carico a un altro tecnico può prenderla solo l'admin.
create or replace function public.prendi_in_carico(p_richiesta bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
  t record;
  r record;
begin
  if not public.puo('richieste', 'vedere') then raise exception 'Non hai accesso alle richieste di intervento'; end if;
  select id, nome into t from tecnici where utente_id = auth.uid() and eliminato_il is null order by id limit 1;
  if t.id is null then
    raise exception 'Il tuo utente non è collegato a un tecnico: collegalo nella scheda del tecnico (Tecnici → "Tecnico (utente del gestionale)")';
  end if;
  select * into r from richieste where id = p_richiesta and eliminato_il is null for update;
  if r.id is null then raise exception 'Richiesta non trovata'; end if;
  if r.stato in ('Completata', 'Annullata') then raise exception 'La richiesta è già %', lower(r.stato); end if;
  if r.stato = 'In carico' and r.tecnico_id is distinct from t.id and not public.is_admin() then
    raise exception 'La richiesta è già in carico a un altro tecnico';
  end if;
  update richieste
     set tecnico_id = t.id, stato = 'In carico', presa_in_carico_il = now(), presa_in_carico_da = auth.uid()
   where id = p_richiesta;
  insert into registro (utente_id, azione, dettagli) values (auth.uid(), 'richieste_presa_in_carico', jsonb_build_object('id', p_richiesta, 'tecnico', t.nome));
  return t.nome;
end $$;

-- Rilascio: la richiesta torna "Assegnata" allo stesso tecnico (o "Da assegnare" se l'admin toglie il tecnico)
create or replace function public.rilascia_richiesta(p_richiesta bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  select * into r from richieste where id = p_richiesta and eliminato_il is null for update;
  if r.id is null then raise exception 'Richiesta non trovata'; end if;
  if r.stato <> 'In carico' then raise exception 'La richiesta non è in carico'; end if;
  if r.presa_in_carico_da is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Solo chi l''ha presa in carico (o l''admin) può rilasciarla';
  end if;
  update richieste set stato = 'Assegnata', presa_in_carico_il = null, presa_in_carico_da = null where id = p_richiesta;
  insert into registro (utente_id, azione, dettagli) values (auth.uid(), 'richieste_rilasciata', jsonb_build_object('id', p_richiesta));
end $$;

-- Rapportino creato dalla richiesta: la richiesta diventa "Completata" e resta collegata al rapportino
create or replace function public.completa_richiesta(p_richiesta bigint, p_rapporto bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.puo('richieste', 'vedere') and public.puo('rapporti', 'creare')) then raise exception 'Permesso negato'; end if;
  update richieste set stato = 'Completata', rapporto_id = p_rapporto where id = p_richiesta and stato <> 'Annullata';
end $$;

grant execute on function public.prendi_in_carico(bigint) to authenticated;
grant execute on function public.rilascia_richiesta(bigint) to authenticated;
grant execute on function public.completa_richiesta(bigint, bigint) to authenticated;
