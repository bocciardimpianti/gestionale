-- =====================================================================
-- DDT di Acquisto: se il costo (al netto dello sconto di riga) è PIÙ ALTO del prezzo base
-- del materiale, il magazzino si aggiorna (prezzo base e prezzo ricaricato con lo stesso ricarico %).
-- Se è più basso (es. sconti temporanei) il magazzino resta com'è.
-- Le righe importate da ReportOne e i servizi non cambiano nulla.
-- =====================================================================

create or replace function public.aggiorna_costo_materiale() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  netto numeric;
begin
  if new.materiale_id is null or new.importata or new.servizio or new.costo is null then
    return null;
  end if;
  netto := round(new.costo * (1 - coalesce(new.sconto, 0) / 100), 4);
  update public.materiali
     set prezzo_base = netto,
         prezzo_ricaricato = round(netto * (1 + coalesce(ricarico, 0) / 100), 4)
   where id = new.materiale_id
     and netto > coalesce(prezzo_base, 0);
  return null;
end $$;

create trigger righe_ddt_acquisto_costo
  after insert or update on public.righe_ddt_acquisto
  for each row execute function public.aggiorna_costo_materiale();
