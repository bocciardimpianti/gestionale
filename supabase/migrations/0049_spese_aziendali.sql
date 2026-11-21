-- =====================================================================
-- Spese aziendali (menu PAGAMENTI): salari dei dipendenti, spese fisse e spese extra,
-- inserite a mano o importate da Excel. Entrano nel grafico "Ricavi e spese" della Home.
-- Si può eseguire anche più volte.
-- =====================================================================
insert into public.sezioni (chiave, etichetta, gruppo, ordine) values ('spese_aziendali', 'Spese aziendali', 'PAGAMENTI', 150)
on conflict (chiave) do nothing;

create table if not exists public.spese_aziendali (
  id            bigint generated always as identity primary key,
  data          date not null default current_date,
  tipo          text not null check (tipo in ('Salari dipendenti', 'Spese fisse', 'Spese extra')),
  descrizione   text,
  importo       numeric(12,2) not null default 0,
  note          text,
  archivio_id   bigint references public.archivi(id) on delete set null,
  eliminato_il  timestamptz,
  creato_il     timestamptz not null default now(),
  modificato_il timestamptz not null default now()
);
create index if not exists spese_aziendali_data on public.spese_aziendali (data);

drop trigger if exists spese_aziendali_modificato_il on public.spese_aziendali;
create trigger spese_aziendali_modificato_il before update on public.spese_aziendali
  for each row execute function public.aggiorna_modificato_il();
drop trigger if exists spese_aziendali_cestino on public.spese_aziendali;
create trigger spese_aziendali_cestino before update on public.spese_aziendali
  for each row execute function public.controlla_cestino('spese_aziendali');

-- Tipo scritto in modo libero (es. da Excel: "stipendi", "fisse", "extra") → uno dei tre tipi
create or replace function public.normalizza_tipo_spesa() returns trigger
language plpgsql as $$
begin
  new.tipo := case
    when new.tipo ~* '(salar|stipend|dipendent|busta|paga|contribut|inps|tfr)' then 'Salari dipendenti'
    when new.tipo ~* 'fiss' then 'Spese fisse'
    when new.tipo ~* '(extra|straordinar|varie|altro|altre)' then 'Spese extra'
    else new.tipo end;
  return new;
end $$;
drop trigger if exists spese_aziendali_tipo on public.spese_aziendali;
create trigger spese_aziendali_tipo before insert or update on public.spese_aziendali
  for each row execute function public.normalizza_tipo_spesa();

alter table public.spese_aziendali enable row level security;
drop policy if exists spese_aziendali_vedere on public.spese_aziendali;
create policy spese_aziendali_vedere on public.spese_aziendali for select using (public.puo('spese_aziendali', 'vedere'));
drop policy if exists spese_aziendali_creare on public.spese_aziendali;
create policy spese_aziendali_creare on public.spese_aziendali for insert with check (public.puo('spese_aziendali', 'creare'));
drop policy if exists spese_aziendali_modificare on public.spese_aziendali;
create policy spese_aziendali_modificare on public.spese_aziendali for update
  using (public.puo('spese_aziendali', 'modificare')) with check (public.puo('spese_aziendali', 'modificare'));
drop policy if exists spese_aziendali_eliminare on public.spese_aziendali;
create policy spese_aziendali_eliminare on public.spese_aziendali for delete using (public.puo('spese_aziendali', 'eliminare'));

notify pgrst, 'reload schema';
