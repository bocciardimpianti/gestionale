-- Codice destinatario SDI (fatturazione elettronica) dei clienti. Si può eseguire anche più volte.
alter table public.clienti add column if not exists codice_sdi text;
