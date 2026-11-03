-- Permesso WhatsApp degli utenti standard (gli admin lo hanno sempre)
alter table public.profili add column if not exists whatsapp boolean not null default false;
