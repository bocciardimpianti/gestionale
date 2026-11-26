-- Conti Clienti: anche i preventivi non approvati dei rapportini divisi (script 0060), a parte.
-- Il "Da riscuotere" e la soglia restano solo sulle voci da fatturare; il totale non approvato si vede accanto.
-- In più: i rapportini si possono segnare "già conteggiati" (Fatto conto = Si) dal conto del cliente.
drop function if exists public.conti_clienti();
create or replace function public.conti_clienti()
returns table (cliente_id bigint, cliente text, telefono text, rapporti int, totale numeric, non_approvato numeric, conteggiato numeric, dal date, al date,
               soglia numeric, soglia_personale boolean, oltre boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, coalesce(nullif(c.cellulare, ''), c.telefono), count(*)::int, sum(public.importo_rapporto(r)),
         sum(coalesce(r.totale_non_approvato, 0)),
         coalesce(sum(public.importo_rapporto(r)) filter (where r.fatto_conto ilike 's%'), 0),
         min(r.data), max(r.data),
         coalesce(c.soglia_conto, public.soglia_conto_predefinita()), c.soglia_conto is not null,
         sum(public.importo_rapporto(r)) > coalesce(c.soglia_conto, public.soglia_conto_predefinita())
  from rapporti r
  join clienti c on c.id = r.cliente_id
  where public.puo('conti_clienti', 'vedere')
    and r.eliminato_il is null and not r.pagata and r.data <= current_date
    and (public.importo_rapporto(r) > 0 or coalesce(r.totale_non_approvato, 0) > 0)
  group by c.id
  order by 5 desc
$$;

drop function if exists public.rapporti_da_riscuotere_cliente(bigint);
create or replace function public.rapporti_da_riscuotere_cliente(p_cliente bigint)
returns table (id bigint, numero int, data date, tecnico text, attivita text, importo numeric, non_approvato numeric, fatto_conto text)
language sql stable security definer set search_path = public as $$
  select r.id, r.numero, r.data, t.nome, r.attivita, public.importo_rapporto(r), coalesce(r.totale_non_approvato, 0), r.fatto_conto
  from rapporti r left join tecnici t on t.id = r.tecnico_id
  where public.puo('conti_clienti', 'vedere') and r.cliente_id = p_cliente
    and r.eliminato_il is null and not r.pagata and r.data <= current_date
    and (public.importo_rapporto(r) > 0 or coalesce(r.totale_non_approvato, 0) > 0)
  order by r.data, r.id
$$;

-- Segna (o toglie) "già conteggiato" sui rapportini scelti: campo Fatto conto = Si / vuoto (solo amministratori)
create or replace function public.segna_conteggiati(p_rapporti bigint[], p_conteggiati boolean) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then
    raise exception 'Solo un amministratore può segnare i rapportini come conteggiati';
  end if;
  update rapporti set fatto_conto = case when p_conteggiati then 'Si' else null end
  where id = any(p_rapporti) and eliminato_il is null;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.segna_conteggiati(bigint[], boolean) to authenticated;
grant execute on function public.conti_clienti() to authenticated;
grant execute on function public.rapporti_da_riscuotere_cliente(bigint) to authenticated;
notify pgrst, 'reload schema';
