-- =====================================================================
-- F-gas: lunghezza complessiva della tubazione (dai tubi 1/4" 3/8" 1/2" 5/8" 7/8" messi nel rapportino),
-- tipo di gas (proposto dalla descrizione della macchina, es. "R32") e kg di gas aggiunto.
-- Serve lo script 0043. Si può eseguire anche più volte.
-- =====================================================================
alter table public.fgas add column if not exists lunghezza_tubazione numeric(10,2);
alter table public.fgas add column if not exists tubazione_dettaglio text;
alter table public.fgas add column if not exists tipo_gas text;
alter table public.fgas add column if not exists gas_aggiunto_kg numeric(10,3);

-- Diametro del tubo nella descrizione (solo 1/4 3/8 1/2 5/8 7/8); null se non è un tubo (curve, raccordi…)
create or replace function public.diametro_tubo_split(d text) returns text
language sql immutable as $$
  select case
    when d ~* '(raccord|bocchetton|curva|gomito|riduz|cartell|\ydado|manicott|\ytee?\y|giunt|valvol|rubinett|flessibil|filtro|tappo|staff|nastro|canalin|isolante tubo|coppella|pinza|cartellatrice|tagliatubi|piegatubi)' then null
    when d !~* '(tubo|rame|rotolo|matass|coibentat|isolat)' then null
    else (regexp_match(d, '(1/4|3/8|1/2|5/8|7/8)'))[1]
  end
$$;

-- Metri di tubo di una riga: in metri se l'unità è MT; altrimenti pezzi × metri scritti nella descrizione (es. "25MT.")
create or replace function public.metri_tubo_split(d text, um text, q numeric) returns numeric
language sql immutable as $$
  select case
    when public.diametro_tubo_split(d) is null then 0
    when coalesce(um, '') ~* '^\s*(mt|m|ml|mtl|metr)' then coalesce(q, 0)
    when d ~* '\d+([.,]\d+)?\s*(mt|mtl|ml|m)\y' then coalesce(q, 1) * replace((regexp_match(d, '(\d+(?:[.,]\d+)?)\s*(?:mt|mtl|ml|m)\y', 'i'))[1], ',', '.')::numeric
    else coalesce(q, 0)
  end
$$;

-- Gas della macchina dalla descrizione (es. "… R32 …" → R32)
create or replace function public.gas_da_descrizione(d text) returns text
language sql immutable as $$
  select 'R' || upper(replace((regexp_match(d, '\yR-?\s?(32|410\s?A|290|454\s?B|134\s?A|407\s?C|22)\y', 'i'))[1], ' ', ''))
$$;

-- Tubazione di un rapportino: totale e dettaglio per diametro
create or replace function public.tubazione_rapporto(p_rapporto bigint, out totale numeric, out dettaglio text)
language sql stable as $$
  select nullif(sum(m), 0), string_agg(diam || '": ' || trim(to_char(m, 'FM999990.##'), '.') || ' m', ' · ' order by ord)
  from (
    select public.diametro_tubo_split(descrizione) as diam, sum(public.metri_tubo_split(descrizione, unita_misura, quantita)) as m,
           min(array_position(array['1/4','3/8','1/2','5/8','7/8'], public.diametro_tubo_split(descrizione))) as ord
    from public.righe_rapporto where rapporto_id = p_rapporto and public.diametro_tubo_split(descrizione) is not null
    group by 1
  ) t where m > 0
$$;

-- registra_fgas: in più tubazione (ricalcolata a ogni salvataggio del rapportino) e gas proposto
create or replace function public.registra_fgas(p_rapporto bigint, p_macchina text, p_interne text) returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not (public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare')) then
    raise exception 'Non hai il permesso di modificare i rapportini';
  end if;
  select * into t from public.tubazione_rapporto(p_rapporto);
  insert into fgas (rapporto_id, rapporto_numero, cliente_id, impianto, macchina, unita_interne, matricola, tecnico_id, data_installazione,
                    lunghezza_tubazione, tubazione_dettaglio, tipo_gas)
  select r.id, r.numero, r.cliente_id, nullif(concat_ws(' ', r.tipo_impianto, r.impianto), ''), p_macchina, nullif(p_interne, ''), r.matricola, r.tecnico_id, r.data,
         t.totale, t.dettaglio, public.gas_da_descrizione(p_macchina)
  from rapporti r where r.id = p_rapporto and r.eliminato_il is null
  on conflict (rapporto_id) do update set
    rapporto_numero = excluded.rapporto_numero, cliente_id = excluded.cliente_id, impianto = coalesce(fgas.impianto, excluded.impianto),
    macchina = excluded.macchina, unita_interne = excluded.unita_interne, matricola = coalesce(fgas.matricola, excluded.matricola),
    tecnico_id = excluded.tecnico_id, data_installazione = excluded.data_installazione,
    lunghezza_tubazione = excluded.lunghezza_tubazione, tubazione_dettaglio = excluded.tubazione_dettaglio,
    tipo_gas = coalesce(fgas.tipo_gas, excluded.tipo_gas);
end $$;
grant execute on function public.registra_fgas(bigint, text, text) to authenticated;

-- Impianti F-gas già presenti
update public.fgas f set lunghezza_tubazione = t.totale, tubazione_dettaglio = t.dettaglio
from (select f2.id, x.totale, x.dettaglio from public.fgas f2 cross join lateral public.tubazione_rapporto(f2.rapporto_id) x where f2.rapporto_id is not null) t
where f.id = t.id and f.lunghezza_tubazione is null;
update public.fgas set tipo_gas = public.gas_da_descrizione(macchina) where tipo_gas is null and macchina is not null;

notify pgrst, 'reload schema';
