-- =====================================================================
-- Scadenziario (rate da pagare, generate dai DDT di acquisto)
-- - Un nuovo DDT con tipologia di pagamento (es. "60-90-120 GG") genera le rate:
--   scadenza = data del DDT + giorni, a fine mese; importo = totale diviso in parti uguali
--   (i centesimi di resto sull'ultima rata).
-- - Se cambiano data, totale, tipologia o fornitore le rate si rigenerano, ma solo se nessuna è già pagata.
-- - I DDT importati da ReportOne non generano rate: si importano quelle di ReportOne.
-- - Il DDT risulta "Pagato" quando tutte le sue rate sono pagate.
-- =====================================================================

create table public.scadenziario (
  id               bigint generated always as identity primary key,
  data             date not null,
  nominativo       text,
  fornitore_id     bigint references public.fornitori(id) on delete set null,
  descrizione      text,
  importo          numeric(12,2) not null default 0,
  pagato           boolean not null default false,
  ddt_id           bigint references public.ddt_acquisto(id) on delete cascade,
  rata             int,
  gguid_reportone  text unique,
  archivio_id      bigint references public.archivi(id) on delete set null,
  eliminato_il     timestamptz,
  creato_il        timestamptz not null default now(),
  modificato_il    timestamptz not null default now()
);

create index scadenziario_data_idx on public.scadenziario (data);
create index scadenziario_ddt_idx on public.scadenziario (ddt_id);

create trigger scadenziario_modificato_il
  before update on public.scadenziario
  for each row execute function public.aggiorna_modificato_il();

-- Cestino: permesso "eliminare" dello scadenziario, oppure dei DDT (le rate seguono il loro DDT nel cestino)
create or replace function public.controlla_cestino_scadenziario() returns trigger
language plpgsql as $$
begin
  if new.eliminato_il is distinct from old.eliminato_il
     and not (public.puo('scadenziario', 'eliminare') or (new.ddt_id is not null and public.puo('ddt_acquisto', 'eliminare'))) then
    raise exception 'Non hai il permesso di eliminare in questa sezione';
  end if;
  return new;
end $$;

create trigger scadenziario_cestino
  before update on public.scadenziario
  for each row execute function public.controlla_cestino_scadenziario();

alter table public.scadenziario enable row level security;
create policy scadenziario_vedere     on public.scadenziario for select using (public.puo('scadenziario', 'vedere') or public.puo('ddt_acquisto', 'vedere'));
create policy scadenziario_creare     on public.scadenziario for insert with check (public.puo('scadenziario', 'creare'));
create policy scadenziario_modificare on public.scadenziario for update using (public.puo('scadenziario', 'modificare')) with check (public.puo('scadenziario', 'modificare'));
create policy scadenziario_eliminare  on public.scadenziario for delete using (public.puo('scadenziario', 'eliminare'));

-- Rate di un DDT dalla tipologia di pagamento
create or replace function public.genera_scadenze_ddt() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  giorni int[];
  n int;
  i int;
  quota numeric(12,2);
  resto numeric(12,2);
  nome text;
begin
  -- DDT spostato nel cestino o ripristinato: le sue rate lo seguono
  if tg_op = 'UPDATE' and new.eliminato_il is distinct from old.eliminato_il then
    update scadenziario set eliminato_il = new.eliminato_il where ddt_id = new.id;
    return null;
  end if;
  if new.gguid_reportone is not null or new.eliminato_il is not null then return null; end if;
  if tg_op = 'UPDATE' then
    if new.data is not distinct from old.data and new.totale is not distinct from old.totale
       and new.tipologia_pagamento is not distinct from old.tipologia_pagamento
       and new.fornitore_id is not distinct from old.fornitore_id
       and new.numero_ddt is not distinct from old.numero_ddt then
      return null;
    end if;
    -- Rate già pagate: non si tocca nulla
    if exists (select 1 from scadenziario where ddt_id = new.id and pagato) then return null; end if;
    delete from scadenziario where ddt_id = new.id;
  end if;
  select array_agg(m[1]::int order by ord) into giorni
  from regexp_matches(coalesce(new.tipologia_pagamento, ''), '(\d+)', 'g') with ordinality as t(m, ord);
  n := coalesce(array_length(giorni, 1), 0);
  if n = 0 or coalesce(new.totale, 0) = 0 then return null; end if;
  select f.nome into nome from fornitori f where f.id = new.fornitore_id;
  quota := round(new.totale / n, 2);
  resto := new.totale - quota * (n - 1);
  for i in 1..n loop
    insert into scadenziario (data, nominativo, fornitore_id, descrizione, importo, ddt_id, rata)
    values (
      (date_trunc('month', new.data + giorni[i]) + interval '1 month - 1 day')::date,
      nome, new.fornitore_id,
      'DDT di Acquisto N. ' || coalesce(new.numero_ddt, '') || ' del ' || to_char(new.data, 'DD/MM/YYYY'),
      case when i = n then resto else quota end,
      new.id, i
    );
  end loop;
  return null;
end $$;

create trigger ddt_acquisto_scadenze
  after insert or update on public.ddt_acquisto
  for each row execute function public.genera_scadenze_ddt();

-- DDT pagato quando tutte le sue rate sono pagate
create or replace function public.aggiorna_pagato_ddt() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ddt bigint := coalesce(new.ddt_id, old.ddt_id);
begin
  if ddt is null then return null; end if;
  update ddt_acquisto d
     set pagato = not exists (select 1 from scadenziario s where s.ddt_id = ddt and not s.pagato and s.eliminato_il is null)
   where d.id = ddt
     and exists (select 1 from scadenziario s where s.ddt_id = ddt and s.eliminato_il is null);
  return null;
end $$;

create trigger scadenziario_pagato_ddt
  after insert or update of pagato, eliminato_il or delete on public.scadenziario
  for each row execute function public.aggiorna_pagato_ddt();
