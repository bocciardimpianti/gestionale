-- Conti Clienti: data in cui un rapportino è stato segnato "già conteggiato" (Fatto conto = Si) e giorni passati.
-- La data si mette da sola quando "Fatto conto" diventa Si (dai Conti Clienti o dalla scheda del rapportino)
-- e si toglie quando torna vuoto/No. I rapportini già "Si" prima di questo script restano senza data.
alter table public.rapporti add column if not exists conteggiato_il date;

create or replace function public.rapporti_data_conteggio() returns trigger
language plpgsql as $$
begin
  if coalesce(new.fatto_conto, '') ilike 's%' then
    if tg_op = 'INSERT' or coalesce(old.fatto_conto, '') not ilike 's%' then
      new.conteggiato_il := coalesce(new.conteggiato_il, current_date);
    end if;
  else
    new.conteggiato_il := null;
  end if;
  return new;
end $$;
drop trigger if exists rapporti_data_conteggio on public.rapporti;
create trigger rapporti_data_conteggio before insert or update of fatto_conto, conteggiato_il on public.rapporti
for each row execute function public.rapporti_data_conteggio();

drop function if exists public.conti_clienti();
create or replace function public.conti_clienti()
returns table (cliente_id bigint, cliente text, telefono text, rapporti int, totale numeric, non_approvato numeric, conteggiato numeric,
               conteggiato_dal date, dal date, al date, soglia numeric, soglia_personale boolean, oltre boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, coalesce(nullif(c.cellulare, ''), c.telefono), count(*)::int, sum(public.importo_rapporto(r)),
         sum(coalesce(r.totale_non_approvato, 0)),
         coalesce(sum(public.importo_rapporto(r)) filter (where r.fatto_conto ilike 's%'), 0),
         min(r.conteggiato_il) filter (where r.fatto_conto ilike 's%'),
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
returns table (id bigint, numero int, data date, tecnico text, attivita text, importo numeric, non_approvato numeric, fatto_conto text, conteggiato_il date)
language sql stable security definer set search_path = public as $$
  select r.id, r.numero, r.data, t.nome, r.attivita, public.importo_rapporto(r), coalesce(r.totale_non_approvato, 0), r.fatto_conto, r.conteggiato_il
  from rapporti r left join tecnici t on t.id = r.tecnico_id
  where public.puo('conti_clienti', 'vedere') and r.cliente_id = p_cliente
    and r.eliminato_il is null and not r.pagata and r.data <= current_date
    and (public.importo_rapporto(r) > 0 or coalesce(r.totale_non_approvato, 0) > 0)
  order by r.data, r.id
$$;

grant execute on function public.conti_clienti() to authenticated;
grant execute on function public.rapporti_da_riscuotere_cliente(bigint) to authenticated;
notify pgrst, 'reload schema';
