-- =====================================================================
-- Riordino delle descrizioni dei materiali (Magazzino → Materiali → Azioni → Riordina descrizioni):
-- la descrizione vecchia resta salvata in "descrizione_prima_riordino" e si può ripristinare.
-- Codici, prezzi e collegamenti (rapportini, DDT, kit…) non cambiano. Si può eseguire anche più volte.
-- =====================================================================
alter table public.materiali add column if not exists descrizione_prima_riordino text;

-- Applica le nuove descrizioni: [{ "id": 1, "descrizione": "…" }, …]
create or replace function public.riordina_descrizioni_materiali(p_righe jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.puo('materiali', 'modificare') then raise exception 'Non hai il permesso di modificare i materiali'; end if;
  update materiali m set
    descrizione_prima_riordino = coalesce(m.descrizione_prima_riordino, m.descrizione),
    descrizione = x.descrizione
  from jsonb_to_recordset(p_righe) as x(id bigint, descrizione text)
  where m.id = x.id and coalesce(btrim(x.descrizione), '') <> '' and m.descrizione is distinct from x.descrizione;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.riordina_descrizioni_materiali(jsonb) to authenticated;

-- Torna alle descrizioni di prima (tutte, oppure solo quelle indicate)
create or replace function public.ripristina_descrizioni_materiali(p_ids bigint[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.puo('materiali', 'modificare') then raise exception 'Non hai il permesso di modificare i materiali'; end if;
  update materiali set descrizione = descrizione_prima_riordino, descrizione_prima_riordino = null
  where descrizione_prima_riordino is not null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.ripristina_descrizioni_materiali(bigint[]) to authenticated;

notify pgrst, 'reload schema';
