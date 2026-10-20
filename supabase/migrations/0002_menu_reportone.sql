-- =====================================================================
-- Menu come il programma originale (gruppi e voci) + note della dashboard
-- =====================================================================

alter table public.sezioni add column if not exists gruppo text not null default '';

-- Rimuove le sezioni provvisorie non presenti nel programma originale
delete from public.sezioni
where chiave not in (
  'home','start_tecnici','clienti','fornitori','tecnici','impianti',
  'rapporti','agenda','preventivi','richieste','ddt_acquisto',
  'materiali','scadenziario','conti_clienti'
);

insert into public.sezioni (chiave, etichetta, gruppo, ordine) values
  ('home',          'Home',                    'DASHBOARD',  10),
  ('start_tecnici', 'Start Tecnici',           'DASHBOARD',  20),
  ('clienti',       'Clienti',                 'ANAGRAFICHE',30),
  ('fornitori',     'Fornitori',               'ANAGRAFICHE',40),
  ('tecnici',       'Tecnici',                 'ANAGRAFICHE',50),
  ('impianti',      'Impianti',                'ANAGRAFICHE',60),
  ('rapporti',      'Rapporti di intervento',  'ATTIVITA''', 70),
  ('agenda',        'Agenda',                  'ATTIVITA''', 80),
  ('preventivi',    'Preventivi',              'ATTIVITA''', 90),
  ('richieste',     'Richieste di Intervento', 'ATTIVITA''',100),
  ('ddt_acquisto',  'DDT di Acquisto',         'DOCUMENTI', 110),
  ('materiali',     'Materiali',               'MAGAZZINO', 120),
  ('scadenziario',  'Scadenziario',            'PAGAMENTI', 130),
  ('conti_clienti', 'Conti Clienti',           'PAGAMENTI', 140)
on conflict (chiave) do update
  set etichetta = excluded.etichetta, gruppo = excluded.gruppo, ordine = excluded.ordine;

-- Note condivise della dashboard
create table if not exists public.note_dashboard (
  id              int primary key default 1 check (id = 1),
  testo           text not null default '',
  modificato_da   uuid references public.profili(id) on delete set null,
  modificato_il   timestamptz not null default now()
);
insert into public.note_dashboard (id) values (1) on conflict do nothing;

alter table public.note_dashboard enable row level security;
create policy note_lettura on public.note_dashboard
  for select using (public.puo('home', 'vedere'));
create policy note_scrittura on public.note_dashboard
  for update using (public.puo('home', 'modificare')) with check (public.puo('home', 'modificare'));
