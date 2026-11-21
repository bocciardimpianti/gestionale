-- =====================================================================
-- Impianti: linguetta "Materiali" con i materiali montati per l'impianto (solo quelli che contano per
-- la categoria) e nuova categoria TVCC (solo videosorveglianza).
-- Si può eseguire anche più volte.
-- =====================================================================
create table if not exists public.materiali_impianto (
  id           bigint generated always as identity primary key,
  impianto_id  bigint not null references public.impianti(id) on delete cascade,
  rapporto_id  bigint references public.rapporti(id) on delete cascade,
  materiale_id bigint references public.materiali(id) on delete set null,
  descrizione  text not null,
  quantita     numeric(12,3),
  unita_misura text,
  ordine       int not null default 0,
  creato_il    timestamptz not null default now()
);
create index if not exists materiali_impianto_impianto on public.materiali_impianto (impianto_id);

alter table public.materiali_impianto enable row level security;
drop policy if exists materiali_impianto_vedere on public.materiali_impianto;
create policy materiali_impianto_vedere on public.materiali_impianto for select using (public.puo('impianti', 'vedere'));
drop policy if exists materiali_impianto_modificare on public.materiali_impianto;
create policy materiali_impianto_modificare on public.materiali_impianto for all
  using (public.puo('impianti', 'modificare')) with check (public.puo('impianti', 'modificare'));

-- Rapportino salvato: impianto della categoria creato o aggiornato, con i suoi materiali
create or replace function public.registra_impianto(p_rapporto bigint, p_categoria text, p_dati jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r record; v_id bigint;
begin
  if not (public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare')) then
    raise exception 'Non hai il permesso di modificare i rapportini';
  end if;
  if p_categoria not in ('Clima', 'Caldaie', 'Allarmi', 'Automatismi', 'TVCC') then raise exception 'Categoria non valida'; end if;
  select * into r from rapporti where id = p_rapporto and eliminato_il is null;
  if not found or r.cliente_id is null then return null; end if;
  insert into impianti (cliente_id, categoria, rapporto_id, tipo_impianto, impianto, marca, modello, matricola, anno, data_ultimo,
                        defangatore, sdoppiatore, dosatore, pompe_valvole, canna_fumaria_m, canna_fumaria_sezione, impianto_termico,
                        unita_interne, tipo_gas, gas_kg, componenti)
  values (r.cliente_id, p_categoria, r.id, p_dati->>'tipo_impianto', p_dati->>'impianto', p_dati->>'marca', p_dati->>'modello',
          nullif(r.matricola, ''), p_dati->>'anno', r.data,
          p_dati->>'defangatore', p_dati->>'sdoppiatore', p_dati->>'dosatore', p_dati->>'pompe_valvole',
          (p_dati->>'canna_fumaria_m')::numeric, p_dati->>'canna_fumaria_sezione', p_dati->>'impianto_termico',
          p_dati->>'unita_interne', p_dati->>'tipo_gas', (p_dati->>'gas_kg')::numeric, p_dati->>'componenti')
  on conflict (rapporto_id, categoria) do update set
    cliente_id = excluded.cliente_id, marca = excluded.marca, modello = excluded.modello,
    matricola = coalesce(excluded.matricola, impianti.matricola), data_ultimo = excluded.data_ultimo,
    defangatore = excluded.defangatore, sdoppiatore = excluded.sdoppiatore, dosatore = excluded.dosatore,
    pompe_valvole = excluded.pompe_valvole, canna_fumaria_m = excluded.canna_fumaria_m,
    canna_fumaria_sezione = excluded.canna_fumaria_sezione,
    -- scelto a mano: resta, se dai materiali non si capisce
    impianto_termico = coalesce(excluded.impianto_termico, impianti.impianto_termico),
    unita_interne = excluded.unita_interne, tipo_gas = coalesce(excluded.tipo_gas, impianti.tipo_gas),
    gas_kg = coalesce(excluded.gas_kg, impianti.gas_kg), componenti = excluded.componenti
  returning id into v_id;
  -- Materiali dell'impianto presi da questo rapportino: rifatti da capo
  if jsonb_typeof(p_dati->'materiali') = 'array' then
    delete from materiali_impianto where impianto_id = v_id and rapporto_id = p_rapporto;
    insert into materiali_impianto (impianto_id, rapporto_id, materiale_id, descrizione, quantita, unita_misura, ordine)
    select v_id, p_rapporto, (select id from materiali where id = nullif(m->>'materiale_id', '')::bigint),
           m->>'descrizione', nullif(m->>'quantita', '')::numeric, m->>'unita_misura', o::int
    from jsonb_array_elements(p_dati->'materiali') with ordinality as t(m, o)
    where coalesce(m->>'descrizione', '') <> '';
  end if;
  -- Il rapportino rimanda all'impianto (Storico dell'impianto), se non ne aveva già uno
  update rapporti set impianto_id = v_id where id = p_rapporto and impianto_id is null;
  return v_id;
end $$;
grant execute on function public.registra_impianto(bigint, text, jsonb) to authenticated;

-- Impianti già presenti di videosorveglianza: categoria TVCC
update public.impianti set categoria = 'TVCC'
where categoria is null and concat_ws(' ', tipo_impianto, impianto) ~* '(tvcc|videosorv|telecamer|\ynvr\y|\ydvr\y)';

notify pgrst, 'reload schema';
