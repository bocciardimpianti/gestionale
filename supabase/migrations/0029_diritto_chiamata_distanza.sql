-- =====================================================================
-- Diritto di chiamata in base alla distanza del cliente dalla sede (in linea d'aria)
-- - clienti: posizione (latitudine/longitudine) ricavata dall'indirizzo con OpenStreetMap
-- - fasce_chiamata: "fino a X km → importo", decise dall'admin (sezione Diritto di chiamata)
-- - impostazioni: posizione della sede
-- Si può eseguire anche più volte.
-- =====================================================================
alter table public.clienti
  add column if not exists lat double precision,
  add column if not exists lon double precision,
  add column if not exists geo_indirizzo text,      -- indirizzo da cui è stata ricavata la posizione
  add column if not exists geo_precisione text;     -- 'indirizzo', 'comune' oppure 'non trovato'

create table if not exists public.fasce_chiamata (
  km_fino  int primary key check (km_fino > 0),
  importo  numeric(10,2) not null default 0
);
alter table public.fasce_chiamata enable row level security;
drop policy if exists fasce_chiamata_lettura on public.fasce_chiamata;
create policy fasce_chiamata_lettura on public.fasce_chiamata for select using (public.mfa_ok());
drop policy if exists fasce_chiamata_admin on public.fasce_chiamata;
create policy fasce_chiamata_admin on public.fasce_chiamata for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.impostazioni (
  chiave  text primary key,
  valore  jsonb
);
alter table public.impostazioni enable row level security;
drop policy if exists impostazioni_lettura on public.impostazioni;
create policy impostazioni_lettura on public.impostazioni for select using (public.mfa_ok());
drop policy if exists impostazioni_admin on public.impostazioni;
create policy impostazioni_admin on public.impostazioni for all using (public.is_admin()) with check (public.is_admin());

-- Posizione trovata per un cliente: la salva anche chi compila il rapportino senza poter modificare i clienti
create or replace function public.salva_posizione_cliente(p_id bigint, p_lat double precision, p_lon double precision, p_indirizzo text, p_precisione text)
returns void language sql security definer set search_path = public as $$
  update clienti set lat = p_lat, lon = p_lon, geo_indirizzo = p_indirizzo, geo_precisione = p_precisione
  where id = p_id and (public.puo('clienti', 'modificare') or public.puo('rapporti', 'creare') or public.puo('rapporti', 'modificare'));
$$;
grant execute on function public.salva_posizione_cliente(bigint, double precision, double precision, text, text) to authenticated;

notify pgrst, 'reload schema';
