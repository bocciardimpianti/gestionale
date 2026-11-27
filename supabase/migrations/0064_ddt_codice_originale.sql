-- DDT di acquisto: codice e descrizione della riga come scritti dal fornitore, salvati anche quando la riga
-- viene abbinata a un materiale già in magazzino (simile). Si vedono nella scheda del materiale → "Acquisti (DDT)".
alter table public.righe_ddt_acquisto add column if not exists codice_originale text;
alter table public.righe_ddt_acquisto add column if not exists descrizione_originale text;
create index if not exists righe_ddt_acquisto_materiale_idx on public.righe_ddt_acquisto (materiale_id);
notify pgrst, 'reload schema';
