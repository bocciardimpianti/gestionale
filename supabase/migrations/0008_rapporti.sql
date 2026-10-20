-- =====================================================================
-- Rapporti di intervento + righe (materiali/lavorazioni) + Stati documento
-- =====================================================================

create table public.stati_documento (
  nome    text primary key,
  ordine  int not null default 0
);
insert into public.stati_documento (nome, ordine) values ('Aperto', 10), ('Eseguito', 20);

alter table public.stati_documento enable row level security;
create policy stati_documento_lettura on public.stati_documento for select using (public.mfa_ok());
create policy stati_documento_admin   on public.stati_documento for all using (public.is_admin()) with check (public.is_admin());

create table public.rapporti (
  id                           bigint generated always as identity primary key,
  numero                       int,
  data                         date not null default current_date,
  tecnico_id                   bigint references public.tecnici(id) on delete set null,
  tecnico_vecchio              text,
  ora_inizio                   time,
  ora_fine                     time,
  ore_pausa                    numeric(6,2),
  totale_ore                   numeric(6,2),
  km_percorsi                  numeric(8,1),
  diritto_chiamata             numeric(12,2),
  tariffa_fissa                numeric(12,2),
  tariffa_oraria               numeric(12,2),
  tariffa_km                   numeric(12,2),
  iva                          numeric(5,2),
  cliente_id                   bigint references public.clienti(id) on delete set null,
  impianto_id                  bigint references public.impianti(id) on delete set null,
  tipo_impianto                text,
  impianto                     text,
  marca                        text,
  modello                      text,
  matricola                    text,
  rif_preventivo               text,
  fatto_conto                  text,
  stato                        text,
  pagata                       boolean not null default false,
  data_pagamento               date,
  attivita                     text,
  note                         text,
  pagamento_contanti           boolean not null default false,
  azzera_imponibile            boolean not null default false,
  considera_totale_preventivo  boolean not null default false,
  imponibile                   numeric(12,2) not null default 0,
  totale_preventivo            numeric(12,2) not null default 0,
  gimpianto                    text,
  archivio_id                  bigint references public.archivi(id) on delete set null,
  eliminato_il                 timestamptz,
  creato_il                    timestamptz not null default now(),
  modificato_il                timestamptz not null default now()
);

create index rapporti_data_idx on public.rapporti (data desc);
create index rapporti_cliente_idx on public.rapporti (cliente_id);
create index rapporti_impianto_idx on public.rapporti (impianto_id);

-- Numero progressivo automatico se non indicato
create or replace function public.numera_rapporto() returns trigger
language plpgsql as $$
begin
  if new.numero is null then
    perform pg_advisory_xact_lock(hashtext('numera_rapporto'));
    select coalesce(max(numero), 0) + 1 into new.numero from public.rapporti;
  end if;
  return new;
end $$;

create trigger rapporti_numero
  before insert on public.rapporti
  for each row execute function public.numera_rapporto();

create trigger rapporti_modificato_il
  before update on public.rapporti
  for each row execute function public.aggiorna_modificato_il();

create trigger rapporti_cestino
  before update on public.rapporti
  for each row execute function public.controlla_cestino('rapporti');

alter table public.rapporti enable row level security;
create policy rapporti_vedere     on public.rapporti for select using (public.puo('rapporti', 'vedere'));
create policy rapporti_creare     on public.rapporti for insert with check (public.puo('rapporti', 'creare'));
create policy rapporti_modificare on public.rapporti for update using (public.puo('rapporti', 'modificare')) with check (public.puo('rapporti', 'modificare'));
create policy rapporti_eliminare  on public.rapporti for delete using (public.puo('rapporti', 'eliminare'));

create table public.righe_rapporto (
  id               bigint generated always as identity primary key,
  rapporto_id      bigint not null references public.rapporti(id) on delete cascade,
  ordine           int not null default 0,
  codice_barre     text,
  descrizione      text,
  codice_articolo  text,
  quantita         numeric(12,3),
  unita_misura     text,
  prezzo           numeric(12,4),
  ricarico         numeric(8,2),
  prezzo_finale    numeric(12,4),
  totale           numeric(12,2),
  nome_articolo    text
);

create index righe_rapporto_idx on public.righe_rapporto (rapporto_id, ordine);

alter table public.righe_rapporto enable row level security;
create policy righe_rapporto_vedere on public.righe_rapporto for select using (public.puo('rapporti', 'vedere'));
create policy righe_rapporto_creare on public.righe_rapporto for insert
  with check (public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare'));
create policy righe_rapporto_modificare on public.righe_rapporto for update
  using (public.puo('rapporti', 'modificare')) with check (public.puo('rapporti', 'modificare'));
create policy righe_rapporto_eliminare on public.righe_rapporto for delete using (public.puo('rapporti', 'modificare'));
