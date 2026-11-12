-- =====================================================================
-- Sinonimi per la ricerca dei materiali ("gomito" trova anche "curva")
-- Ogni riga è un gruppo di parole equivalenti separate da virgola; si modifica dal gestionale
-- (pulsante "Sinonimi" nella finestra Aggiungi materiali, solo admin).
-- Si può eseguire anche più volte.
-- =====================================================================
create table if not exists public.sinonimi_ricerca (
  nome    text primary key,
  ordine  int not null default 0
);
alter table public.sinonimi_ricerca enable row level security;
drop policy if exists sinonimi_ricerca_lettura on public.sinonimi_ricerca;
create policy sinonimi_ricerca_lettura on public.sinonimi_ricerca for select using (public.mfa_ok());
drop policy if exists sinonimi_ricerca_admin on public.sinonimi_ricerca;
create policy sinonimi_ricerca_admin on public.sinonimi_ricerca for all using (public.is_admin()) with check (public.is_admin());

insert into public.sinonimi_ricerca (nome, ordine) values
  ('gomito, curva', 10),
  ('manicotto, giunto, giunzione', 20),
  ('niples, nipplo, nipple', 30),
  ('riduzione, ridotto, riduttore', 40),
  ('flessibile, flex', 50),
  ('rubinetto, valvola', 60),
  ('saracinesca, valvola a saracinesca', 70),
  ('braga, diramazione', 80),
  ('tee, raccordo a t', 90),
  ('tassello, fischer, fisch, ancorante', 100),
  ('differenziale, salvavita', 110),
  ('magnetotermico, automatico', 120),
  ('schuko, tedesca', 130),
  ('placca, mostrina', 140),
  ('scatola, cassetta', 150),
  ('corrugato, guaina', 160),
  ('canalina, canaletta, canale', 170),
  ('fascetta, stringicavo', 180),
  ('lampada, lampadina', 190),
  ('plafoniera, plafone', 200),
  ('faretto, spot', 210),
  ('termostato, cronotermostato', 220),
  ('scaldabagno, boiler, scaldacqua', 230),
  ('radiatore, termosifone, calorifero', 240),
  ('miscelatore, monocomando', 250),
  ('vaso, wc, water, tazza', 260),
  ('lavabo, lavandino', 270),
  ('lavello, acquaio', 280),
  ('guarnizione, oring, o-ring', 290),
  ('canapa, stoppa', 300),
  ('teflon, ptfe', 310),
  ('cavo, cordina', 320),
  ('capocorda, puntale', 330),
  ('morsetto, morsettiera, wago', 340),
  ('contattore, teleruttore', 350),
  ('rele, relais', 360),
  ('quadro, centralino', 370),
  ('zincato, galvanizzato', 380),
  ('pompa, circolatore', 390),
  ('alimentatore, trasformatore', 400),
  ('condizionatore, climatizzatore, split', 410),
  ('prolunga, ciabatta, multipresa', 420),
  ('sensore, rilevatore', 430),
  ('silicone, sigillante', 440),
  ('fumaria, fumi', 450)
on conflict (nome) do nothing;
