-- User-discovered places → official city pack (merge + wiki-depth + upload:city)

create table if not exists public.pack_spot_inbox (
  id uuid primary key default gen_random_uuid(),
  city_id text not null,
  city_name text,
  name text not null,
  name_norm text not null,
  lat double precision not null,
  lng double precision not null,
  category text,
  pack_role text not null default 'directory',
  place_tier int,
  facts_json jsonb not null default '[]'::jsonb,
  wiki_extract text,
  source_url text,
  contributor_hash text,
  status text not null default 'queued'
    check (status in ('queued', 'building', 'merged', 'rejected', 'failed')),
  fail_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  merged_at timestamptz
);

create index if not exists pack_spot_inbox_status_idx
  on public.pack_spot_inbox (status, created_at);

create index if not exists pack_spot_inbox_city_idx
  on public.pack_spot_inbox (city_id, name_norm);

alter table public.pack_spot_inbox enable row level security;

drop policy if exists "Public read pack_spot_inbox" on public.pack_spot_inbox;
create policy "Public read pack_spot_inbox"
  on public.pack_spot_inbox for select
  using (true);

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
    and status in ('queued', 'building', 'merged')
  order by created_at desc
  limit 1;

  if r.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', r.id, 'status', r.status);
  end if;

  insert into public.pack_spot_inbox (
    city_id, city_name, name, name_norm, lat, lng, category, pack_role, place_tier,
    facts_json, wiki_extract, source_url, contributor_hash, status
  ) values (
    v_city, nullif(trim(coalesce(p_city_name, '')), ''), v_name, v_norm, p_lat, p_lng,
    p_category, v_role, p_place_tier, coalesce(p_facts_json, '[]'::jsonb),
    p_wiki_extract, p_source_url, p_contributor_hash, 'queued'
  )
  returning * into r;

  return jsonb_build_object('ok', true, 'duplicate', false, 'id', r.id, 'status', r.status);
end;
$$;

grant execute on function public.submit_pack_spot(
  text, text, double precision, double precision, text, text, text, int, jsonb, text, text, text
) to anon, authenticated, service_role;

create or replace function public.claim_pack_spot_ids(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  claimed uuid[];
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('ok', true, 'ids', '[]'::jsonb);
  end if;

  with u as (
    update public.pack_spot_inbox
    set status = 'building',
        claimed_at = now(),
        updated_at = now()
    where id = any(p_ids)
      and status = 'queued'
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into claimed from u;

  return jsonb_build_object('ok', true, 'ids', to_jsonb(coalesce(claimed, '{}'::uuid[])));
end;
$$;

grant execute on function public.claim_pack_spot_ids(uuid[])
  to anon, authenticated, service_role;

create or replace function public.finish_pack_spot(
  p_id uuid,
  p_ok boolean,
  p_fail_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_ok then
    update public.pack_spot_inbox
    set status = 'merged',
        merged_at = now(),
        fail_reason = null,
        updated_at = now()
    where id = p_id;
  else
    update public.pack_spot_inbox
    set status = 'failed',
        fail_reason = left(coalesce(p_fail_reason, 'failed'), 400),
        updated_at = now()
    where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'merged', p_ok);
end;
$$;

grant execute on function public.finish_pack_spot(uuid, boolean, text)
  to anon, authenticated, service_role;
