-- Menu DOCUMENTI: "Preventivi fornitori" (offerte mandate per mail dai fornitori, per fornitore) e
-- "Progetti e documenti" (progetti, schede, brochure, per argomento). Stessi file di progetti_file.
insert into public.sezioni (chiave, etichetta, gruppo, ordine) values
  ('preventivi_fornitori', 'Preventivi fornitori', 'DOCUMENTI', 112),
  ('progetti_documenti', 'Progetti e documenti', 'DOCUMENTI', 113)
on conflict (chiave) do nothing;
