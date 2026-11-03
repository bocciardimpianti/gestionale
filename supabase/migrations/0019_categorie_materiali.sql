-- Macro categorie dei materiali
alter table public.materiali add column if not exists categoria text;
create index if not exists materiali_categoria_idx on public.materiali (categoria);
