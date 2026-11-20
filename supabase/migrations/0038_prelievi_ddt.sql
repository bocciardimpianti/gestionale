-- =====================================================================
-- "Aggiungi da DDT": si ricorda quale materiale di un DDT è stato messo in quale rapportino,
-- così nella finestra compare "Già inserito" (con rapportino, cliente e tecnico) e non lo si prende due volte.
-- Serve lo script 0028. Si può eseguire anche più volte.
-- =====================================================================

create table if not exists public.prelievi_ddt (
  id            bigint generated always as identity primary key,
  riga_ddt_id   bigint not null references public.righe_ddt_acquisto(id) on delete cascade,
  rapporto_id   bigint not null references public.rapporti(id) on delete cascade,
  quantita      numeric(12,3) not null default 0,
  creato_da     uuid default auth.uid(),
  creato_il     timestamptz not null default now(),
  unique (riga_ddt_id, rapporto_id)
);
create index if not exists prelievi_ddt_rapporto_idx on public.prelievi_ddt (rapporto_id);

-- Si scrive solo con la funzione qui sotto; l'amministratore può vedere e correggere tutto
alter table public.prelievi_ddt enable row level security;
drop policy if exists prelievi_ddt_admin on public.prelievi_ddt;
create policy prelievi_ddt_admin on public.prelievi_ddt for all using (public.is_admin()) with check (public.is_admin());

-- Registra i materiali presi dai DDT al salvataggio del rapportino (la stessa riga presa di nuovo somma la quantità)
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
end $$;

-- Quanto di una riga di DDT è già nei rapportini: contano solo i rapportini non eliminati
-- che hanno ancora quel materiale tra le righe (se lo si è tolto dal rapportino, torna disponibile)
create or replace function public.prese_riga_ddt(p_riga bigint)
returns table (quantita numeric, dove text)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(p.quantita), 0),
         string_agg(format('rapportino n. %s del %s – %s%s',
                           coalesce(r.numero::text, '?'), to_char(r.data, 'DD/MM/YYYY'),
                           coalesce(c.nome, 'cliente?'), coalesce(' (' || t.nome || ')', '')), '; ' order by r.data, r.id)
  from prelievi_ddt p
  join rapporti r on r.id = p.rapporto_id and r.eliminato_il is null
  join righe_ddt_acquisto d on d.id = p.riga_ddt_id
  left join clienti c on c.id = r.cliente_id
  left join tecnici t on t.id = r.tecnico_id
  where p.riga_ddt_id = p_riga
    and exists (select 1 from righe_rapporto rr where rr.rapporto_id = r.id
                and (rr.materiale_id = d.materiale_id
                     or (d.materiale_id is null and lower(trim(rr.descrizione)) = lower(trim(d.descrizione)))))
$$;

-- Le funzioni di "Aggiungi da DDT" ora dicono anche cosa è già stato preso
drop function if exists public.righe_ddt_per_rapportino(bigint);
create function public.righe_ddt_per_rapportino(p_ddt bigint)
returns table (id bigint, materiale_id bigint, codice_barre text, descrizione text, unita_misura text, quantita numeric,
               quantita_presa numeric, presa_in text)
language sql stable security definer set search_path = public as $$
  select r.id, r.materiale_id, r.codice_barre, r.descrizione, r.unita_misura, r.quantita, pr.quantita, pr.dove
  from righe_ddt_acquisto r
  join ddt_acquisto d on d.id = r.ddt_id and d.eliminato_il is null
  cross join lateral public.prese_riga_ddt(r.id) pr
  where (public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare') or public.puo('ddt_acquisto', 'vedere'))
    and r.ddt_id = p_ddt and not r.servizio
  order by r.ordine, r.id
$$;

drop function if exists public.ddt_per_rapportino(date, date, text, int);
create function public.ddt_per_rapportino(p_dal date default null, p_al date default null, p_cerca text default null, p_limite int default 200)
returns table (id bigint, data date, numero_ddt text, fornitore text, tecnico_id bigint, tecnico text, righe int, righe_prese int)
language sql stable security definer set search_path = public as $$
  select d.id, d.data, d.numero_ddt, f.nome, d.tecnico_id, t.nome,
         (select count(*)::int from righe_ddt_acquisto r where r.ddt_id = d.id and not r.servizio),
         (select count(*)::int from righe_ddt_acquisto r cross join lateral public.prese_riga_ddt(r.id) pr
           where r.ddt_id = d.id and not r.servizio and pr.quantita >= coalesce(r.quantita, 0) and pr.quantita > 0)
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

revoke execute on function public.prese_riga_ddt(bigint) from public, anon, authenticated;
grant execute on function public.registra_prelievi_ddt(bigint, jsonb) to authenticated;
grant execute on function public.righe_ddt_per_rapportino(bigint) to authenticated;
grant execute on function public.ddt_per_rapportino(date, date, text, int) to authenticated;

notify pgrst, 'reload schema';
