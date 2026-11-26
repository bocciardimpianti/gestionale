-- Conti Clienti: "Segna già conteggiati" con la data del conto. Di solito oggi; per un rapportino dimenticato
-- si può scegliere la data di un conto già fatto per quel cliente (così entra nello stesso conto).
drop function if exists public.segna_conteggiati(bigint[], boolean);
create or replace function public.segna_conteggiati(p_rapporti bigint[], p_conteggiati boolean, p_data date default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then
    raise exception 'Solo un amministratore può segnare i rapportini come conteggiati';
  end if;
  update rapporti set fatto_conto = case when p_conteggiati then 'Si' else null end,
                      conteggiato_il = case when p_conteggiati then coalesce(p_data, current_date) else null end
  where id = any(p_rapporti) and eliminato_il is null;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.segna_conteggiati(bigint[], boolean, date) to authenticated;
notify pgrst, 'reload schema';
