-- =====================================================================
-- Preferenze di ogni utente (es. le scelte fatte nei grafici della Home: periodo, tecnici e fornitori selezionati…),
-- così restano uguali su tutti i dispositivi. Ognuno vede e cambia solo le sue. Si può eseguire anche più volte.
-- =====================================================================
create table if not exists public.preferenze_utente (
  utente_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chiave        text not null,
  valore        jsonb,
  modificato_il timestamptz not null default now(),
  primary key (utente_id, chiave)
);
alter table public.preferenze_utente enable row level security;
drop policy if exists preferenze_mie on public.preferenze_utente;
create policy preferenze_mie on public.preferenze_utente for all
  using (utente_id = auth.uid()) with check (utente_id = auth.uid());

notify pgrst, 'reload schema';
