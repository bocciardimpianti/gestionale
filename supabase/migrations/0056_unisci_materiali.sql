-- =====================================================================
-- Unione dei materiali doppi (Magazzino → Materiali → Azioni → Unisci articoli doppi).
-- L'articolo tolto va nel Cestino con "unito_a" = articolo tenuto; tutto quello che lo usava
-- (rapportini, DDT, preventivi, kit, impianti, abbinamenti fornitore…) passa all'articolo tenuto.
-- Giacenze sommate, codici fornitore uniti, prezzo d'acquisto il più alto tra gli articoli uniti
-- (poi lo aggiornano i nuovi DDT come sempre, solo se il costo sale).
-- Ogni unione è registrata e si può annullare. Si può eseguire anche più volte.
-- =====================================================================
alter table public.materiali add column if not exists unito_a bigint references public.materiali(id) on delete set null;
create index if not exists materiali_unito_a_idx on public.materiali (unito_a);

create table if not exists public.unioni_materiali (
  id          bigint generated always as identity primary key,
  tieni       bigint not null,
  togli       bigint[] not null,
  prima       jsonb not null,               -- righe dei materiali com'erano prima
  spostati    jsonb not null default '[]',  -- righe collegate spostate: tabella, colonna, chiave, valore di prima
  eliminati   jsonb not null default '[]',  -- righe collegate tolte perché già presenti sull'articolo tenuto
  creato_il   timestamptz not null default now(),
  creato_da   uuid default auth.uid(),
  annullata_il timestamptz
);
alter table public.unioni_materiali enable row level security;
drop policy if exists unioni_materiali_admin on public.unioni_materiali;
create policy unioni_materiali_admin on public.unioni_materiali for select using (public.is_admin());

create or replace function public.unisci_materiali(p_tieni bigint, p_togli bigint[], p_campi jsonb default '{}') returns bigint
language plpgsql security definer set search_path = public as $$
declare
  t record; r record;
  v_prima jsonb; v_spostati jsonb := '[]'; v_eliminati jsonb := '[]';
  v_pk text[]; v_chiave text; v_tieni materiali; v_giacenza numeric; v_id bigint; v_prezzo numeric;
begin
  if not public.is_admin() then raise exception 'Solo gli amministratori possono unire i materiali'; end if;
  p_togli := array(select distinct x from unnest(p_togli) x where x is not null and x <> p_tieni);
  if coalesce(array_length(p_togli, 1), 0) = 0 then raise exception 'Nessun articolo da unire'; end if;
  select * into v_tieni from materiali where id = p_tieni and eliminato_il is null for update;
  if not found then raise exception 'Articolo da tenere non trovato (o nel cestino)'; end if;
  if (select count(*) from materiali where id = any(p_togli) and eliminato_il is null) <> array_length(p_togli, 1) then
    raise exception 'Uno degli articoli da unire non esiste più o è già nel cestino';
  end if;
  select jsonb_agg(to_jsonb(m)) into v_prima from materiali m where m.id = p_tieni or m.id = any(p_togli);
  select v_tieni.giacenza + coalesce(sum(giacenza), 0), greatest(v_tieni.prezzo_base, coalesce(max(prezzo_base), 0))
    into v_giacenza, v_prezzo from materiali where id = any(p_togli);

  -- tutte le colonne (di qualsiasi tabella) che puntano a materiali.id
  for t in
    select c.conrelid::regclass as tabella, a.attname as colonna, c.conrelid
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.materiali'::regclass and array_length(c.conkey, 1) = 1
      and not (c.conrelid = 'public.materiali'::regclass and a.attname = 'unito_a')
  loop
    select array_agg(a.attname order by a.attnum) into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = t.conrelid and i.indisprimary;
    -- chiave della riga: la chiave primaria (o tutta la riga), senza la colonna che cambia
    v_chiave := case when v_pk is null then format('to_jsonb(x) - %L', t.colonna)
      else format('(select jsonb_object_agg(k, to_jsonb(x) -> k) from unnest(%L::text[]) k where k <> %L)', v_pk, t.colonna) end;
    for r in execute format('select ctid as riga, %s as chiave, to_jsonb(x) as tutta, %I as da from %s x where %I = any($1)',
                            v_chiave, t.colonna, t.tabella, t.colonna) using p_togli loop
      begin
        execute format('update %s set %I = $1 where ctid = $2', t.tabella, t.colonna) using p_tieni, r.riga;
        v_spostati := v_spostati || jsonb_build_object('tabella', t.tabella::text, 'colonna', t.colonna, 'chiave', r.chiave, 'da', r.da);
      exception when unique_violation then
        -- la stessa cosa c'è già sull'articolo tenuto (es. stesso kit o stessa categoria): la riga doppia si toglie
        execute format('delete from %s where ctid = $1', t.tabella) using r.riga;
        v_eliminati := v_eliminati || jsonb_build_object('tabella', t.tabella::text, 'riga', r.tutta);
      end;
    end loop;
  end loop;

  -- articolo tenuto: codici uniti, foto/codice a barre se mancano, giacenza sommata, prezzo il più alto
  -- (il prezzo ricaricato si ricalcola col suo ricarico, come fanno i DDT)
  update materiali m set
    fornitore1        = case when p_campi ? 'fornitore1' then nullif(p_campi->>'fornitore1', '') else m.fornitore1 end,
    codice_fornitore1 = case when p_campi ? 'codice_fornitore1' then nullif(p_campi->>'codice_fornitore1', '') else m.codice_fornitore1 end,
    fornitore2        = case when p_campi ? 'fornitore2' then nullif(p_campi->>'fornitore2', '') else m.fornitore2 end,
    codice_fornitore2 = case when p_campi ? 'codice_fornitore2' then nullif(p_campi->>'codice_fornitore2', '') else m.codice_fornitore2 end,
    foto         = coalesce(nullif(m.foto, ''), (select foto from materiali where id = any(p_togli) and coalesce(foto, '') <> '' order by id limit 1)),
    codice_barre = coalesce(nullif(m.codice_barre, ''), (select codice_barre from materiali where id = any(p_togli) and coalesce(codice_barre, '') <> '' order by id limit 1)),
    giacenza = v_giacenza,
    prezzo_base = v_prezzo,
    prezzo_ricaricato = case when v_prezzo > v_tieni.prezzo_base
      then round(v_prezzo * (1 + coalesce(m.ricarico, 0) / 100), 4) else v_tieni.prezzo_ricaricato end
  where m.id = p_tieni;
  update materiali set eliminato_il = now(), unito_a = p_tieni, giacenza = 0 where id = any(p_togli);

  insert into unioni_materiali (tieni, togli, prima, spostati, eliminati)
  values (p_tieni, p_togli, v_prima, v_spostati, v_eliminati) returning id into v_id;
  return v_id;
end $$;
grant execute on function public.unisci_materiali(bigint, bigint[], jsonb) to authenticated;

-- Annulla un'unione: le righe collegate tornano dove erano e gli articoli tornano com'erano
create or replace function public.annulla_unione_materiali(p_id bigint) returns int
language plpgsql security definer set search_path = public as $$
declare u unioni_materiali; s jsonb; m jsonb; n int := 0;
begin
  if not public.is_admin() then raise exception 'Solo gli amministratori possono annullare le unioni'; end if;
  select * into u from unioni_materiali where id = p_id and annullata_il is null for update;
  if not found then raise exception 'Unione non trovata o già annullata'; end if;
  for s in select * from jsonb_array_elements(u.spostati) loop
    execute format('update %s x set %I = $1 where to_jsonb(x) @> $2 and %I = $3 and ctid = (select ctid from %s y where to_jsonb(y) @> $2 and %I = $3 limit 1)',
                   s->>'tabella', s->>'colonna', s->>'colonna', s->>'tabella', s->>'colonna')
      using (s->>'da')::bigint, coalesce(s->'chiave', '{}'), u.tieni;
    n := n + 1;
  end loop;
  for s in select * from jsonb_array_elements(u.eliminati) loop
    execute format('insert into %s overriding system value select * from jsonb_populate_record(null::%s, $1)', s->>'tabella', s->>'tabella')
      using s->'riga';
  end loop;
  -- i materiali tornano com'erano (giacenze e prezzi compresi)
  for m in select * from jsonb_array_elements(u.prima) loop
    update materiali x set
      eliminato_il = (m->>'eliminato_il')::timestamptz, unito_a = (m->>'unito_a')::bigint,
      giacenza = (m->>'giacenza')::numeric, prezzo_base = (m->>'prezzo_base')::numeric, prezzo_ricaricato = (m->>'prezzo_ricaricato')::numeric,
      fornitore1 = m->>'fornitore1', codice_fornitore1 = m->>'codice_fornitore1', fornitore2 = m->>'fornitore2', codice_fornitore2 = m->>'codice_fornitore2',
      foto = m->>'foto', codice_barre = m->>'codice_barre'
    where x.id = (m->>'id')::bigint;
  end loop;
  update unioni_materiali set annullata_il = now() where id = p_id;
  return n;
end $$;
grant execute on function public.annulla_unione_materiali(bigint) to authenticated;

notify pgrst, 'reload schema';
