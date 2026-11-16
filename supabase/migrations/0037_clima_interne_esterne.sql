-- Climatizzatore: la categoria "Climatizzatori" si divide in Unità interne, Unità esterne
-- e Climatizzatori completi (kit interna + esterna e monoblocchi).
-- I materiali già scelti a mano nella vecchia categoria vanno in quella giusta. Da eseguire dopo 0034 e 0036. Si può rieseguire.

do $$
declare
  lav bigint;
  interne bigint;
  esterne bigint;
  completi bigint;
  re_est text := 'unit[aà]''? esterna|macchina esterna|\bmuz-|\bsuz-|\bmxz-|\bpumy|\baoe[hg]|esterna.*(btu|kw|split|inverter|r32)';
  re_kit text := '(\bu\.?[ei]\.?|\bu[ei]) ?\+ ?(u\.?[ei]|unit)|mono ?split.*\+|esterna.*\+.*interna|ase[hg]\w*[-_]aoe[hg]|aoe[hg]\w*[-_]ase[hg]|climatizzatore.*monoblocc|climatizzatore (a pavimento|portatile)';
begin
  select id into lav from public.lavori_preventivo where tipo = 'idraulico' and nome = 'Climatizzatore';
  if lav is null then return; end if;

  -- La vecchia categoria diventa "Unità interne"
  update public.lavori_categorie set nome = 'Unità interne'
  where lavoro_id = lav and nome = 'Climatizzatori'
    and not exists (select 1 from public.lavori_categorie where lavoro_id = lav and nome = 'Unità interne');
  select id into interne from public.lavori_categorie where lavoro_id = lav and nome = 'Unità interne';
  if interne is null then
    insert into public.lavori_categorie (lavoro_id, nome, cerca, escludi, principale, segue_marca, ordine)
    values (lav, 'Unità interne', 'unit[aà]''? interna|\bmsz-|\bmfz-|\bsfz-|\bslz-|\bpead-|\basyg|\baseh|\bfxsq|cassetta 4 ?vie|interna.*(btu|kw|split|inverter)', 'tubo|rame|bombola|lavagg|staff|pompa condensa|kit spray|canalin|cover|telecomando|filtro|griglia|supporto|gruppo idraulico|sanicondens|scatola|predisposiz|\bbase\b|distributor|giunto|sonda|piedin|antivibrant|resistenza|giunzione|binario|miscelator|esterna|\bmuz|\bmxz|\bpumy|(\bu\.?[ei]\.?|\bu[ei]) ?\+ ?(u\.?[ei]|unit)|mono ?split.*\+|esterna.*\+.*interna|ase[hg]\w*[-_]aoe[hg]|aoe[hg]\w*[-_]ase[hg]|climatizzatore.*monoblocc|climatizzatore (a pavimento|portatile)', true, true, 10) returning id into interne;
  else
    update public.lavori_categorie set cerca = 'unit[aà]''? interna|\bmsz-|\bmfz-|\bsfz-|\bslz-|\bpead-|\basyg|\baseh|\bfxsq|cassetta 4 ?vie|interna.*(btu|kw|split|inverter)', escludi = 'tubo|rame|bombola|lavagg|staff|pompa condensa|kit spray|canalin|cover|telecomando|filtro|griglia|supporto|gruppo idraulico|sanicondens|scatola|predisposiz|\bbase\b|distributor|giunto|sonda|piedin|antivibrant|resistenza|giunzione|binario|miscelator|esterna|\bmuz|\bmxz|\bpumy|(\bu\.?[ei]\.?|\bu[ei]) ?\+ ?(u\.?[ei]|unit)|mono ?split.*\+|esterna.*\+.*interna|ase[hg]\w*[-_]aoe[hg]|aoe[hg]\w*[-_]ase[hg]|climatizzatore.*monoblocc|climatizzatore (a pavimento|portatile)', principale = true, segue_marca = true where id = interne;
  end if;

  insert into public.lavori_categorie (lavoro_id, nome, cerca, escludi, principale, segue_marca, ordine)
  values (lav, 'Unità esterne', 'unit[aà]''? esterna|macchina esterna|\bmuz-|\bsuz-|\bmxz-|\bpumy|\baoe[hg]|esterna.*(btu|kw|split|inverter|r32)', 'tubo|rame|bombola|lavagg|staff|pompa condensa|kit spray|canalin|cover|telecomando|filtro|griglia|supporto|gruppo idraulico|sanicondens|scatola|predisposiz|\bbase\b|distributor|giunto|sonda|piedin|antivibrant|resistenza|giunzione|binario|miscelator|interna|(\bu\.?[ei]\.?|\bu[ei]) ?\+ ?(u\.?[ei]|unit)|mono ?split.*\+|esterna.*\+.*interna|ase[hg]\w*[-_]aoe[hg]|aoe[hg]\w*[-_]ase[hg]|climatizzatore.*monoblocc|climatizzatore (a pavimento|portatile)|s/unit', true, true, 11)
  on conflict (lavoro_id, nome) do update set cerca = excluded.cerca, escludi = excluded.escludi
  returning id into esterne;

  insert into public.lavori_categorie (lavoro_id, nome, cerca, escludi, principale, segue_marca, ordine)
  values (lav, 'Climatizzatori completi (interna + esterna)', '(\bu\.?[ei]\.?|\bu[ei]) ?\+ ?(u\.?[ei]|unit)|mono ?split.*\+|esterna.*\+.*interna|ase[hg]\w*[-_]aoe[hg]|aoe[hg]\w*[-_]ase[hg]|climatizzatore.*monoblocc|climatizzatore (a pavimento|portatile)', 'tubo|rame|bombola|lavagg|staff|pompa condensa|kit spray|canalin|cover|telecomando|filtro|griglia|supporto|gruppo idraulico|sanicondens|scatola|predisposiz|\bbase\b|distributor|giunto|sonda|piedin|antivibrant|resistenza|giunzione|binario|miscelator', true, false, 12)
  on conflict (lavoro_id, nome) do update set cerca = excluded.cerca, escludi = excluded.escludi
  returning id into completi;

  -- Materiali scelti a mano: le esterne e i kit completi si spostano nella loro categoria
  -- (nelle espressioni di PostgreSQL l'inizio parola si scrive \y invece di \b)
  update public.lavori_categorie_materiali cm set categoria_id = case
      when m.descrizione ~* replace(re_kit, '\b', '\y') then completi
      else esterne end
  from public.materiali m
  where cm.categoria_id = interne and m.id = cm.materiale_id
    and (m.descrizione ~* replace(re_kit, '\b', '\y') or m.descrizione ~* replace(re_est, '\b', '\y'))
    and not exists (select 1 from public.lavori_categorie_materiali x
                    where x.materiale_id = cm.materiale_id
                      and x.categoria_id = case when m.descrizione ~* replace(re_kit, '\b', '\y') then completi else esterne end);
end $$;

notify pgrst, 'reload schema';
