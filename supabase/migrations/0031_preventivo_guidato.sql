-- =====================================================================
-- Preventivo guidato (foglio per ambienti): catalogo delle voci d'impianto con prezzo a punto
-- e kit di materiali facoltativo, ambienti tipo (Cucina, Camera, Bagno…) con le loro voci.
-- Il foglio salvato resta nel preventivo (colonna "configurazione") per poterlo riaprire.
-- Si può eseguire anche più volte: le voci e gli ambienti già presenti non vengono toccati.
-- =====================================================================
create table if not exists public.voci_impianto (
  id      bigint generated always as identity primary key,
  tipo    text not null check (tipo in ('elettrico', 'idraulico')),
  nome    text not null,
  unita   text not null default 'pz',
  prezzo  numeric(12,2),            -- prezzo a punto; vuoto = somma del kit di materiali
  ordine  int not null default 0,
  attiva  boolean not null default true,
  unique (tipo, nome)
);
create table if not exists public.voci_impianto_kit (
  id            bigint generated always as identity primary key,
  voce_id       bigint not null references public.voci_impianto(id) on delete cascade,
  materiale_id  bigint not null references public.materiali(id) on delete cascade,
  quantita      numeric(12,3) not null default 1
);
create table if not exists public.ambienti_tipo (
  id      bigint generated always as identity primary key,
  tipo    text not null check (tipo in ('elettrico', 'idraulico')),
  nome    text not null,
  ordine  int not null default 0,
  unique (tipo, nome)
);
create table if not exists public.ambienti_tipo_voci (
  ambiente_id  bigint not null references public.ambienti_tipo(id) on delete cascade,
  voce_id      bigint not null references public.voci_impianto(id) on delete cascade,
  quantita     numeric(12,3) not null default 1,
  primary key (ambiente_id, voce_id)
);
alter table public.preventivi add column if not exists configurazione jsonb;

do $$
declare t text;
begin
  foreach t in array array['voci_impianto', 'voci_impianto_kit', 'ambienti_tipo', 'ambienti_tipo_voci'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_lettura', t);
    execute format('create policy %I on public.%I for select using (public.puo(''preventivi'', ''vedere''))', t || '_lettura', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;

-- Voci e ambienti di partenza (prezzi da impostare nella pagina "Impianti tipo")
insert into public.voci_impianto (tipo, nome, unita, ordine) values
  ('elettrico', 'Punto luce', 'pz', 10),
  ('elettrico', 'Interruttore', 'pz', 20),
  ('elettrico', 'Deviatore', 'pz', 30),
  ('elettrico', 'Invertitore', 'pz', 40),
  ('elettrico', 'Pulsante', 'pz', 50),
  ('elettrico', 'Presa 10A', 'pz', 60),
  ('elettrico', 'Presa 16A / bipasso', 'pz', 70),
  ('elettrico', 'Presa Schuko', 'pz', 80),
  ('elettrico', 'Presa TV', 'pz', 90),
  ('elettrico', 'Presa SAT', 'pz', 100),
  ('elettrico', 'Presa dati RJ45', 'pz', 110),
  ('elettrico', 'Presa telefono', 'pz', 120),
  ('elettrico', 'Linea dedicata (forno, piano cottura, lavatrice)', 'pz', 130),
  ('elettrico', 'Punto termostato', 'pz', 140),
  ('elettrico', 'Punto campanello', 'pz', 150),
  ('elettrico', 'Lampada di emergenza', 'pz', 160),
  ('elettrico', 'Punto aspiratore', 'pz', 170),
  ('elettrico', 'Quadro elettrico', 'a corpo', 180),
  ('idraulico', 'Punto acqua lavabo', 'pz', 10),
  ('idraulico', 'Punto WC', 'pz', 20),
  ('idraulico', 'Punto bidet', 'pz', 30),
  ('idraulico', 'Punto doccia', 'pz', 40),
  ('idraulico', 'Punto vasca', 'pz', 50),
  ('idraulico', 'Punto lavello cucina', 'pz', 60),
  ('idraulico', 'Punto lavatrice', 'pz', 70),
  ('idraulico', 'Punto lavastoviglie', 'pz', 80),
  ('idraulico', 'Collettore', 'pz', 90),
  ('idraulico', 'Rubinetto esterno', 'pz', 100),
  ('idraulico', 'Scarico', 'pz', 110),
  ('idraulico', 'Allaccio caldaia', 'a corpo', 120)
on conflict (tipo, nome) do nothing;

insert into public.ambienti_tipo (tipo, nome, ordine) values
  ('elettrico', 'Cucina', 10),
  ('elettrico', 'Camera', 20),
  ('elettrico', 'Soggiorno', 30),
  ('elettrico', 'Bagno', 40),
  ('elettrico', 'Corridoio / ingresso', 50),
  ('elettrico', 'Esterno', 60),
  ('elettrico', 'Quadro elettrico', 70),
  ('idraulico', 'Bagno', 10),
  ('idraulico', 'Cucina', 20),
  ('idraulico', 'Lavanderia', 30),
  ('idraulico', 'Esterno', 40),
  ('idraulico', 'Caldaia', 50)
on conflict (tipo, nome) do nothing;

insert into public.ambienti_tipo_voci (ambiente_id, voce_id, quantita)
select a.id, v.id, x.quantita
from (values
  ('elettrico', 'Cucina', 'Punto luce', 2),
  ('elettrico', 'Cucina', 'Interruttore', 1),
  ('elettrico', 'Cucina', 'Deviatore', 2),
  ('elettrico', 'Cucina', 'Presa 10A', 2),
  ('elettrico', 'Cucina', 'Presa 16A / bipasso', 4),
  ('elettrico', 'Cucina', 'Presa Schuko', 2),
  ('elettrico', 'Cucina', 'Presa TV', 1),
  ('elettrico', 'Cucina', 'Linea dedicata (forno, piano cottura, lavatrice)', 2),
  ('elettrico', 'Cucina', 'Punto aspiratore', 1),
  ('elettrico', 'Camera', 'Punto luce', 1),
  ('elettrico', 'Camera', 'Interruttore', 3),
  ('elettrico', 'Camera', 'Deviatore', 1),
  ('elettrico', 'Camera', 'Presa 10A', 2),
  ('elettrico', 'Camera', 'Presa 16A / bipasso', 2),
  ('elettrico', 'Camera', 'Presa TV', 1),
  ('elettrico', 'Soggiorno', 'Punto luce', 2),
  ('elettrico', 'Soggiorno', 'Interruttore', 2),
  ('elettrico', 'Soggiorno', 'Deviatore', 2),
  ('elettrico', 'Soggiorno', 'Presa 10A', 3),
  ('elettrico', 'Soggiorno', 'Presa 16A / bipasso', 3),
  ('elettrico', 'Soggiorno', 'Presa TV', 1),
  ('elettrico', 'Soggiorno', 'Presa SAT', 1),
  ('elettrico', 'Soggiorno', 'Presa dati RJ45', 1),
  ('elettrico', 'Soggiorno', 'Punto termostato', 1),
  ('elettrico', 'Bagno', 'Punto luce', 2),
  ('elettrico', 'Bagno', 'Interruttore', 2),
  ('elettrico', 'Bagno', 'Presa 16A / bipasso', 2),
  ('elettrico', 'Bagno', 'Linea dedicata (forno, piano cottura, lavatrice)', 1),
  ('elettrico', 'Bagno', 'Punto aspiratore', 1),
  ('elettrico', 'Corridoio / ingresso', 'Punto luce', 2),
  ('elettrico', 'Corridoio / ingresso', 'Deviatore', 2),
  ('elettrico', 'Corridoio / ingresso', 'Invertitore', 1),
  ('elettrico', 'Corridoio / ingresso', 'Presa 16A / bipasso', 1),
  ('elettrico', 'Corridoio / ingresso', 'Lampada di emergenza', 1),
  ('elettrico', 'Corridoio / ingresso', 'Punto campanello', 1),
  ('elettrico', 'Esterno', 'Punto luce', 2),
  ('elettrico', 'Esterno', 'Interruttore', 1),
  ('elettrico', 'Esterno', 'Presa Schuko', 1),
  ('elettrico', 'Quadro elettrico', 'Quadro elettrico', 1),
  ('idraulico', 'Bagno', 'Punto acqua lavabo', 1),
  ('idraulico', 'Bagno', 'Punto WC', 1),
  ('idraulico', 'Bagno', 'Punto bidet', 1),
  ('idraulico', 'Bagno', 'Punto doccia', 1),
  ('idraulico', 'Bagno', 'Collettore', 1),
  ('idraulico', 'Cucina', 'Punto lavello cucina', 1),
  ('idraulico', 'Cucina', 'Punto lavastoviglie', 1),
  ('idraulico', 'Lavanderia', 'Punto lavatrice', 1),
  ('idraulico', 'Lavanderia', 'Punto acqua lavabo', 1),
  ('idraulico', 'Esterno', 'Rubinetto esterno', 1),
  ('idraulico', 'Caldaia', 'Allaccio caldaia', 1)
) as x(tipo, ambiente, voce, quantita)
join public.ambienti_tipo a on a.tipo = x.tipo and a.nome = x.ambiente
join public.voci_impianto v on v.tipo = x.tipo and v.nome = x.voce
on conflict do nothing;

notify pgrst, 'reload schema';
