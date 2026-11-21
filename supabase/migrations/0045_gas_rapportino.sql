-- =====================================================================
-- Rapportini: gas refrigerante aggiunto montando un climatizzatore (kg e tipo).
-- Il gestionale lo chiede al salvataggio quando c'è un'unità esterna; passa da solo nella scheda F-gas.
-- Serve lo script 0044. Si può eseguire anche più volte.
-- =====================================================================
alter table public.rapporti add column if not exists gas_aggiunto_kg numeric(10,3);
alter table public.rapporti add column if not exists tipo_gas text;

create or replace function public.registra_fgas(p_rapporto bigint, p_macchina text, p_interne text) returns void
language plpgsql security definer set search_path = public as $$
declare t record; r record;
begin
  if not (public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare')) then
    raise exception 'Non hai il permesso di modificare i rapportini';
  end if;
  select * into r from rapporti where id = p_rapporto and eliminato_il is null;
  if not found then return; end if;
  select * into t from public.tubazione_rapporto(p_rapporto);
  insert into fgas (rapporto_id, rapporto_numero, cliente_id, impianto, macchina, unita_interne, matricola, tecnico_id, data_installazione,
                    lunghezza_tubazione, tubazione_dettaglio, tipo_gas, gas_aggiunto_kg)
  values (r.id, r.numero, r.cliente_id, nullif(concat_ws(' ', r.tipo_impianto, r.impianto), ''), p_macchina, nullif(p_interne, ''), r.matricola, r.tecnico_id, r.data,
          t.totale, t.dettaglio, coalesce(r.tipo_gas, public.gas_da_descrizione(p_macchina)), r.gas_aggiunto_kg)
  on conflict (rapporto_id) do update set
    rapporto_numero = excluded.rapporto_numero, cliente_id = excluded.cliente_id, impianto = coalesce(fgas.impianto, excluded.impianto),
    macchina = excluded.macchina, unita_interne = excluded.unita_interne, matricola = coalesce(fgas.matricola, excluded.matricola),
    tecnico_id = excluded.tecnico_id, data_installazione = excluded.data_installazione,
    lunghezza_tubazione = excluded.lunghezza_tubazione, tubazione_dettaglio = excluded.tubazione_dettaglio,
    -- Quello scritto nel rapportino vale; altrimenti resta quello della scheda F-gas
    tipo_gas = coalesce(r.tipo_gas, fgas.tipo_gas, excluded.tipo_gas),
    gas_aggiunto_kg = coalesce(r.gas_aggiunto_kg, fgas.gas_aggiunto_kg);
end $$;
grant execute on function public.registra_fgas(bigint, text, text) to authenticated;

notify pgrst, 'reload schema';
