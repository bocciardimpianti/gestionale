-- =====================================================================
-- Preventivo impaginato (Preventivi → 📄 Impaginato): testo, soluzioni e totali scritti nel gestionale
-- e stampati come il modello Word della ditta. Il piè di pagina è in "impostazioni" (chiave preventivo_piede).
-- Si può eseguire anche più volte.
-- =====================================================================
alter table public.preventivi add column if not exists impaginato jsonb;
notify pgrst, 'reload schema';
