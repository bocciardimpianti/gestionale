-- =====================================================================
-- F-gas: anche le unità interne installate nello stesso rapportino dell'unità esterna.
-- Serve lo script 0042. Si può eseguire anche più volte.
-- =====================================================================
alter table public.fgas add column if not exists unita_interne text;

-- Come prima, con in più le unità interne (testo "2 × …; 1 × …" preparato dal gestionale)
create or replace function public.registra_fgas(p_rapporto bigint, p_macchina text, p_interne text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare')) then
    raise exception 'Non hai il permesso di modificare i rapportini';
  end if;
  insert into fgas (rapporto_id, rapporto_numero, cliente_id, impianto, macchina, unita_interne, matricola, tecnico_id, data_installazione)
  select r.id, r.numero, r.cliente_id, nullif(concat_ws(' ', r.tipo_impianto, r.impianto), ''), p_macchina, nullif(p_interne, ''), r.matricola, r.tecnico_id, r.data
  from rapporti r where r.id = p_rapporto and r.eliminato_il is null
  on conflict (rapporto_id) do update set
    rapporto_numero = excluded.rapporto_numero, cliente_id = excluded.cliente_id, impianto = coalesce(fgas.impianto, excluded.impianto),
    macchina = excluded.macchina, unita_interne = excluded.unita_interne, matricola = coalesce(fgas.matricola, excluded.matricola),
    tecnico_id = excluded.tecnico_id, data_installazione = excluded.data_installazione;
end $$;
grant execute on function public.registra_fgas(bigint, text, text) to authenticated;

-- Impianti F-gas già presenti: unità interne prese dai loro rapportini
update public.fgas f set unita_interne = x.testo
from (
  select rapporto_id, string_agg(trim(to_char(q, 'FM999990.###'), '.') || ' × ' || descrizione, '; ' order by descrizione) as testo
  from (
    select rr.rapporto_id, trim(rr.descrizione) as descrizione, sum(coalesce(rr.quantita, 1)) as q
    from public.righe_rapporto rr
    where rr.descrizione ~* '(unit[aà]''?\s+int|\yu\.?i\.?\y|\ymsz-?|\ymfz-?|\ysfz-?|\yslz-?|\ypead-?|\yasyg|\yaseh|\yasyh|\yfxsq|\yftxm|\yftxj|cassetta 4 ?vie|split a parete|\yconsole\y)'
      and rr.descrizione !~* '(staff|supporto|piedin|antivibr|\ybase\y|copertur|cover|tubo|canalin|telecomando|distributor|giunto|sonda|filtro|griglia|pompa (condensa|scarico)|resistenza|unit[aà]''?\s+est|\yu\.?e\.?\y)'
    group by rr.rapporto_id, trim(rr.descrizione)
  ) t group by rapporto_id
) x
where f.rapporto_id = x.rapporto_id and f.unita_interne is null;

notify pgrst, 'reload schema';
