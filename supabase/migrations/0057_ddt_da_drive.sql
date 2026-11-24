-- =====================================================================
-- DDT di acquisto in arrivo dalla cartella Google Drive (funzione "ddt-drive"):
-- i PDF nuovi finiscono in "ddt_in_arrivo"; il gestionale (aperto da un amministratore) li importa da solo.
-- I materiali nuovi creati dai DDT e quelli senza foto vengono segnati "da rivedere".
-- Si può eseguire anche più volte.
-- =====================================================================
create table if not exists public.ddt_in_arrivo (
  id            bigint generated always as identity primary key,
  drive_id      text unique,
  nome_file     text not null,
  percorso      text not null,             -- file nell'archivio "ddt_acquisto"
  stato         text not null default 'da_importare'
                check (stato in ('da_importare', 'in_corso', 'importato', 'da_controllare', 'errore', 'scartato')),
  messaggio     text,
  ddt_id        bigint references public.ddt_acquisto(id) on delete set null,
  creato_il     timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);
create index if not exists ddt_in_arrivo_stato_idx on public.ddt_in_arrivo (stato);

alter table public.ddt_in_arrivo enable row level security;
drop policy if exists ddt_in_arrivo_vedere on public.ddt_in_arrivo;
create policy ddt_in_arrivo_vedere on public.ddt_in_arrivo for select using (public.puo('ddt_acquisto', 'vedere'));
drop policy if exists ddt_in_arrivo_modificare on public.ddt_in_arrivo;
create policy ddt_in_arrivo_modificare on public.ddt_in_arrivo for update
  using (public.puo('ddt_acquisto', 'creare') or public.puo('ddt_acquisto', 'modificare'));

-- Prende il prossimo PDF da importare (uno alla volta, anche con il gestionale aperto su più dispositivi).
-- Un import rimasto a metà da più di 10 minuti (es. pagina chiusa) torna disponibile.
create or replace function public.prendi_ddt_in_arrivo() returns setof public.ddt_in_arrivo
language plpgsql security definer set search_path = public as $$
declare r ddt_in_arrivo;
begin
  if not (public.puo('ddt_acquisto', 'creare') and public.puo('materiali', 'creare')) then return; end if;
  select * into r from ddt_in_arrivo
  where stato = 'da_importare' or (stato = 'in_corso' and aggiornato_il < now() - interval '10 minutes')
  order by id limit 1 for update skip locked;
  if not found then return; end if;
  update ddt_in_arrivo set stato = 'in_corso', aggiornato_il = now() where id = r.id returning * into r;
  return next r;
end $$;
grant execute on function public.prendi_ddt_in_arrivo() to authenticated;

-- Materiali da rivedere (nuovi creati da un DDT, oppure senza foto)
alter table public.materiali add column if not exists da_rivedere text;
alter table public.materiali add column if not exists da_rivedere_il timestamptz;

-- Aggiunta la foto: per gli articoli segnati "senza foto" la revisione è fatta
create or replace function public.materiali_foto_rivisto() returns trigger
language plpgsql as $$
begin
  if new.da_rivedere is not null and new.da_rivedere like 'Senza foto%' and coalesce(old.foto, '') = '' and coalesce(new.foto, '') <> '' then
    new.da_rivedere := null;
    new.da_rivedere_il := null;
  end if;
  return new;
end $$;
drop trigger if exists materiali_foto_rivisto on public.materiali;
create trigger materiali_foto_rivisto before update of foto on public.materiali
  for each row execute function public.materiali_foto_rivisto();

-- Controllo della cartella Drive ogni 5 minuti (anche a gestionale chiuso)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'ddt-drive';
select cron.schedule('ddt-drive', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://rvnjbpfhvhtfjowjlvxy.supabase.co/functions/v1/ddt-drive',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb)
$$);

notify pgrst, 'reload schema';
