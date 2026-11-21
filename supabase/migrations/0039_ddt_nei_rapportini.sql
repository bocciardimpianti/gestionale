-- =====================================================================
-- DDT di acquisto: quanto dei materiali è già finito nei rapportini.
-- - nell'elenco dei DDT la colonna "Nei rapportini" (Tutto / Parziale / No)
-- - dentro il DDT, per ogni materiale: rapportino, cliente e tecnico
-- Serve lo script 0038. Si può eseguire anche più volte.
-- =====================================================================

-- Stato del DDT (campo calcolato, si legge come una colonna: select=*,nei_rapportini)
create or replace function public.nei_rapportini(d public.ddt_acquisto)
returns text
language sql stable security definer set search_path = public as $$
  with x as (
    select r.quantita as q, pr.quantita as presa
    from righe_ddt_acquisto r
    cross join lateral public.prese_riga_ddt(r.id) pr
    where r.ddt_id = d.id and not r.servizio and coalesce(r.quantita, 0) > 0
  )
  select case
    when not exists (select 1 from x) then null
    when not exists (select 1 from x where presa > 0) then 'No'
    when not exists (select 1 from x where presa < q) then 'Tutto'
    else 'Parziale ' || (select count(*) from x where presa >= q) || '/' || (select count(*) from x)
  end
$$;

-- Per ogni materiale del DDT: dove è andato (campo calcolato: select=*,in_rapportini)
create or replace function public.in_rapportini(r public.righe_ddt_acquisto)
returns text
language sql stable security definer set search_path = public as $$
  select case when pr.quantita > 0 then
    case when pr.quantita >= coalesce(r.quantita, 0) then '' else trim(to_char(pr.quantita, 'FM999990.###'), '.') || ' di ' || trim(to_char(r.quantita, 'FM999990.###'), '.') || ': ' end
    || pr.dove end
  from public.prese_riga_ddt(r.id) pr
$$;

grant execute on function public.nei_rapportini(public.ddt_acquisto) to authenticated;
grant execute on function public.in_rapportini(public.righe_ddt_acquisto) to authenticated;

-- Quando un rapportino prende materiali da un DDT, il DDT risulta modificato:
-- così l'elenco dei DDT (salvato sui dispositivi) si aggiorna con il nuovo stato
create or replace function public.registra_prelievi_ddt(p_rapporto bigint, p_righe jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare')) then
    raise exception 'Non hai il permesso di modificare i rapportini';
  end if;
  if not exists (select 1 from rapporti where id = p_rapporto) then
    raise exception 'Rapportino non trovato';
  end if;
  insert into prelievi_ddt (riga_ddt_id, rapporto_id, quantita)
  select (x->>'riga_ddt_id')::bigint, p_rapporto, sum(coalesce((x->>'quantita')::numeric, 0))
  from jsonb_array_elements(coalesce(p_righe, '[]'::jsonb)) x
  where exists (select 1 from righe_ddt_acquisto r where r.id = (x->>'riga_ddt_id')::bigint)
  group by (x->>'riga_ddt_id')::bigint
  on conflict (riga_ddt_id, rapporto_id) do update set quantita = prelievi_ddt.quantita + excluded.quantita;
  update ddt_acquisto set modificato_il = now()
  where eliminato_il is null and id in (
    select r.ddt_id from righe_ddt_acquisto r
    where r.id in (select (x->>'riga_ddt_id')::bigint from jsonb_array_elements(coalesce(p_righe, '[]'::jsonb)) x));
end $$;

notify pgrst, 'reload schema';
