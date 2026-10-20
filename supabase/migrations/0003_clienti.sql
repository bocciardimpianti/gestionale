-- =====================================================================
-- Clienti + archivio Tipologie di pagamento
-- =====================================================================

create table public.tipologie_pagamento (
  nome    text primary key,
  ordine  int not null default 0
);

insert into public.tipologie_pagamento (nome, ordine) values
  ('7 GG', 5), ('14 GG', 10), ('30 GG', 20), ('30-60 GG', 30), ('30-60-90 GG', 40),
  ('30-60-90-120 GG', 50), ('60 GG', 60), ('60-90-120 GG', 70);

create table public.clienti (
  id                      bigint generated always as identity primary key,
  nome                    text not null,
  codice_fiscale          text,
  email                   text,
  indirizzo_fatturazione  text,
  nome_contatto           text,
  telefono                text,
  cellulare               text,
  piva                    text,
  note                    text,
  tipologia_pagamento     text references public.tipologie_pagamento(nome) on update cascade on delete set null,
  creato_il               timestamptz not null default now(),
  modificato_il           timestamptz not null default now()
);

create index clienti_nome_idx on public.clienti (lower(nome));

create or replace function public.aggiorna_modificato_il() returns trigger
language plpgsql as $$
begin
  new.modificato_il := now();
  return new;
end $$;

create trigger clienti_modificato_il
  before update on public.clienti
  for each row execute function public.aggiorna_modificato_il();

alter table public.clienti enable row level security;
alter table public.tipologie_pagamento enable row level security;

create policy clienti_vedere     on public.clienti for select using (public.puo('clienti', 'vedere'));
create policy clienti_creare     on public.clienti for insert with check (public.puo('clienti', 'creare'));
create policy clienti_modificare on public.clienti for update using (public.puo('clienti', 'modificare')) with check (public.puo('clienti', 'modificare'));
create policy clienti_eliminare  on public.clienti for delete using (public.puo('clienti', 'eliminare'));

-- Gli archivi li leggono tutti gli utenti verificati, li modifica solo l'admin
create policy tipologie_lettura on public.tipologie_pagamento for select using (public.mfa_ok());
create policy tipologie_admin   on public.tipologie_pagamento for all using (public.is_admin()) with check (public.is_admin());
