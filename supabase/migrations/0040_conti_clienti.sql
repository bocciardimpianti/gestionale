-- =====================================================================
-- Conti Clienti: per ogni cliente il totale dei rapportini eseguiti e non ancora riscossi
-- (casella "Pagata" non spuntata), con una soglia di avviso: 2500 € per tutti, modificabile
-- in generale e per ogni singolo cliente. Oltre la soglia: avviso nel gestionale e notifica sul telefono.
-- Si può eseguire anche più volte.
-- =====================================================================

-- Impostazioni generali del gestionale (chiave → valore)
create table if not exists public.impostazioni (
  chiave  text primary key,
  valore  jsonb not null
);
alter table public.impostazioni enable row level security;
drop policy if exists impostazioni_lettura on public.impostazioni;
create policy impostazioni_lettura on public.impostazioni for select using (public.mfa_ok());
drop policy if exists impostazioni_admin on public.impostazioni;
create policy impostazioni_admin on public.impostazioni for all using (public.is_admin()) with check (public.is_admin());
insert into public.impostazioni (chiave, valore) values ('soglia_conto_clienti', '2500') on conflict (chiave) do nothing;

-- Soglia del singolo cliente (vuota = quella generale) e ultimo avviso mandato
alter table public.clienti add column if not exists soglia_conto numeric(12,2);
alter table public.clienti add column if not exists conto_avvisato_il timestamptz;

create or replace function public.soglia_conto_predefinita() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (valore #>> '{}')::numeric from impostazioni where chiave = 'soglia_conto_clienti'), 2500)
$$;

-- Importo di un rapportino da riscuotere: lo stesso "Totale" della scheda
create or replace function public.importo_rapporto(r public.rapporti) returns numeric
language sql immutable as $$
  select case when r.considera_totale_preventivo then coalesce(r.totale_preventivo, 0) else coalesce(r.imponibile, 0) end
$$;

-- Elenco dei conti, dal più alto
create or replace function public.conti_clienti()
returns table (cliente_id bigint, cliente text, telefono text, rapporti int, totale numeric, dal date, al date,
               soglia numeric, soglia_personale boolean, oltre boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, coalesce(nullif(c.cellulare, ''), c.telefono), count(*)::int, sum(public.importo_rapporto(r)),
         min(r.data), max(r.data),
         coalesce(c.soglia_conto, public.soglia_conto_predefinita()), c.soglia_conto is not null,
         sum(public.importo_rapporto(r)) > coalesce(c.soglia_conto, public.soglia_conto_predefinita())
  from rapporti r
  join clienti c on c.id = r.cliente_id
  where public.puo('conti_clienti', 'vedere')
    and r.eliminato_il is null and not r.pagata and r.data <= current_date and public.importo_rapporto(r) > 0
  group by c.id
  order by 5 desc
$$;

-- Rapportini da riscuotere di un cliente
create or replace function public.rapporti_da_riscuotere_cliente(p_cliente bigint)
returns table (id bigint, numero int, data date, tecnico text, attivita text, importo numeric, fatto_conto text)
language sql stable security definer set search_path = public as $$
  select r.id, r.numero, r.data, t.nome, r.attivita, public.importo_rapporto(r), r.fatto_conto
  from rapporti r left join tecnici t on t.id = r.tecnico_id
  where public.puo('conti_clienti', 'vedere') and r.cliente_id = p_cliente
    and r.eliminato_il is null and not r.pagata and r.data <= current_date and public.importo_rapporto(r) > 0
  order by r.data, r.id
$$;

-- Segna come riscossi (pagati oggi, se non c'è già una data di pagamento)
create or replace function public.segna_riscossi(p_rapporti bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.puo('conti_clienti', 'modificare') or public.puo('rapporti', 'modificare')) then
    raise exception 'Non hai il permesso di segnare i rapportini come pagati';
  end if;
  update rapporti set pagata = true, data_pagamento = coalesce(data_pagamento, current_date)
  where id = any(p_rapporti) and not pagata and eliminato_il is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Soglia di un cliente (vuota = quella generale) e soglia generale (solo amministratore)
create or replace function public.imposta_soglia_conto(p_cliente bigint, p_soglia numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.puo('conti_clienti', 'modificare') or public.puo('clienti', 'modificare')) then
    raise exception 'Non hai il permesso di cambiare la soglia';
  end if;
  update clienti set soglia_conto = p_soglia, conto_avvisato_il = null where id = p_cliente;
end $$;

create or replace function public.imposta_soglia_conto_predefinita(p_soglia numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo l''amministratore può cambiare la soglia generale'; end if;
  if p_soglia is null or p_soglia < 0 then raise exception 'Soglia non valida'; end if;
  insert into impostazioni (chiave, valore) values ('soglia_conto_clienti', to_jsonb(p_soglia))
  on conflict (chiave) do update set valore = excluded.valore;
  update clienti set conto_avvisato_il = null where soglia_conto is null;
end $$;

-- Per la funzione "notifiche": clienti appena andati oltre la soglia (da avvisare una volta sola);
-- chi è tornato sotto la soglia potrà essere avvisato di nuovo la prossima volta
create or replace function public.conti_da_avvisare()
returns table (cliente_id bigint, cliente text, totale numeric, soglia numeric)
language plpgsql security definer set search_path = public as $$
begin
  update clienti c set conto_avvisato_il = null
  where c.conto_avvisato_il is not null and coalesce((
    select sum(public.importo_rapporto(r)) from rapporti r
    where r.cliente_id = c.id and r.eliminato_il is null and not r.pagata and r.data <= current_date), 0)
    <= coalesce(c.soglia_conto, public.soglia_conto_predefinita());
  return query
  with oltre as (
    select c.id, c.nome, sum(public.importo_rapporto(r)) as tot, coalesce(c.soglia_conto, public.soglia_conto_predefinita()) as sog
    from clienti c join rapporti r on r.cliente_id = c.id
    where c.conto_avvisato_il is null and r.eliminato_il is null and not r.pagata and r.data <= current_date
    group by c.id
    having sum(public.importo_rapporto(r)) > coalesce(c.soglia_conto, public.soglia_conto_predefinita())
  ), segnati as (
    update clienti c set conto_avvisato_il = now() from oltre o where c.id = o.id returning c.id
  )
  select o.id, o.nome, o.tot, o.sog from oltre o join segnati s on s.id = o.id;
end $$;

revoke execute on function public.conti_da_avvisare() from public, anon, authenticated;
grant execute on function public.conti_da_avvisare() to service_role;
grant execute on function public.conti_clienti() to authenticated;
grant execute on function public.rapporti_da_riscuotere_cliente(bigint) to authenticated;
grant execute on function public.segna_riscossi(bigint[]) to authenticated;
grant execute on function public.imposta_soglia_conto(bigint, numeric) to authenticated;
grant execute on function public.imposta_soglia_conto_predefinita(numeric) to authenticated;
grant execute on function public.soglia_conto_predefinita() to authenticated;

notify pgrst, 'reload schema';
