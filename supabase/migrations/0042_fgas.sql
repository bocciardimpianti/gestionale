-- =====================================================================
-- F-gas (menu DOCUMENTI): impianti in cui è stata installata un'unità esterna di climatizzatore.
-- Il documento F-gas va depositato entro 30 giorni dall'installazione: countdown nell'elenco,
-- dal 20° giorno avviso nel menu e notifica agli amministratori.
-- Le schede nascono da sole salvando un rapportino con un'unità esterna tra i materiali.
-- Si può eseguire anche più volte.
-- =====================================================================

insert into public.sezioni (chiave, etichetta, gruppo, ordine) values ('fgas', 'F-gas', 'DOCUMENTI', 115)
on conflict (chiave) do nothing;

create table if not exists public.fgas (
  id                 bigint generated always as identity primary key,
  rapporto_id        bigint unique references public.rapporti(id) on delete set null,
  rapporto_numero    int,
  cliente_id         bigint references public.clienti(id) on delete set null,
  impianto           text,
  macchina           text,
  matricola          text,
  tecnico_id         bigint references public.tecnici(id) on delete set null,
  data_installazione date not null default current_date,
  documento          text,
  depositato_il      date,
  avvisato_il        timestamptz,
  note               text,
  archivio_id        bigint references public.archivi(id) on delete set null,
  eliminato_il       timestamptz,
  creato_il          timestamptz not null default now(),
  modificato_il      timestamptz not null default now()
);

drop trigger if exists fgas_modificato_il on public.fgas;
create trigger fgas_modificato_il before update on public.fgas
  for each row execute function public.aggiorna_modificato_il();

-- Caricato il documento: risulta depositato (oggi, se non è scritta un'altra data)
create or replace function public.fgas_depositato() returns trigger
language plpgsql as $$
begin
  if new.documento is not null and new.depositato_il is null then new.depositato_il := current_date; end if;
  return new;
end $$;
drop trigger if exists fgas_depositato on public.fgas;
create trigger fgas_depositato before insert or update on public.fgas
  for each row execute function public.fgas_depositato();

alter table public.fgas enable row level security;
drop policy if exists fgas_vedere on public.fgas;
create policy fgas_vedere on public.fgas for select using (public.puo('fgas', 'vedere'));
drop policy if exists fgas_creare on public.fgas;
create policy fgas_creare on public.fgas for insert with check (public.puo('fgas', 'creare'));
drop policy if exists fgas_modificare on public.fgas;
create policy fgas_modificare on public.fgas for update using (public.puo('fgas', 'modificare')) with check (public.puo('fgas', 'modificare'));
drop policy if exists fgas_eliminare on public.fgas;
create policy fgas_eliminare on public.fgas for delete using (public.puo('fgas', 'eliminare'));

-- Archivio dei documenti F-gas (PDF o foto)
insert into storage.buckets (id, name, public) values ('fgas', 'fgas', false) on conflict (id) do nothing;
drop policy if exists fgas_file_vedere on storage.objects;
create policy fgas_file_vedere on storage.objects for select using (bucket_id = 'fgas' and public.puo('fgas', 'vedere'));
drop policy if exists fgas_file_caricare on storage.objects;
create policy fgas_file_caricare on storage.objects for insert
  with check (bucket_id = 'fgas' and (public.puo('fgas', 'creare') or public.puo('fgas', 'modificare')));
drop policy if exists fgas_file_modificare on storage.objects;
create policy fgas_file_modificare on storage.objects for update using (bucket_id = 'fgas' and public.puo('fgas', 'modificare'));
drop policy if exists fgas_file_eliminare on storage.objects;
create policy fgas_file_eliminare on storage.objects for delete using (bucket_id = 'fgas' and public.puo('fgas', 'modificare'));

-- Rapportino salvato con un'unità esterna: nasce (o si aggiorna) la sua scheda F-gas
create or replace function public.registra_fgas(p_rapporto bigint, p_macchina text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare')) then
    raise exception 'Non hai il permesso di modificare i rapportini';
  end if;
  insert into fgas (rapporto_id, rapporto_numero, cliente_id, impianto, macchina, matricola, tecnico_id, data_installazione)
  select r.id, r.numero, r.cliente_id, nullif(concat_ws(' ', r.tipo_impianto, r.impianto), ''), p_macchina, r.matricola, r.tecnico_id, r.data
  from rapporti r where r.id = p_rapporto and r.eliminato_il is null
  on conflict (rapporto_id) do update set
    rapporto_numero = excluded.rapporto_numero, cliente_id = excluded.cliente_id, impianto = coalesce(fgas.impianto, excluded.impianto),
    macchina = excluded.macchina, matricola = coalesce(fgas.matricola, excluded.matricola), tecnico_id = excluded.tecnico_id,
    data_installazione = excluded.data_installazione;
end $$;
grant execute on function public.registra_fgas(bigint, text) to authenticated;

-- Quanti impianti sono dal 20° giorno in poi senza documento (numero rosso nel menu)
create or replace function public.fgas_in_scadenza() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from fgas
  where public.puo('fgas', 'vedere') and eliminato_il is null and documento is null and depositato_il is null
    and data_installazione <= current_date - 20
$$;
grant execute on function public.fgas_in_scadenza() to authenticated;

-- Per la funzione "notifiche": impianti arrivati al 20° giorno senza documento (avviso una volta sola)
create or replace function public.fgas_da_avvisare()
returns table (id bigint, cliente text, macchina text, data_installazione date, giorni_mancanti int)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with da as (
    select f.id from fgas f
    where f.eliminato_il is null and f.documento is null and f.depositato_il is null and f.avvisato_il is null
      and f.data_installazione <= current_date - 20
  ), segnati as (
    update fgas f set avvisato_il = now() from da where f.id = da.id returning f.id
  )
  select f.id, c.nome, f.macchina, f.data_installazione, (f.data_installazione + 30 - current_date)::int
  from fgas f join segnati s on s.id = f.id left join clienti c on c.id = f.cliente_id;
end $$;
revoke execute on function public.fgas_da_avvisare() from public, anon, authenticated;
grant execute on function public.fgas_da_avvisare() to service_role;

-- Impianti già installati negli ultimi 30 giorni (rapportini con un'unità esterna tra i materiali)
insert into public.fgas (rapporto_id, rapporto_numero, cliente_id, impianto, macchina, matricola, tecnico_id, data_installazione)
select distinct on (r.id) r.id, r.numero, r.cliente_id, nullif(concat_ws(' ', r.tipo_impianto, r.impianto), ''), rr.descrizione, r.matricola, r.tecnico_id, r.data
from public.rapporti r
join public.righe_rapporto rr on rr.rapporto_id = r.id
where r.eliminato_il is null and r.data >= current_date - 30
  and rr.descrizione ~* '(unit[aà]''?\s+est|macchina esterna|\yu\.?e\.?\y|\ymuz-?|\ysuz-?|\ymxz-?|\ypumy|\yaoe[ghl]|\ypuhz|mono ?split.*(\+|\yue\y))'
  and rr.descrizione !~* '(staff|supporto|piedin|antivibr|\ybase\y|copertur|cover|tubo|canalin|telecomando|distributor|giunto|sonda|filtro|griglia|pompa (condensa|scarico)|resistenza)'
order by r.id, rr.ordine
on conflict (rapporto_id) do nothing;

notify pgrst, 'reload schema';
