-- Preventivo guidato idraulico: "Cosa facciamo?" (Caldaia, Climatizzatore, Irrigazione…) e per ogni lavoro
-- le categorie di materiali del catalogo da proporre (sdoppiatori, defangatori, dosatori, canne fumarie…).
-- Ogni categoria cerca nella descrizione dei materiali con un'espressione (es. "defangat|filtro magnetico").
-- "principale": il materiale scelto lì (es. la caldaia) dà la marca; "segue_marca": mostra prima i materiali di quella marca.
-- Da eseguire dopo 0031. Si può rieseguire.

create table if not exists public.lavori_preventivo (
  id bigint generated always as identity primary key,
  tipo text not null default 'idraulico' check (tipo in ('elettrico', 'idraulico')),
  nome text not null,
  icona text,
  ordine int not null default 0,
  attivo boolean not null default true,
  unique (tipo, nome)
);

create table if not exists public.lavori_categorie (
  id bigint generated always as identity primary key,
  lavoro_id bigint not null references public.lavori_preventivo(id) on delete cascade,
  nome text not null,
  cerca text not null,
  escludi text,
  principale boolean not null default false,
  segue_marca boolean not null default false,
  ordine int not null default 0,
  unique (lavoro_id, nome)
);

do $$
declare t text;
begin
  foreach t in array array['lavori_preventivo', 'lavori_categorie'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_lettura', t);
    execute format('create policy %I on public.%I for select using (public.puo(''preventivi'', ''vedere''))', t || '_lettura', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;

insert into public.lavori_preventivo (tipo, nome, icona, ordine) values
  ('idraulico', 'Caldaia', '🔥', 10),
  ('idraulico', 'Climatizzatore', '❄️', 20),
  ('idraulico', 'Scaldabagno', '🚿', 30),
  ('idraulico', 'Irrigazione', '🌱', 40),
  ('idraulico', 'Trattamento acqua', '🧪', 50),
  ('idraulico', 'Radiatori', '♨️', 60)
on conflict (tipo, nome) do nothing;

insert into public.lavori_categorie (lavoro_id, nome, cerca, escludi, principale, segue_marca, ordine)
select l.id, x.nome, x.cerca, x.escludi, x.principale, x.segue_marca, x.ordine from (values
  ('Caldaia', 'Caldaie', 'caldaia|caldaie|termocamino a gas', 'salva ?caldaia|adattator|tronchett|dosator|box incasso|incasso per|copricaldaia|coibentaz|defang|partenza|sdoppiat|staffa|raccord|sotto ?caldaia|pompa|neutraliz|curva|prolunga|copertura|dima|ricambi|kit (scarico|fumi|attacchi|allacc)|scheda|sonda|termostato|cronot|filtro|valvola|rubinett|vaso|tubo', true, false, 10),
  ('Caldaia', 'Sdoppiatori fumi', 'sdoppiat', null, false, true, 20),
  ('Caldaia', 'Scarico fumi e canne fumarie', 'canna fum|fumari|scarico fumi|kit fumi|coassial|(curva|prolunga|terminale|rosone|cappellotto|tubo|partenza|raccordo|fascetta|camino|adattatore)\b.*(ø|d\.?) ?(60|80|100|125)\b', '\btv\b|rg ?\d|cavo|spina|antenn|\bsat\b|connettor|presa|f maschio|pvc|scarico wc|sifone|\bpe\b|\bpp\b.*scarico|braga', false, true, 30),
  ('Caldaia', 'Kit e accessori caldaia', 'kit.*caldai|\bdima\b|box incasso|copricaldaia|adattator.*caldai|tronchett.*(caldai|ø ?80|ø ?60|flangiat)|copertura.*caldai|staffa.*caldai|rubinett.*caldai|sotto ?caldaia|partenza.*caldai', 'salva|defang|sdoppiat|kit caldaia murale|dosator|dosatric|magnetic|pvc', false, true, 40),
  ('Caldaia', 'Defangatori', 'defangat', null, false, false, 50),
  ('Caldaia', 'Dosatori polifosfati', 'polifosf|dosator', null, false, false, 60),
  ('Caldaia', 'Kit salvacaldaia e trattamento', 'salva ?caldaia|filmant|inibitor|risanant|pulitor.*impiant|protettiv.*impiant|lavaggio impiant', 'toolsplit|split', false, false, 70),
  ('Caldaia', 'Neutralizzatori e pompe condensa', 'neutralizz|sanicondens|pompa.*condensa.*caldai|scarico condensa.*caldai', 'clim|split', false, false, 80),
  ('Caldaia', 'Termostati e cronotermostati', 'cronoterm|termostato (ambiente|da parete|digitale|elettron|settiman|wi ?fi|smart)|termostato.*(parete|wifi|wi-fi)|\bsmarther|\bnetatmo', 'miscelat|valvol|testa|boiler|scaldab|forno', false, false, 90),
  ('Caldaia', 'Vasi di espansione', 'vaso.*esp', null, false, false, 100),
  ('Caldaia', 'Valvole e tubi gas', 'rubinetto.*gas|valvola.*gas|gas.*(valvola|rubinetto)|tubo.*gas|flessibile.*gas|gas.*flessibil|tubo rame gas', 'scaldab', false, false, 110),
  ('Climatizzatore', 'Climatizzatori', 'climatizz|condizionator|mono ?split|dual ?split|trial ?split|multi ?split|unita''? (interna|esterna|canalizzata)|macchina esterna|\bsplit\b|pompa di calore.*(split|unita)', 'tubo|rame|bombola|lavagg|staff|pompa condensa|kit spray|canalin|cover|telecomando|filtro|griglia|supporto', true, false, 10),
  ('Climatizzatore', 'Tubo rame per split', 'rame.*split|split.*rame|tubo rame.*(1/4|3/8|1/2|5/8)|rame rivestit|coibentat.*rame', 'gas', false, false, 20),
  ('Climatizzatore', 'Staffe e supporti unità esterna', 'staff.*(esterna|u/est|condizion|clima|split|unita)|staffa universale|supporto.*(unita|condizion|clima)|piedin.*(antivibr|clima)|antivibrant', 'flessibil', false, false, 30),
  ('Climatizzatore', 'Scarico condensa', 'condensa', 'caldai|condensaz|condensator|kit caldaia|canna fum|anticondensa|valvola|unita|canalizzat', false, false, 40),
  ('Climatizzatore', 'Canaline e coprifili', 'canalin.*(clima|split|condiz|tecnic)|coprifil|tecnoline|copritubo', 'radiator', false, false, 50),
  ('Climatizzatore', 'Pulizia, gas e accessori', 'lavagg.*(split|clima|impiant)|igienizz|toolsplit|\br32\b|\br410|refrigerant|telecomando.*(clima|condiz)', 'unita|split inverter|monosplit|macchina', false, false, 60),
  ('Scaldabagno', 'Scaldabagni', 'scaldabagn|scaldacqua|termoboiler|\bboiler\b|bollitore', 'anodo|resistenza|termostato|valvola|guarnizion|flangia', true, false, 10),
  ('Scaldabagno', 'Scarico fumi', 'canna fum|fumari|scarico fumi|kit fumi|coassial|(curva|prolunga|terminale|rosone|cappellotto|tubo|partenza|raccordo|fascetta|camino|adattatore)\b.*(ø|d\.?) ?(60|80|100|125)\b', '\btv\b|rg ?\d|cavo|spina|antenn|\bsat\b|connettor|presa|f maschio|pvc|scarico wc|sifone|\bpe\b|\bpp\b.*scarico|braga', false, true, 20),
  ('Scaldabagno', 'Valvole di sicurezza', 'valvola.*(sicurezza|ritegno|antiscott|miscelat|termostat)|gruppo (di )?sicurezza|miscelatore termostatico', 'doccia|lavabo|bidet|vasca|lavello|radiator|detentor|termostatizzab', false, false, 30),
  ('Scaldabagno', 'Vasi di espansione', 'vaso.*esp', null, false, false, 40),
  ('Scaldabagno', 'Dosatori polifosfati', 'polifosf|dosator', null, false, false, 50),
  ('Irrigazione', 'Programmatori e centraline', 'programmator|centralin.*irrig|timer.*(irrig|acqua)|rain ?bird.*(esp|rzx)|sensore pioggia', null, false, false, 10),
  ('Irrigazione', 'Elettrovalvole', 'elettroval', 'gas|caldai|lavatric', false, false, 20),
  ('Irrigazione', 'Irrigatori e testine', 'irrigator|testina|turbina|spruzzat|ugell|pop ?up', 'doccia|lavabo', false, false, 30),
  ('Irrigazione', 'Ala gocciolante e micro', 'gocciol|ala goc|microirrig|micro.*irrig|\bdripline', null, false, false, 40),
  ('Irrigazione', 'Tubo PE e raccordi', 'tubo pe\b|\bpe ?(ø|dn)\s?\d|polietilen|\bpead\b|raccordo.*\bpe\b|presa a staffa|irritec', 'scarico|fogna|pe-?x|interrutt|gocciol|microirrig|tubicino', false, false, 50),
  ('Irrigazione', 'Pozzetti e collettori', 'pozzett|collettore.*(irrig|elettrov)', null, false, false, 60),
  ('Trattamento acqua', 'Addolcitori', 'addolc', 'sale|cartuccia|resina', false, false, 10),
  ('Trattamento acqua', 'Filtri', 'filtro (autopul|anti ?sabbia|acqua|ingresso|dissabb|lavabile)|\bfiltro\b.*(3/4|1\"|1/2)\b.*(acqua|micron)|contenitore.*filtr|filtr.*micron', 'split|clima|valvola di fondo|lavabo|rubinett|aeratore', false, false, 20),
  ('Trattamento acqua', 'Cartucce e ricariche', 'cartuccia|ricaric|sale.*(addolc|pastiglie)|\bsale in|resina.*(addolc|scambio)', 'stampant|silicon|sigillant|toner|lampada|torcia|bombola|r410|r32|split', false, false, 30),
  ('Trattamento acqua', 'Dosatori polifosfati', 'polifosf|dosator', null, false, false, 40),
  ('Trattamento acqua', 'Riduttori di pressione', 'riduttor.*pressione', null, false, false, 50),
  ('Radiatori', 'Radiatori e termoarredi', 'radiator|termoarred|scaldasalviett|\btesi\b', 'valvol|detentor|testa|kit|riduz|tappo|mensol|staff|sfiat|guarniz|vernic|flangia', true, false, 10),
  ('Radiatori', 'Valvole e detentori', 'valvola.*(termostat|radiator|squadr|dritta)|detentor', 'miscelat|sicurezza', false, false, 20),
  ('Radiatori', 'Teste termostatiche', 'testa.*(termostat|elettrotermic)|comando.*termostat', null, false, false, 30),
  ('Radiatori', 'Kit installazione e mensole', 'kit install|kit universale|mensol.*radiator|staff.*radiator|radiator.*staff|riduzion.*radiator|tappo.*radiator|valvola sfogo|sfiat', null, false, true, 40)
) as x(lavoro, nome, cerca, escludi, principale, segue_marca, ordine)
join public.lavori_preventivo l on l.tipo = 'idraulico' and l.nome = x.lavoro
on conflict (lavoro_id, nome) do nothing;

notify pgrst, 'reload schema';
