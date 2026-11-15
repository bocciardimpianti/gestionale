-- =====================================================================
-- DDT di acquisto: tecnico che ha ordinato/ritirato il materiale.
-- Tecnici: "altri nomi" con cui compaiono sui DDT dei fornitori (es. Michael = "Maicol").
-- Si può eseguire anche più volte.
-- =====================================================================
alter table public.ddt_acquisto add column if not exists tecnico_id bigint references public.tecnici(id) on delete set null;
create index if not exists ddt_acquisto_tecnico_idx on public.ddt_acquisto (tecnico_id);

alter table public.tecnici add column if not exists altri_nomi text;
update public.tecnici set altri_nomi = 'Maicol' where altri_nomi is null and nome ilike '%michael%';
