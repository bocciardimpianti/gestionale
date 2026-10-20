-- =====================================================================
-- Gestionale - Accessi, ruoli, permessi, 2FA obbligatoria, registro
-- =====================================================================

-- Sezioni del gestionale (verranno completate in base alle schermate)
create table public.sezioni (
  chiave     text primary key,
  etichetta  text not null,
  ordine     int  not null default 0
);

insert into public.sezioni (chiave, etichetta, ordine) values
  ('clienti',     'Clienti',      10),
  ('fornitori',   'Fornitori',    20),
  ('articoli',    'Articoli',     30),
  ('interventi',  'Interventi',   40),
  ('documenti',   'Documenti',    50),
  ('importazione','Importa Excel',90);

-- Profilo utente (1:1 con auth.users)
create table public.profili (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  nome        text,
  ruolo       text not null default 'standard' check (ruolo in ('admin','standard')),
  attivo      boolean not null default true,
  creato_il   timestamptz not null default now()
);

-- Permessi per sezione (solo per utenti standard; l'admin ha tutto)
create table public.permessi (
  utente_id   uuid references public.profili(id) on delete cascade,
  sezione     text references public.sezioni(chiave) on delete cascade,
  vedere      boolean not null default false,
  creare      boolean not null default false,
  modificare  boolean not null default false,
  eliminare   boolean not null default false,
  esportare   boolean not null default false,
  primary key (utente_id, sezione)
);

-- Registro attività
create table public.registro (
  id          bigint generated always as identity primary key,
  utente_id   uuid references public.profili(id) on delete set null,
  azione      text not null,
  dettagli    jsonb,
  il          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Funzioni di controllo
-- ---------------------------------------------------------------------

-- Sessione verificata con 2FA (Authenticator Assurance Level 2)
create or replace function public.mfa_ok() returns boolean
language sql stable as $$
  select coalesce(auth.jwt()->>'aal', '') = 'aal2'
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists (
    select 1 from public.profili
    where id = auth.uid() and ruolo = 'admin' and attivo
  )
$$;

-- azione: 'vedere' | 'creare' | 'modificare' | 'eliminare' | 'esportare'
create or replace function public.puo(p_sezione text, p_azione text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (
    public.mfa_ok() and exists (
      select 1 from public.permessi pe
      join public.profili pr on pr.id = pe.utente_id and pr.attivo
      where pe.utente_id = auth.uid() and pe.sezione = p_sezione
        and case p_azione
              when 'vedere'     then pe.vedere
              when 'creare'     then pe.creare
              when 'modificare' then pe.modificare
              when 'eliminare'  then pe.eliminare
              when 'esportare'  then pe.esportare
              else false end
    )
  )
$$;

-- Nuovo utente => profilo. Il primo utente in assoluto diventa admin.
create or replace function public.nuovo_utente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profili (id, email, nome, ruolo)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'nome', new.email),
    case when (select count(*) from public.profili) = 0 then 'admin' else 'standard' end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.nuovo_utente();

-- ---------------------------------------------------------------------
-- Row Level Security: nessun dato senza login + 2FA
-- ---------------------------------------------------------------------
alter table public.sezioni  enable row level security;
alter table public.profili  enable row level security;
alter table public.permessi enable row level security;
alter table public.registro enable row level security;

create policy sezioni_lettura on public.sezioni
  for select using (public.mfa_ok());

-- Il proprio profilo è leggibile anche prima della 2FA (serve al login)
create policy profili_lettura on public.profili
  for select using (id = auth.uid() or public.is_admin());
create policy profili_admin on public.profili
  for update using (public.is_admin()) with check (public.is_admin());

create policy permessi_lettura on public.permessi
  for select using ((utente_id = auth.uid() and public.mfa_ok()) or public.is_admin());
create policy permessi_admin on public.permessi
  for all using (public.is_admin()) with check (public.is_admin());

create policy registro_lettura on public.registro
  for select using (public.is_admin());
create policy registro_scrittura on public.registro
  for insert with check (public.mfa_ok() and utente_id = auth.uid());

-- Impedisce all'admin di togliersi da solo i privilegi
create or replace function public.proteggi_admin() returns trigger
language plpgsql as $$
begin
  if old.id = auth.uid() and (new.ruolo <> 'admin' or not new.attivo) then
    raise exception 'Non puoi rimuovere i tuoi privilegi di amministratore';
  end if;
  return new;
end $$;

create trigger profili_proteggi_admin
  before update on public.profili
  for each row execute function public.proteggi_admin();
