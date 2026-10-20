-- =====================================================================
-- Impianti (collegati ai clienti) + archivio Periodi
-- =====================================================================

create table public.periodi (
  nome    text primary key,
  ordine  int not null default 0,
  mesi    int
);

insert into public.periodi (nome, ordine, mesi) values
  ('Su chiamata', 10, null), ('Mensile', 20, 1), ('Trimestrale', 30, 3), ('Quadrimestrale', 40, 4),
  ('Semestrale', 50, 6), ('Annuale', 60, 12), ('Biennale', 70, 24), ('Triennale', 80, 36);

alter table public.periodi enable row level security;
create policy periodi_lettura on public.periodi for select using (public.mfa_ok());
create policy periodi_admin   on public.periodi for all using (public.is_admin()) with check (public.is_admin());

create table public.impianti (
  id                bigint generated always as identity primary key,
  cliente_id        bigint references public.clienti(id) on delete set null,
  periodo           text,
  tipo_impianto     text,
  impianto          text,
  marca             text,
  modello           text,
  matricola         text,
  anno              text,
  note              text,
  materiali         text,
  data_prossimo     date,
  data_ultimo       date,
  archivio_id       bigint references public.archivi(id) on delete set null,
  eliminato_il      timestamptz,
  creato_il         timestamptz not null default now(),
  modificato_il     timestamptz not null default now()
);

create index impianti_cliente_idx on public.impianti (cliente_id);

create trigger impianti_modificato_il
  before update on public.impianti
  for each row execute function public.aggiorna_modificato_il();

create trigger impianti_cestino
  before update on public.impianti
  for each row execute function public.controlla_cestino('impianti');

alter table public.impianti enable row level security;
create policy impianti_vedere     on public.impianti for select using (public.puo('impianti', 'vedere'));
create policy impianti_creare     on public.impianti for insert with check (public.puo('impianti', 'creare'));
create policy impianti_modificare on public.impianti for update using (public.puo('impianti', 'modificare')) with check (public.puo('impianti', 'modificare'));
create policy impianti_eliminare  on public.impianti for delete using (public.puo('impianti', 'eliminare'));
