-- =====================================================================
-- Righe dei rapporti importate da ReportOne: non scaricano di nuovo la giacenza
-- (le giacenze importate tengono già conto di quei consumi)
-- =====================================================================

alter table public.righe_rapporto
  add column if not exists importata boolean not null default false;

create or replace function public.scarica_giacenza() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.materiale_id is not null and not old.importata then
    update public.materiali set giacenza = giacenza + coalesce(old.quantita, 0) where id = old.materiale_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.materiale_id is not null and not new.importata then
    update public.materiali set giacenza = giacenza - coalesce(new.quantita, 0) where id = new.materiale_id;
  end if;
  return null;
end $$;
