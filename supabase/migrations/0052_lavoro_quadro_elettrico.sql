-- =====================================================================
-- Preventivo guidato elettrico: lavoro "Quadro elettrico" con i materiali del catalogo da proporre:
-- magnetotermici Hager 1 modulo (C6, C10, C16, C20, C25), differenziali puri Hager (0,03 / 0,3 A)
-- e relè passo passo 230 V. Si apre premendo "Quadro elettrico" nel foglio.
-- Le parole di ricerca si cambiano in Impianti tipo → Lavori. Si può eseguire anche più volte.
-- =====================================================================
insert into public.lavori_preventivo (tipo, nome, icona, ordine) values ('elettrico', 'Quadro elettrico', '🔌', 10)
on conflict (tipo, nome) do nothing;

insert into public.lavori_categorie (lavoro_id, nome, cerca, escludi, principale, segue_marca, ordine)
select l.id, x.nome, x.cerca, x.escludi, x.principale, x.segue_marca, x.ordine from (values
  ('Magnetotermici Hager 1 modulo (C6 C10 C16 C20 C25)',
   '^(?=.*\b(hager|hag)\b)(?=.*magneto ?term)(?=.*(\bc ?(6|10|16|20|25) ?a?\b|\b(6|10|16|20|25) ?a\b.*\b(curva )?c\b|\bmf[ns]7(06|10|16|20|25)\b))',
   'differenz|\b[234] ?p\b|\b[234] ?(mod|moduli|m)\b|blocco|ausiliar|bobina|sganciator|contatto',
   true, false, 10),
  ('Differenziali puri Hager 0,03 / 0,3',
   '^(?=.*\b(hager|hag)\b)(?=.*differenz)(?=.*(0[,.]03(?!\d)|0[,.]3(?!\d)|\b30 ?ma|\b300 ?ma))',
   'magneto ?term|blocco|ausiliar|bobina|rel[eè]\b|relè',
   false, true, 20),
  ('Relè passo passo 230 V',
   '^(?=.*\b(rel[eèé'']|relais|telerutt))(?=.*passo ?passo)',
   '\b(12|24|48) ?v\b|\b(12|24) ?vac|\b(12|24) ?vdc|ricambio|zoccolo',
   false, true, 30)
) as x(nome, cerca, escludi, principale, segue_marca, ordine)
join public.lavori_preventivo l on l.tipo = 'elettrico' and l.nome = 'Quadro elettrico'
on conflict (lavoro_id, nome) do nothing;

notify pgrst, 'reload schema';
