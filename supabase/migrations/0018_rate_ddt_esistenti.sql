-- =====================================================================
-- Rate per i DDT inseriti nel gestionale (a mano o da PDF) prima dello scadenziario:
-- si creano solo per i DDT che non hanno nessuna rata, con la stessa regola automatica
-- (data del DDT + giorni della tipologia, a fine mese; totale diviso in parti uguali).
-- I DDT importati da ReportOne non vengono toccati (hanno le rate di ReportOne).
-- =====================================================================

insert into public.scadenziario (data, nominativo, fornitore_id, descrizione, importo, ddt_id, rata)
select
  (date_trunc('month', d.data + g.giorni) + interval '1 month - 1 day')::date,
  f.nome, d.fornitore_id,
  'DDT di Acquisto N. ' || coalesce(d.numero_ddt, '') || ' del ' || to_char(d.data, 'DD/MM/YYYY'),
  case when g.ord = g.n then d.totale - round(d.totale / g.n, 2) * (g.n - 1) else round(d.totale / g.n, 2) end,
  d.id, g.ord
from public.ddt_acquisto d
left join public.fornitori f on f.id = d.fornitore_id
cross join lateral (
  select m[1]::int as giorni, ord::int as ord, count(*) over ()::int as n
  from regexp_matches(d.tipologia_pagamento, '(\d+)', 'g') with ordinality as t(m, ord)
) g
where d.gguid_reportone is null
  and d.eliminato_il is null
  and coalesce(d.totale, 0) <> 0
  and not exists (select 1 from public.scadenziario s where s.ddt_id = d.id);
