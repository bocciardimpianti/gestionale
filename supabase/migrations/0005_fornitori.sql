-- =====================================================================
-- Fornitori + archivi di base: Province, Nazioni, Modalità pagamento, Banche
-- =====================================================================

create table public.province           (nome text primary key, ordine int not null default 0);
create table public.nazioni            (nome text primary key, ordine int not null default 0);
create table public.modalita_pagamento (nome text primary key, ordine int not null default 0);
create table public.banche             (nome text primary key, ordine int not null default 0);

insert into public.province (nome, ordine) values
  ('AG', 0), ('AL', 10), ('AN', 20), ('AO', 30), ('AR', 40), ('AP', 50), ('AT', 60), ('AV', 70), ('BA', 80), ('BT', 90),
  ('BL', 100), ('BN', 110), ('BG', 120), ('BI', 130), ('BO', 140), ('BZ', 150), ('BS', 160), ('BR', 170), ('CA', 180), ('CL', 190),
  ('CB', 200), ('CI', 210), ('CE', 220), ('CT', 230), ('CZ', 240), ('CH', 250), ('CO', 260), ('CS', 270), ('CR', 280), ('KR', 290),
  ('CN', 300), ('EN', 310), ('FM', 320), ('FE', 330), ('FI', 340), ('FG', 350), ('FC', 360), ('FR', 370), ('GE', 380), ('GO', 390),
  ('GR', 400), ('IM', 410), ('IS', 420), ('SP', 430), ('AQ', 440), ('LT', 450), ('LE', 460), ('LC', 470), ('LI', 480), ('LO', 490),
  ('LU', 500), ('MC', 510), ('MN', 520), ('MS', 530), ('MT', 540), ('ME', 550), ('MI', 560), ('MO', 570), ('MB', 580), ('NA', 590),
  ('NO', 600), ('NU', 610), ('OT', 620), ('OR', 630), ('PD', 640), ('PA', 650), ('PR', 660), ('PV', 670), ('PG', 680), ('PU', 690),
  ('PE', 700), ('PC', 710), ('PI', 720), ('PT', 730), ('PN', 740), ('PZ', 750), ('PO', 760), ('RG', 770), ('RA', 780), ('RC', 790),
  ('RE', 800), ('RI', 810), ('RN', 820), ('RM', 830), ('RO', 840), ('SA', 850), ('VS', 860), ('SS', 870), ('SV', 880), ('SI', 890),
  ('SR', 900), ('SO', 910), ('TA', 920), ('TE', 930), ('TR', 940), ('TO', 950), ('OG', 960), ('TP', 970), ('TN', 980), ('TV', 990),
  ('TS', 1000), ('UD', 1010), ('VA', 1020), ('VE', 1030), ('VB', 1040), ('VC', 1050), ('VR', 1060), ('VV', 1070), ('VI', 1080), ('VT', 1090);

insert into public.nazioni (nome, ordine) values
  ('Italia', 10), ('Germania', 20), ('Paesi Bassi', 30), ('Francia', 40), ('Spagna', 50),
  ('Austria', 60), ('Svizzera', 70), ('Lussemburgo', 80);

insert into public.modalita_pagamento (nome, ordine) values
  ('Bonifico bancario', 10), ('Ri.Ba.', 20), ('Rimessa diretta', 30), ('Contanti', 40),
  ('Assegno', 50), ('Carta di credito', 60), ('RID / SDD', 70);

do $$
declare t text;
begin
  foreach t in array array['province','nazioni','modalita_pagamento','banche'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.mfa_ok())', t || '_lettura', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;

create table public.fornitori (
  id                   bigint generated always as identity primary key,
  nome                 text not null,
  codice_fiscale       text,
  piva                 text,
  indirizzo            text,
  civico               text,
  cap                  text,
  comune               text,
  provincia            text,
  nazione              text,
  cellulare            text,
  fax                  text,
  telefono             text,
  email                text,
  modalita_pagamento   text,
  tipologia_pagamento  text,
  conto_corrente       text,
  iban                 text,
  banca                text,
  filiale              text,
  archivio_id          bigint references public.archivi(id) on delete set null,
  eliminato_il         timestamptz,
  creato_il            timestamptz not null default now(),
  modificato_il        timestamptz not null default now()
);

create index fornitori_nome_idx on public.fornitori (lower(nome));

create trigger fornitori_modificato_il
  before update on public.fornitori
  for each row execute function public.aggiorna_modificato_il();

create trigger fornitori_cestino
  before update on public.fornitori
  for each row execute function public.controlla_cestino('fornitori');

alter table public.fornitori enable row level security;
create policy fornitori_vedere     on public.fornitori for select using (public.puo('fornitori', 'vedere'));
create policy fornitori_creare     on public.fornitori for insert with check (public.puo('fornitori', 'creare'));
create policy fornitori_modificare on public.fornitori for update using (public.puo('fornitori', 'modificare')) with check (public.puo('fornitori', 'modificare'));
create policy fornitori_eliminare  on public.fornitori for delete using (public.puo('fornitori', 'eliminare'));
