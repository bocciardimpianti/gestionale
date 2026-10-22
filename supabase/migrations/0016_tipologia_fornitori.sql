-- =====================================================================
-- Tipologia di pagamento dei fornitori: l'export Excel non la conteneva.
-- Si prende quella dell'ultimo DDT di acquisto di ogni fornitore (solo dove è vuota).
-- Le tipologie usate nei DDT e mancanti nell'elenco vengono aggiunte all'elenco.
-- =====================================================================

insert into public.tipologie_pagamento (nome, ordine)
select distinct d.tipologia_pagamento, 100
from public.ddt_acquisto d
where d.tipologia_pagamento is not null and btrim(d.tipologia_pagamento) <> ''
on conflict (nome) do nothing;

update public.fornitori f
set tipologia_pagamento = u.tipologia_pagamento
from (
  select distinct on (fornitore_id) fornitore_id, tipologia_pagamento
  from public.ddt_acquisto
  where fornitore_id is not null and tipologia_pagamento is not null and btrim(tipologia_pagamento) <> '' and eliminato_il is null
  order by fornitore_id, data desc, id desc
) u
where u.fornitore_id = f.id and (f.tipologia_pagamento is null or btrim(f.tipologia_pagamento) = '');
