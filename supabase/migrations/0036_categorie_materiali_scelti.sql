-- Categorie dei lavori ("Cosa facciamo?"): oltre alla ricerca per parole, materiali scelti uno per uno dal catalogo.
-- Una categoria può avere solo i materiali scelti (ricerca vuota), solo la ricerca, o tutte e due.
-- Da eseguire dopo 0034. Si può rieseguire.

alter table public.lavori_categorie alter column cerca drop not null;

create table if not exists public.lavori_categorie_materiali (
  categoria_id bigint not null references public.lavori_categorie(id) on delete cascade,
  materiale_id bigint not null references public.materiali(id) on delete cascade,
  ordine int not null default 0,
  primary key (categoria_id, materiale_id)
);

alter table public.lavori_categorie_materiali enable row level security;
drop policy if exists lavori_categorie_materiali_lettura on public.lavori_categorie_materiali;
create policy lavori_categorie_materiali_lettura on public.lavori_categorie_materiali for select using (public.puo('preventivi', 'vedere'));
drop policy if exists lavori_categorie_materiali_admin on public.lavori_categorie_materiali;
create policy lavori_categorie_materiali_admin on public.lavori_categorie_materiali for all using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
