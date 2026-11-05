-- =====================================================================
-- Notifiche sul telefono (Web Push) per le richieste di intervento
-- - Ogni telefono/PC che attiva le notifiche registra qui la sua "iscrizione"
-- - Le chiavi di invio sono create dalla funzione server "notifiche" e restano solo sul server
-- - Ogni richiesta ricorda a chi è già stata notificata, per non mandare doppioni
-- =====================================================================

create table public.push_iscrizioni (
  id            bigint generated always as identity primary key,
  utente_id     uuid not null references public.profili(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  dispositivo   text,
  creato_il     timestamptz not null default now(),
  ultimo_invio  timestamptz
);

alter table public.push_iscrizioni enable row level security;
create policy push_iscrizioni_mie on public.push_iscrizioni for select using (utente_id = auth.uid());
create policy push_iscrizioni_elimina_mie on public.push_iscrizioni for delete using (utente_id = auth.uid());

-- Iscrizione del dispositivo all'utente collegato (se il telefono passa a un altro utente, l'iscrizione lo segue)
create or replace function public.iscrivi_notifiche(p_endpoint text, p_p256dh text, p_auth text, p_dispositivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  insert into push_iscrizioni (utente_id, endpoint, p256dh, auth, dispositivo)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_dispositivo)
  on conflict (endpoint) do update set utente_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, dispositivo = excluded.dispositivo;
end $$;

create or replace function public.disiscrivi_notifiche(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_iscrizioni where endpoint = p_endpoint and utente_id = auth.uid();
$$;

grant execute on function public.iscrivi_notifiche(text, text, text, text) to authenticated;
grant execute on function public.disiscrivi_notifiche(text) to authenticated;

-- Chiavi di invio (VAPID): nessun accesso dal browser, solo dalla funzione server
create table public.chiavi_notifiche (
  id        int primary key default 1 check (id = 1),
  pubblica  text not null,
  privata   text not null,
  creato_il timestamptz not null default now()
);
alter table public.chiavi_notifiche enable row level security;

-- A chi è già stata notificata la richiesta
alter table public.richieste
  add column if not exists notificata_il timestamptz,
  add column if not exists notificato_tecnico_id bigint;
