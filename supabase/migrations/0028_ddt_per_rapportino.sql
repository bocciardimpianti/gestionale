-- =====================================================================
-- "Aggiungi da DDT" nei rapportini: chi compila i rapportini vede i DDT di acquisto
-- e i loro materiali (SENZA prezzi), anche senza il permesso sulla sezione DDT.
-- Serve lo script 0027 (tecnico del DDT). Si può eseguire anche più volte.
-- =====================================================================

create or replace function public.ddt_per_rapportino(p_dal date default null, p_al date default null, p_cerca text default null, p_limite int default 200)
returns table (id bigint, data date, numero_ddt text, fornitore text, tecnico_id bigint, tecnico text, righe int)
language sql stable security definer set search_path = public as $$
  select d.id, d.data, d.numero_ddt, f.nome, d.tecnico_id, t.nome,
         (select count(*)::int from righe_ddt_acquisto r where r.ddt_id = d.id and not r.servizio)
  from ddt_acquisto d
  left join fornitori f on f.id = d.fornitore_id
  left join tecnici t on t.id = d.tecnico_id
  where (public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare') or public.puo('ddt_acquisto', 'vedere'))
    and d.eliminato_il is null
    and (p_dal is null or d.data >= p_dal)
    and (p_al is null or d.data <= p_al)
    and (coalesce(p_cerca, '') = ''
      or f.nome ilike '%' || p_cerca || '%' or d.numero_ddt ilike '%' || p_cerca || '%' or t.nome ilike '%' || p_cerca || '%'
      or exists (select 1 from righe_ddt_acquisto r where r.ddt_id = d.id and r.descrizione ilike '%' || p_cerca || '%'))
  order by d.data desc, d.id desc
  limit least(greatest(coalesce(p_limite, 200), 1), 500)
$$;

create or replace function public.righe_ddt_per_rapportino(p_ddt bigint)
returns table (id bigint, materiale_id bigint, codice_barre text, descrizione text, unita_misura text, quantita numeric)
language sql stable security definer set search_path = public as $$
  select r.id, r.materiale_id, r.codice_barre, r.descrizione, r.unita_misura, r.quantita
  from righe_ddt_acquisto r
  join ddt_acquisto d on d.id = r.ddt_id and d.eliminato_il is null
  where (public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare') or public.puo('ddt_acquisto', 'vedere'))
    and r.ddt_id = p_ddt and not r.servizio
  order by r.ordine, r.id
$$;

grant execute on function public.ddt_per_rapportino(date, date, text, int) to authenticated;
grant execute on function public.righe_ddt_per_rapportino(bigint) to authenticated;
