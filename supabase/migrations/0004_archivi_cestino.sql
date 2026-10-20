-- =====================================================================
-- Archivi (cartelle per raggruppare i record) e Cestino (eliminazione recuperabile)
-- =====================================================================

create table public.archivi (
  id         bigint generated always as identity primary key,
  sezione    text not null references public.sezioni(chiave) on delete cascade,
  nome       text not null,
  creato_il  timestamptz not null default now(),
  unique (sezione, nome)
);

alter table public.archivi enable row level security;
create policy archivi_vedere on public.archivi for select using (public.puo(sezione, 'vedere'));
create policy archivi_creare on public.archivi for insert with check (public.puo(sezione, 'modificare'));
create policy archivi_modificare on public.archivi for update using (public.puo(sezione, 'modificare'));
create policy archivi_eliminare on public.archivi for delete using (public.puo(sezione, 'eliminare'));

alter table public.clienti
  add column archivio_id bigint references public.archivi(id) on delete set null,
  add column eliminato_il timestamptz;

-- Spostare nel cestino o ripristinare richiede il permesso "eliminare" della sezione
create or replace function public.controlla_cestino() returns trigger
language plpgsql as $$
begin
  if new.eliminato_il is distinct from old.eliminato_il and not public.puo(tg_argv[0], 'eliminare') then
    raise exception 'Non hai il permesso di eliminare in questa sezione';
  end if;
  return new;
end $$;

create trigger clienti_cestino
  before update on public.clienti
  for each row execute function public.controlla_cestino('clienti');
