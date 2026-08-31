-- Live-Recherche darf den Datensatz aktualisieren: neue Facts/Tags
-- mergen in queued Rows, nach Merge erneut einreihen (neue Pack-Version).

create or replace function public.submit_pack_spot(
  p_city_id text,
  p_name text,
  p_lat double precision,
  p_lng double precision,
  p_city_name text default null,
  p_category text default null,
  p_pack_role text default 'directory',
  p_place_tier int default null,
  p_facts_json jsonb default '[]'::jsonb,
  p_wiki_extract text default null,
  p_source_url text default null,
  p_contributor_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_city text := lower(trim(coalesce(p_city_id, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_norm text;
  v_role text := lower(trim(coalesce(p_pack_role, 'directory')));
  v_facts jsonb := coalesce(p_facts_json, '[]'::jsonb);
  r public.pack_spot_inbox%rowtype;
begin
  if length(v_city) < 2 or length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'bad_payload');
  end if;
  if p_lat is null or p_lng is null then
    return jsonb_build_object('ok', false, 'error', 'bad_coords');
  end if;
  if v_role not in ('story', 'directory') then
    v_role := 'directory';
  end if;
  v_norm := lower(regexp_replace(v_name, '[^a-z0-9äöüß]+', ' ', 'g'));
  v_norm := trim(regexp_replace(v_norm, '\s+', ' ', 'g'));

  select * into r
  from public.pack_spot_inbox
  where city_id = v_city
    and name_norm = v_norm
    and abs(lat - p_lat) < 0.00045
    and abs(lng - p_lng) < 0.00045
    and status = 'queued'
  order by created_at desc
  limit 1;

  if r.id is not null then
    update public.pack_spot_inbox
    set facts_json = (
          select coalesce(jsonb_agg(elem), '[]'::jsonb)
          from (
            select distinct on (elem->>'text') elem
            from jsonb_array_elements(coalesce(r.facts_json, '[]'::jsonb) || v_facts) elem
          ) s
        ),
        category = coalesce(nullif(trim(coalesce(p_category, '')), ''), r.category),
        wiki_extract = coalesce(nullif(trim(coalesce(p_wiki_extract, '')), ''), r.wiki_extract),
        source_url = coalesce(nullif(trim(coalesce(p_source_url, '')), ''), r.source_url),
        updated_at = now()
    where id = r.id;
    return jsonb_build_object('ok', true, 'duplicate', false, 'updated', true, 'id', r.id, 'status', 'queued');
  end if;

  select * into r
  from public.pack_spot_inbox
  where city_id = v_city
    and name_norm = v_norm
    and abs(lat - p_lat) < 0.00045
    and abs(lng - p_lng) < 0.00045
    and status = 'building'
  order by created_at desc
  limit 1;

  if r.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', r.id, 'status', r.status);
  end if;

  select * into r
  from public.pack_spot_inbox
  where city_id = v_city
    and name_norm = v_norm
    and abs(lat - p_lat) < 0.00045
    and abs(lng - p_lng) < 0.00045
    and status = 'merged'
  order by merged_at desc nulls last
  limit 1;

  if r.id is not null and r.facts_json = v_facts then
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', r.id, 'status', 'merged');
  end if;

  insert into public.pack_spot_inbox (
    city_id, city_name, name, name_norm, lat, lng, category, pack_role, place_tier,
    facts_json, wiki_extract, source_url, contributor_hash, status
  ) values (
    v_city, nullif(trim(coalesce(p_city_name, '')), ''), v_name, v_norm, p_lat, p_lng,
    p_category, v_role, p_place_tier, v_facts,
    p_wiki_extract, p_source_url, p_contributor_hash, 'queued'
  )
  returning * into r;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'id', r.id,
    'status', r.status,
    'refresh', true
  );
end;
$$;
