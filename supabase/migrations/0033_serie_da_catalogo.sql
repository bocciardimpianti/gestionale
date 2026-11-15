-- Serie civili collegate ai materiali del catalogo: supporti, placche e copriforo prendono
-- il prezzo di vendita (prezzo_ricaricato) del materiale. Se non c'è il materiale vale il prezzo scritto a mano.
-- Da eseguire dopo 0032_serie_civili.sql. Si può rieseguire (non tocca i collegamenti già fatti).

alter table public.serie_civili add column if not exists mat_supporto_3 bigint references public.materiali(id) on delete set null;
alter table public.serie_civili add column if not exists mat_supporto_4 bigint references public.materiali(id) on delete set null;
alter table public.serie_civili add column if not exists mat_placca_3 bigint references public.materiali(id) on delete set null;
alter table public.serie_civili add column if not exists mat_placca_4 bigint references public.materiali(id) on delete set null;
alter table public.serie_civili add column if not exists mat_copriforo bigint references public.materiali(id) on delete set null;

-- Collegamento automatico cercando nella descrizione: serie + componente + numero di moduli.
-- Tra più materiali buoni preferisce il bianco e poi il più economico.
do $$
declare
  s record;
  c record;
  scelto bigint;
begin
  for s in select * from (values
    ('BTicino Matix Go', 'matix ?go', null),
    ('BTicino Matix', 'matix', 'matix ?go'),
    ('BTicino Living Now', 'living ?now', null),
    ('BTicino Axolute', 'axolute', null),
    ('Vimar Plana', 'plana', 'eikon|ark'),
    ('Vimar Arké', 'ark[eéè]', 'eikon|plana'),
    ('Vimar Linea', '^vim.*\ylinea\y', null),
    ('Vimar Eikon', 'eikon', 'plana|ark'),
    ('Gewiss Chorus', 'chorus', null)
  ) as x(nome, re_serie, re_escludi) loop
    for c in select * from (values
      ('mat_supporto_3', 'supporto|telaio', '\y3 ?(p|mod|moduli|posti|m)\y|\y3p\y', 'placca|cornice'),
      ('mat_supporto_4', 'supporto|telaio', '\y4 ?(p|mod|moduli|posti|m)\y|\y4p\y', 'placca|cornice'),
      ('mat_placca_3', 'placca', '\y3 ?(p|mod|moduli|posti|m)\y|\y3p\y', null),
      ('mat_placca_4', 'placca', '\y4 ?(p|mod|moduli|posti|m)\y|\y4p\y', null),
      ('mat_copriforo', 'copriforo|copri ?foro|falso polo', null, null)
    ) as y(colonna, re_cosa, re_moduli, re_no) loop
      select m.id into scelto
      from public.materiali m
      where m.eliminato_il is null and m.prezzo_ricaricato > 0
        and m.descrizione ~* s.re_serie
        and (s.re_escludi is null or m.descrizione !~* s.re_escludi)
        and m.descrizione ~* c.re_cosa
        and (c.re_moduli is null or m.descrizione ~* c.re_moduli)
        and (c.re_no is null or m.descrizione !~* c.re_no)
      order by (m.descrizione ~* 'bianc') desc, m.prezzo_ricaricato, m.id
      limit 1;
      if scelto is not null then
        execute format('update public.serie_civili set %I = $1 where nome = $2 and %I is null', c.colonna, c.colonna) using scelto, s.nome;
      end if;
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';
