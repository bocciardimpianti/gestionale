-- Preventivo guidato elettrico: serie civile (BTicino Matix Go, Vimar Linea, Living Now…)
-- e scatole per ambiente, per calcolare da soli supporti, placche e copriforo.
-- Da eseguire dopo 0031_preventivo_guidato.sql. Si può rieseguire.

create table if not exists public.serie_civili (
  id bigint generated always as identity primary key,
  nome text not null unique,
  prezzo_supporto_3 numeric not null default 0,
  prezzo_supporto_4 numeric not null default 0,
  prezzo_placca_3 numeric not null default 0,
  prezzo_placca_4 numeric not null default 0,
  prezzo_copriforo numeric not null default 0,
  ordine int not null default 0,
  attiva boolean not null default true
);

-- Quanti moduli occupa ogni voce nella scatola (presa Schuko 2, interruttore 1, punto luce 0…)
alter table public.voci_impianto add column if not exists moduli numeric not null default 0;
-- Scatole di partenza per ogni ambiente tipo (3 moduli = 503, 4 moduli = 504)
alter table public.ambienti_tipo add column if not exists scatole_3 int not null default 0;
alter table public.ambienti_tipo add column if not exists scatole_4 int not null default 0;

alter table public.serie_civili enable row level security;
drop policy if exists serie_civili_lettura on public.serie_civili;
create policy serie_civili_lettura on public.serie_civili for select using (public.puo('preventivi', 'vedere'));
drop policy if exists serie_civili_admin on public.serie_civili;
create policy serie_civili_admin on public.serie_civili for all using (public.is_admin()) with check (public.is_admin());

-- Prezzi di partenza INDICATIVI: da controllare in "Impianti tipo"
insert into public.serie_civili (nome, prezzo_supporto_3, prezzo_supporto_4, prezzo_placca_3, prezzo_placca_4, prezzo_copriforo, ordine) values
  ('BTicino Matix Go', 1.5, 2, 3, 4, 1, 10),
  ('BTicino Matix', 1.8, 2.3, 3.5, 4.5, 1.2, 20),
  ('BTicino Living Now', 3, 3.8, 9, 11, 2.5, 30),
  ('BTicino Axolute', 4, 5, 18, 22, 3.5, 40),
  ('Vimar Plana', 1.8, 2.3, 3.5, 4.5, 1.2, 50),
  ('Vimar Arké', 2.2, 2.8, 5, 6.5, 1.5, 60),
  ('Vimar Linea', 2.8, 3.5, 8, 10, 2.2, 70),
  ('Vimar Eikon', 3.5, 4.5, 14, 17, 3, 80),
  ('Gewiss Chorus', 2.5, 3.2, 7, 9, 2, 90)
on conflict (nome) do nothing;

update public.voci_impianto v set moduli = x.moduli
from (values
  ('Interruttore', 1), ('Deviatore', 1), ('Invertitore', 1), ('Pulsante', 1),
  ('Presa 10A', 1), ('Presa 16A / bipasso', 1), ('Presa Schuko', 2), ('Presa TV', 1), ('Presa SAT', 1),
  ('Presa dati RJ45', 1), ('Presa telefono', 1), ('Punto termostato', 2), ('Punto campanello', 1)
) as x(nome, moduli)
where v.tipo = 'elettrico' and v.nome = x.nome and v.moduli = 0;

update public.ambienti_tipo a set scatole_3 = x.s3, scatole_4 = x.s4
from (values
  ('Cucina', 4, 1), ('Camera', 5, 0), ('Soggiorno', 5, 1), ('Bagno', 2, 0),
  ('Corridoio / ingresso', 2, 0), ('Esterno', 1, 0)
) as x(nome, s3, s4)
where a.tipo = 'elettrico' and a.nome = x.nome and a.scatole_3 = 0 and a.scatole_4 = 0;

notify pgrst, 'reload schema';
