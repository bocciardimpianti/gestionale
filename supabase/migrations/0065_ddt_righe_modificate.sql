-- DDT di acquisto: riga a cui è stato cambiato il materiale dopo l'importazione (abbinamento sbagliato).
-- modifica = cosa c'era prima; la riga si vede evidenziata nel DDT e nella scheda del materiale (Acquisti).
alter table public.righe_ddt_acquisto add column if not exists modificata_il timestamptz;
alter table public.righe_ddt_acquisto add column if not exists modifica text;
notify pgrst, 'reload schema';
