-- =====================================================================
-- Impianti per categoria (Clima, Caldaie, Allarmi, Automatismi), catalogati da soli dai rapportini:
-- per ogni categoria solo i componenti che contano (es. caldaia: defangatore, sdoppiatore, dosatore,
-- pompe e valvole, canna fumaria con metri e sezione, tipo di impianto di riscaldamento).
-- Si può eseguire anche più volte.
-- =====================================================================
alter table public.impianti add column if not exists categoria text;
alter table public.impianti add column if not exists rapporto_id bigint references public.rapporti(id) on delete set null;
alter table public.impianti add column if not exists defangatore text;
alter table public.impianti add column if not exists sdoppiatore text;
alter table public.impianti add column if not exists dosatore text;
alter table public.impianti add column if not exists pompe_valvole text;
alter table public.impianti add column if not exists canna_fumaria_m numeric(8,2);
alter table public.impianti add column if not exists canna_fumaria_sezione text;
alter table public.impianti add column if not exists impianto_termico text;
alter table public.impianti add column if not exists unita_interne text;
alter table public.impianti add column if not exists tipo_gas text;
alter table public.impianti add column if not exists gas_kg numeric(10,3);
alter table public.impianti add column if not exists componenti text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'impianti_rapporto_categoria') then
    alter table public.impianti add constraint impianti_rapporto_categoria unique (rapporto_id, categoria);
  end if;
end $$;

-- Rapportino salvato: impianto della categoria creato o aggiornato (con i componenti trovati nei materiali)
create or replace function public.registra_impianto(p_rapporto bigint, p_categoria text, p_dati jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r record; v_id bigint;
begin
  if not (public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare')) then
    raise exception 'Non hai il permesso di modificare i rapportini';
  end if;
  if p_categoria not in ('Clima', 'Caldaie', 'Allarmi', 'Automatismi') then raise exception 'Categoria non valida'; end if;
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
  -- Il rapportino rimanda all'impianto (Storico dell'impianto), se non ne aveva già uno
  update rapporti set impianto_id = v_id where id = p_rapporto and impianto_id is null;
  return v_id;
end $$;
grant execute on function public.registra_impianto(bigint, text, jsonb) to authenticated;

-- Impianti già presenti: categoria dal tipo o dal nome dell'impianto
update public.impianti set categoria = case
    when concat_ws(' ', tipo_impianto, impianto) ~* '(clima|condizion|split|pompa di calore)' then 'Clima'
    when concat_ws(' ', tipo_impianto, impianto) ~* '(caldai|termico|riscaldament)' then 'Caldaie'
    when concat_ws(' ', tipo_impianto, impianto) ~* '(allarm|antifurto|antintrusion)' then 'Allarmi'
    when concat_ws(' ', tipo_impianto, impianto) ~* '(cancell|automa|automatism|serrand|basculant|motore)' then 'Automatismi'
  end
where categoria is null;

notify pgrst, 'reload schema';
