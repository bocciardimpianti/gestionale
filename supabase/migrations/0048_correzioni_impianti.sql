-- =====================================================================
-- Correzioni dei materiali degli impianti: togliendo o aggiungendo a mano un materiale nella linguetta
-- Materiali di un impianto, la scelta viene ricordata (per categoria) e usata dalle regole e dall'IA
-- le volte successive. Si può eseguire anche più volte.
-- =====================================================================
create table if not exists public.correzioni_impianti (
  id          bigint generated always as identity primary key,
  categoria   text not null,
  descrizione text not null,
  incluso     boolean not null,
  utente_id   uuid default auth.uid(),
  creato_il   timestamptz not null default now(),
  unique (categoria, descrizione)
);
alter table public.correzioni_impianti enable row level security;
drop policy if exists correzioni_impianti_vedere on public.correzioni_impianti;
create policy correzioni_impianti_vedere on public.correzioni_impianti for select using (public.puo('impianti', 'vedere'));

-- Descrizione confrontabile: maiuscole e spazi singoli
create or replace function public.chiave_correzione(t text) returns text
language sql immutable as $$ select upper(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g')) $$;

create or replace function public.ricorda_correzione(p_categoria text, p_descrizione text, p_incluso boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_categoria is null or public.chiave_correzione(p_descrizione) = '' then return; end if;
  insert into correzioni_impianti (categoria, descrizione, incluso)
  values (p_categoria, public.chiave_correzione(p_descrizione), p_incluso)
  on conflict (categoria, descrizione) do update set incluso = excluded.incluso, utente_id = auth.uid(), creato_il = now();
end $$;
revoke execute on function public.ricorda_correzione(text, text, boolean) from public, anon, authenticated;

-- Toglie un materiale dall'impianto e ricorda di non metterlo più per quella categoria
create or replace function public.togli_materiale_impianto(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if not public.puo('impianti', 'modificare') then raise exception 'Non hai il permesso di modificare gli impianti'; end if;
  select mi.descrizione, i.categoria into m from materiali_impianto mi join impianti i on i.id = mi.impianto_id where mi.id = p_id;
  if not found then return; end if;
  delete from materiali_impianto where id = p_id;
  perform public.ricorda_correzione(m.categoria, m.descrizione, false);
end $$;
grant execute on function public.togli_materiale_impianto(bigint) to authenticated;

-- Aggiunge a mano un materiale all'impianto e ricorda di tenerlo per quella categoria
create or replace function public.aggiungi_materiale_impianto(p_impianto bigint, p_descrizione text, p_quantita numeric, p_unita text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_cat text; v_id bigint;
begin
  if not public.puo('impianti', 'modificare') then raise exception 'Non hai il permesso di modificare gli impianti'; end if;
  if btrim(coalesce(p_descrizione, '')) = '' then raise exception 'Scrivi la descrizione del materiale'; end if;
  select categoria into v_cat from impianti where id = p_impianto;
  if not found then raise exception 'Impianto non trovato'; end if;
  insert into materiali_impianto (impianto_id, rapporto_id, materiale_id, descrizione, quantita, unita_misura, ordine)
  values (p_impianto, null, (select id from materiali where public.chiave_correzione(descrizione) = public.chiave_correzione(p_descrizione) limit 1),
          btrim(p_descrizione), coalesce(p_quantita, 1), nullif(btrim(coalesce(p_unita, '')), ''),
          coalesce((select max(ordine) + 1 from materiali_impianto where impianto_id = p_impianto), 1))
  returning id into v_id;
  perform public.ricorda_correzione(v_cat, p_descrizione, true);
  return v_id;
end $$;
grant execute on function public.aggiungi_materiale_impianto(bigint, text, numeric, text) to authenticated;

notify pgrst, 'reload schema';
