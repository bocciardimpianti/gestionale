-- =====================================================================
-- Progetti e schede dei clienti: i file messi nella cartella Google Drive "Progetti clienti" (anche in sottocartelle)
-- arrivano qui (funzione "ddt-drive"), il gestionale li legge e li smista per cliente e argomento
-- (Bagni, Caldaia, Clima…). Si vedono nella scheda del cliente, linguetta "Progetti e schede".
-- Si può eseguire anche più volte.
-- =====================================================================
insert into storage.buckets (id, name, public) values ('progetti', 'progetti', false) on conflict (id) do nothing;
drop policy if exists progetti_file_vedere on storage.objects;
create policy progetti_file_vedere on storage.objects for select using (bucket_id = 'progetti' and public.puo('clienti', 'vedere'));
drop policy if exists progetti_file_caricare on storage.objects;
create policy progetti_file_caricare on storage.objects for insert with check (bucket_id = 'progetti' and (public.puo('clienti', 'creare') or public.puo('clienti', 'modificare')));
drop policy if exists progetti_file_eliminare on storage.objects;
create policy progetti_file_eliminare on storage.objects for delete using (bucket_id = 'progetti' and public.puo('clienti', 'modificare'));

create table if not exists public.progetti_file (
  id            bigint generated always as identity primary key,
  drive_id      text unique,
  nome_file     text not null,
  cartella      text,                 -- percorso delle sottocartelle su Drive (aiuta a capire il cliente)
  percorso      text not null,        -- file nell'archivio "progetti"
  tipo          text,                 -- tipo del file (application/pdf, image/jpeg…)
  dimensione    bigint,
  stato         text not null default 'da_leggere' check (stato in ('da_leggere', 'in_lettura', 'smistato', 'da_smistare', 'errore', 'scartato')),
  cliente_id    bigint references public.clienti(id) on delete set null,
  categoria     text,
  motivo        text,                 -- come è stato smistato (o perché non si è capito)
  a_mano        boolean not null default false,
  creato_il     timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);
create index if not exists progetti_file_cliente_idx on public.progetti_file (cliente_id);
create index if not exists progetti_file_stato_idx on public.progetti_file (stato);
alter table public.progetti_file enable row level security;
drop policy if exists progetti_file_lettura on public.progetti_file;
create policy progetti_file_lettura on public.progetti_file for select using (public.puo('clienti', 'vedere'));
drop policy if exists progetti_file_modifica on public.progetti_file;
create policy progetti_file_modifica on public.progetti_file for update using (public.puo('clienti', 'modificare'));
drop policy if exists progetti_file_togli on public.progetti_file;
create policy progetti_file_togli on public.progetti_file for delete using (public.puo('clienti', 'modificare'));

-- Prossimo file da leggere (uno alla volta anche con il gestionale aperto su più dispositivi)
create or replace function public.prendi_progetto_da_leggere() returns setof public.progetti_file
language plpgsql security definer set search_path = public as $$
declare r progetti_file;
begin
  if not public.puo('clienti', 'modificare') then return; end if;
  select * into r from progetti_file
  where stato = 'da_leggere' or (stato = 'in_lettura' and aggiornato_il < now() - interval '10 minutes')
  order by id limit 1 for update skip locked;
  if not found then return; end if;
  update progetti_file set stato = 'in_lettura', aggiornato_il = now() where id = r.id returning * into r;
  return next r;
end $$;
grant execute on function public.prendi_progetto_da_leggere() to authenticated;

notify pgrst, 'reload schema';
