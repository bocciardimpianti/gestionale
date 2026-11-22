-- =====================================================================
-- Preventivo guidato elettrico: il Quadro elettrico diventa una "stanza" come le altre.
-- - voci del quadro con nomi brevi (Hager C6 … C25, differenziali puri 0,03 / 0,3, relè passo passo),
--   ognuna con i moduli che occupa e il materiale del catalogo (kit) che ne dà il prezzo
-- - contenitori (centralini da incasso o esterni) per numero di moduli: il foglio sceglie da solo il più piccolo
--   che lascia almeno il 40% di spazio libero
-- Le voci e i contenitori si controllano in Impianti tipo. Si può eseguire anche più volte.
-- =====================================================================
alter table public.voci_impianto add column if not exists quadro boolean not null default false;
alter table public.ambienti_tipo add column if not exists quadro boolean not null default false;
update public.ambienti_tipo set quadro = true where tipo = 'elettrico' and nome ilike 'quadro%';

-- Voci del quadro (moduli DIN occupati)
insert into public.voci_impianto (tipo, nome, unita, ordine, moduli, quadro) values
  ('elettrico', 'Hager C6', 'pz', 300, 1, true),
  ('elettrico', 'Hager C10', 'pz', 310, 1, true),
  ('elettrico', 'Hager C16', 'pz', 320, 1, true),
  ('elettrico', 'Hager C20', 'pz', 330, 1, true),
  ('elettrico', 'Hager C25', 'pz', 340, 1, true),
  ('elettrico', 'Differenziale puro Hager 0,03', 'pz', 350, 2, true),
  ('elettrico', 'Differenziale puro Hager 0,3', 'pz', 360, 2, true),
  ('elettrico', 'Relè passo passo 230V', 'pz', 370, 1, true)
on conflict (tipo, nome) do update set quadro = true;
-- La voce "Quadro elettrico" (montaggio a corpo) resta nella stanza del quadro
update public.voci_impianto set quadro = true where tipo = 'elettrico' and nome = 'Quadro elettrico';

-- Materiale del catalogo per ogni voce (il meno caro tra quelli che corrispondono), se non ha già un kit
with regole(nome, cerca, misura) as (values
  ('Hager C6',  '(hager|^hag\M).*magneto ?term|magneto ?term.*(hager|^hag\M)', '(\mc ?6 ?a?\M|\m6 ?a\M.*\mc\M|mf[ns]706)'),
  ('Hager C10', '(hager|^hag\M).*magneto ?term|magneto ?term.*(hager|^hag\M)', '(\mc ?10 ?a?\M|\m10 ?a\M.*\mc\M|mf[ns]710)'),
  ('Hager C16', '(hager|^hag\M).*magneto ?term|magneto ?term.*(hager|^hag\M)', '(\mc ?16 ?a?\M|\m16 ?a\M.*\mc\M|mf[ns]716)'),
  ('Hager C20', '(hager|^hag\M).*magneto ?term|magneto ?term.*(hager|^hag\M)', '(\mc ?20 ?a?\M|\m20 ?a\M.*\mc\M|mf[ns]720)'),
  ('Hager C25', '(hager|^hag\M).*magneto ?term|magneto ?term.*(hager|^hag\M)', '(\mc ?25 ?a?\M|\m25 ?a\M.*\mc\M|mf[ns]725)'),
  ('Differenziale puro Hager 0,03', '(hager|^hag\M).*differenz', '(0[,.]03(?!\d)|\m30 ?ma)'),
  ('Differenziale puro Hager 0,3', '(hager|^hag\M).*differenz', '(0[,.]3(?!\d)|\m300 ?ma)'),
  ('Relè passo passo 230V', '(rel[eèé'']|relais|telerutt).*passo ?passo|passo ?passo.*(rel[eèé'']|relais)', '.')
), scelti as (
  select distinct on (v.id) v.id as voce_id, m.id as materiale_id
  from regole r
  join public.voci_impianto v on v.tipo = 'elettrico' and v.nome = r.nome
  join public.materiali m on m.eliminato_il is null and m.descrizione ~* r.cerca and m.descrizione ~* r.misura
  where not exists (select 1 from public.voci_impianto_kit k where k.voce_id = v.id)
    and m.descrizione !~* case when r.nome like 'Hager C%' then 'differenz|\m[234] ?p\M|\m[234] ?(mod|moduli|m)\M|blocco|ausiliar|bobina'
                              when r.nome like 'Differenziale%' then 'magneto ?term|blocco|ausiliar|bobina'
                              else '\m(12|24|48) ?v\M|ricambio|zoccolo' end
  order by v.id, (m.descrizione ~* 'hager') desc, m.prezzo_ricaricato
)
insert into public.voci_impianto_kit (voce_id, materiale_id, quantita)
select voce_id, materiale_id, 1 from scelti;

-- Stanza "Quadro elettrico": le voci del quadro (quelle a 0 si aumentano con +)
insert into public.ambienti_tipo_voci (ambiente_id, voce_id, quantita)
select a.id, v.id, x.q from (values
  ('Hager C6', 0), ('Hager C10', 2), ('Hager C16', 3), ('Hager C20', 0), ('Hager C25', 0),
  ('Differenziale puro Hager 0,03', 1), ('Differenziale puro Hager 0,3', 0), ('Relè passo passo 230V', 0)
) as x(nome, q)
join public.voci_impianto v on v.tipo = 'elettrico' and v.nome = x.nome
join public.ambienti_tipo a on a.tipo = 'elettrico' and a.quadro
where not exists (select 1 from public.ambienti_tipo_voci t where t.ambiente_id = a.id and t.voce_id = v.id);

-- Contenitori del quadro (centralini) per numero di moduli
create table if not exists public.quadri_contenitori (
  id           bigint generated always as identity primary key,
  tipo         text not null check (tipo in ('incasso', 'esterno')),
  moduli       int not null check (moduli > 0),
  nome         text not null,
  materiale_id bigint references public.materiali(id) on delete set null,
  prezzo       numeric(12,2),                  -- se non c'è il materiale collegato
  attivo       boolean not null default true,
  unique (tipo, moduli)
);
alter table public.quadri_contenitori enable row level security;
drop policy if exists quadri_contenitori_lettura on public.quadri_contenitori;
create policy quadri_contenitori_lettura on public.quadri_contenitori for select using (public.puo('preventivi', 'vedere'));
drop policy if exists quadri_contenitori_admin on public.quadri_contenitori;
create policy quadri_contenitori_admin on public.quadri_contenitori for all using (public.is_admin()) with check (public.is_admin());

insert into public.quadri_contenitori (tipo, moduli, nome) values
  ('incasso', 4, 'Centralino da incasso 4 moduli'), ('incasso', 8, 'Centralino da incasso 8 moduli'),
  ('incasso', 12, 'Centralino da incasso 12 moduli'), ('incasso', 18, 'Centralino da incasso 18 moduli'),
  ('incasso', 24, 'Centralino da incasso 24 moduli'), ('incasso', 36, 'Centralino da incasso 36 moduli'),
  ('incasso', 54, 'Centralino da incasso 54 moduli'), ('incasso', 72, 'Centralino da incasso 72 moduli'),
  ('esterno', 4, 'Centralino da parete 4 moduli'), ('esterno', 8, 'Centralino da parete 8 moduli'),
  ('esterno', 12, 'Centralino da parete 12 moduli'), ('esterno', 18, 'Centralino da parete 18 moduli'),
  ('esterno', 24, 'Centralino da parete 24 moduli'), ('esterno', 36, 'Centralino da parete 36 moduli'),
  ('esterno', 54, 'Centralino da parete 54 moduli'), ('esterno', 72, 'Centralino da parete 72 moduli')
on conflict (tipo, moduli) do nothing;

-- Collegamento automatico al catalogo (centralini/quadri con il numero di moduli; per l'incasso "incasso", per l'esterno "parete/esterno")
update public.quadri_contenitori q set materiale_id = (
  select m.id from public.materiali m
  where m.eliminato_il is null
    and m.descrizione ~* '(centralin|quadr|contenitor|armadi|volta|golf|vega)'
    and m.descrizione ~* ('(\m' || q.moduli || ' ?(m|mod|moduli|din)\M|\m' || q.moduli || 'm\M)')
    and (case when q.tipo = 'incasso' then m.descrizione ~* 'incass|\mvolta\M' else m.descrizione ~* 'parete|ester|\mgolf\M|\mvega\M' and m.descrizione !~* 'incass' end)
    and m.descrizione !~* 'porta|telaio|cornice|ricambio|separator|barra|morsett|pannell|guida'
  order by (m.descrizione ~* 'hager') desc, m.prezzo_ricaricato
  limit 1)
where q.materiale_id is null;

notify pgrst, 'reload schema';
