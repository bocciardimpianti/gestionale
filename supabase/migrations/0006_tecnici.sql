-- =====================================================================
-- Tecnici (collegabili a un utente del gestionale)
-- =====================================================================

create table public.tecnici (
  id             bigint generated always as identity primary key,
  nome           text not null,
  utente_id      uuid references public.profili(id) on delete set null,
  id_tecnico     text,
  archivio_id    bigint references public.archivi(id) on delete set null,
  eliminato_il   timestamptz,
  creato_il      timestamptz not null default now(),
  modificato_il  timestamptz not null default now()
);

create index tecnici_nome_idx on public.tecnici (lower(nome));

create trigger tecnici_modificato_il
  before update on public.tecnici
  for each row execute function public.aggiorna_modificato_il();

create trigger tecnici_cestino
  before update on public.tecnici
  for each row execute function public.controlla_cestino('tecnici');

alter table public.tecnici enable row level security;
create policy tecnici_vedere     on public.tecnici for select using (public.puo('tecnici', 'vedere'));
create policy tecnici_creare     on public.tecnici for insert with check (public.puo('tecnici', 'creare'));
create policy tecnici_modificare on public.tecnici for update using (public.puo('tecnici', 'modificare')) with check (public.puo('tecnici', 'modificare'));
create policy tecnici_eliminare  on public.tecnici for delete using (public.puo('tecnici', 'eliminare'));

-- Nome e email degli utenti attivi, per collegarli ai tecnici (leggibile da chi può vedere i tecnici)
create or replace function public.elenco_utenti()
returns table (id uuid, nome text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.nome, ''), p.email)
  from public.profili p
  where p.attivo and public.puo('tecnici', 'vedere')
  order by 2
$$;
