-- =====================================================================
-- Preventivo guidato: frutti della serie civile.
-- Il prezzo di ogni voce (presa TV, interruttore…) è il MONTAGGIO; il frutto (es. presa TV Matix) si aggiunge
-- da solo con il suo prezzo di vendita, trovato nel catalogo dalla serie scelta.
-- - voci_impianto.frutto_cerca: parole per trovare il frutto (es. "presa.*tv|coassial"); vuoto = la voce non ha frutto
-- - voci_impianto.frutti_per_punto: quanti frutti per ogni punto (di solito 1)
-- - serie_civili.cerca_frutti: come compare la serie nel catalogo (es. "matix"); vuoto = dal nome della serie
-- - serie_frutti: frutto scelto a mano per una serie e una voce (al posto di quello trovato da solo)
-- Si può eseguire anche più volte.
-- =====================================================================
alter table public.voci_impianto add column if not exists frutto_cerca text;
alter table public.voci_impianto add column if not exists frutti_per_punto numeric(6,2) not null default 1;
alter table public.serie_civili add column if not exists cerca_frutti text;

create table if not exists public.serie_frutti (
  serie_id     bigint not null references public.serie_civili(id) on delete cascade,
  voce_id      bigint not null references public.voci_impianto(id) on delete cascade,
  materiale_id bigint references public.materiali(id) on delete set null,
  prezzo       numeric(12,2),
  primary key (serie_id, voce_id)
);
alter table public.serie_frutti enable row level security;
drop policy if exists serie_frutti_lettura on public.serie_frutti;
create policy serie_frutti_lettura on public.serie_frutti for select using (public.puo('preventivi', 'vedere'));
drop policy if exists serie_frutti_admin on public.serie_frutti;
create policy serie_frutti_admin on public.serie_frutti for all using (public.is_admin()) with check (public.is_admin());

-- Parole di partenza per le voci elettriche più comuni (si cambiano in Impianti tipo)
update public.voci_impianto v set frutto_cerca = x.cerca
from (values
  ('Interruttore', 'interrutt'),
  ('Deviatore', 'deviat'),
  ('Invertitore', 'invertit'),
  ('Pulsante', 'pulsant'),
  ('Presa 10A', 'presa.*\b10 ?a\b|2p\+t.*\b10 ?a\b'),
  ('Presa 16A / bipasso', 'bipass|presa.*\b16 ?a\b'),
  ('Presa Schuko', 'schuko|unel'),
  ('Presa TV', 'presa.*\btv\b|\btv\b.*presa|presa.*televis|coassial'),
  ('Presa SAT', 'presa.*\bsat\b|\bsat\b.*presa'),
  ('Presa dati RJ45', 'rj ?45'),
  ('Presa telefono', 'rj ?11|presa.*telefon')
) as x(nome, cerca)
where v.tipo = 'elettrico' and v.nome = x.nome and v.frutto_cerca is null;

notify pgrst, 'reload schema';
