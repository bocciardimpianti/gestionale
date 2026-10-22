-- =====================================================================
-- Preventivi + righe
-- =====================================================================

create table public.preventivi (
  id                     bigint generated always as identity primary key,
  data                   date not null default current_date,
  numero                 text,
  cliente_id             bigint references public.clienti(id) on delete set null,
  email                  text,
  stato                  text,
  sconto                 numeric(6,2) not null default 0,
  iva                    numeric(6,2) not null default 0,
  tipologia_pagamento    text,
  modalita_pagamento     text,
  pagata                 boolean not null default false,
  note                   text,
  firma                  text,
  imponibile             numeric(12,2) not null default 0,
  sconto_totale          numeric(12,2) not null default 0,
  prezzo_scontato        numeric(12,2) not null default 0,
  iva_totale             numeric(12,2) not null default 0,
  totale                 numeric(12,2) not null default 0,
  gguid_reportone        text unique,
  archivio_id            bigint references public.archivi(id) on delete set null,
  eliminato_il           timestamptz,
  creato_il              timestamptz not null default now(),
  modificato_il          timestamptz not null default now()
);

create index preventivi_data_idx on public.preventivi (data desc);
create index preventivi_cliente_idx on public.preventivi (cliente_id);

-- Numero automatico (progressivo) se non indicato
create or replace function public.numera_preventivo() returns trigger
language plpgsql as $$
begin
  if new.numero is null or btrim(new.numero) = '' then
    perform pg_advisory_xact_lock(hashtext('numera_preventivo'));
    select coalesce(max(numero::int), 0) + 1 into new.numero
    from public.preventivi where numero ~ '^[0-9]{1,9}$';
  end if;
  return new;
end $$;

create trigger preventivi_numero
  before insert on public.preventivi
  for each row execute function public.numera_preventivo();

create trigger preventivi_modificato_il
  before update on public.preventivi
  for each row execute function public.aggiorna_modificato_il();

create trigger preventivi_cestino
  before update on public.preventivi
  for each row execute function public.controlla_cestino('preventivi');

alter table public.preventivi enable row level security;
create policy preventivi_vedere     on public.preventivi for select using (public.puo('preventivi', 'vedere'));
create policy preventivi_creare     on public.preventivi for insert with check (public.puo('preventivi', 'creare'));
create policy preventivi_modificare on public.preventivi for update using (public.puo('preventivi', 'modificare')) with check (public.puo('preventivi', 'modificare'));
create policy preventivi_eliminare  on public.preventivi for delete using (public.puo('preventivi', 'eliminare'));

create table public.righe_preventivo (
  id               bigint generated always as identity primary key,
  preventivo_id    bigint not null references public.preventivi(id) on delete cascade,
  ordine           int not null default 0,
  materiale_id     bigint references public.materiali(id) on delete set null,
  codice_barre     text,
  descrizione      text,
  unita_misura     text,
  quantita         numeric(12,3),
  prezzo_base      numeric(12,4),
  ricarico         numeric(8,2),
  prezzo           numeric(12,4),
  totale           numeric(12,2)
);

create index righe_preventivo_idx on public.righe_preventivo (preventivo_id, ordine);

alter table public.righe_preventivo enable row level security;
create policy righe_preventivo_vedere on public.righe_preventivo for select using (public.puo('preventivi', 'vedere'));
create policy righe_preventivo_creare on public.righe_preventivo for insert
  with check (public.puo('preventivi', 'creare') or public.puo('preventivi', 'modificare'));
create policy righe_preventivo_modificare on public.righe_preventivo for update
  using (public.puo('preventivi', 'modificare')) with check (public.puo('preventivi', 'modificare'));
create policy righe_preventivo_eliminare on public.righe_preventivo for delete using (public.puo('preventivi', 'modificare'));

-- Archivio file per la firma del preventivo
insert into storage.buckets (id, name, public)
values ('preventivi', 'preventivi', false)
on conflict (id) do nothing;

create policy preventivi_file_vedere on storage.objects for select
  using (bucket_id = 'preventivi' and public.puo('preventivi', 'vedere'));
create policy preventivi_file_caricare on storage.objects for insert
  with check (bucket_id = 'preventivi' and (public.puo('preventivi', 'creare') or public.puo('preventivi', 'modificare')));
create policy preventivi_file_modificare on storage.objects for update
  using (bucket_id = 'preventivi' and public.puo('preventivi', 'modificare'));
create policy preventivi_file_eliminare on storage.objects for delete
  using (bucket_id = 'preventivi' and public.puo('preventivi', 'modificare'));

-- Opzioni dei pagamenti come nell'originale
insert into public.modalita_pagamento (nome, ordine) values ('Bonifico', 5), ('Carta di Credito', 45)
on conflict (nome) do nothing;
