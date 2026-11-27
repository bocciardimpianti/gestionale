-- Progetti e preventivi arrivati per e-mail: la mail da cui vengono (mittente, destinatari, data, oggetto, testo,
-- allegati), salvata dallo script di Gmail accanto al file e portata qui dalla funzione ddt-drive.
-- Nella scheda del cliente: pulsanti "Testo della mail" e "Mail completa" accanto al file.
alter table public.progetti_file add column if not exists mail jsonb;
notify pgrst, 'reload schema';
