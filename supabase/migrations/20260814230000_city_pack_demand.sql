-- City-Pack Demand: ab 10 Unique-Usern → Queue für auto city:auto + Upload

create table if not exists public.city_pack_demand (
  city_id text primary key,
  city_name text not null,
  lat double precision,
  lng double precision,
  unique_users int not null default 0,
  contributor_hashes text[] not null default '{}'::text[],
  status text not null default 'collecting'
    check (status in ('collecting', 'queued', 'building', 'published', 'failed')),
  threshold int not null default 10,
  queued_at timestamptz,
  building_at timestamptz,
  published_at timestamptz,
  failed_at timestamptz,
  fail_reason text,
  pack_id text,
  last_ping_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists city_pack_demand_status_idx
  on public.city_pack_demand (status);
create index if not exists city_pack_demand_queued_idx
  on public.city_pack_demand (queued_at)
  where status = 'queued';

alter table public.city_pack_demand enable row level security;

drop policy if exists "Public read city_pack_demand" on public.city_pack_demand;
create policy "Public read city_pack_demand"
  on public.city_pack_demand for select
  using (true);

-- Writes nur über Security-Definer RPC (kein offenes Anon-Update)

create table if not exists public.city_pack_presence_pings (
  city_id text not null,
  contributor_hash text not null,
  city_name text,
  lat double precision,
  lng double precision,
  last_seen_at timestamptz not null default now(),
  primary key (city_id, contributor_hash)
);

create index if not exists city_pack_presence_city_idx
  on public.city_pack_presence_pings (city_id);

alter table public.city_pack_presence_pings enable row level security;

drop policy if exists "Public read city_pack_presence_pings" on public.city_pack_presence_pings;
create policy "Public read city_pack_presence_pings"
  on public.city_pack_presence_pings for select
  using (true);

/**
 * Ping: Unique User in Stadt zählen.
 * Ab threshold (Default 10) → status queued (Datensatz-Bau).
 * Schon published/building → nur last_seen aktualisieren.
 */
create or replace function public.ping_city_pack_demand(
  p_city_id text,
  p_city_name text,
  p_contributor_hash text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_threshold int default 10
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_city_id text;
  v_name text;
  v_hash text;
  v_thr int;
  v_hashes text[];
  v_count int;
  v_status text;
  v_became_queued boolean := false;
begin
  v_city_id := lower(trim(both from coalesce(p_city_id, '')));
  v_name := trim(both from coalesce(p_city_name, ''));
  v_hash := lower(trim(both from coalesce(p_contributor_hash, '')));
  v_thr := greatest(3, least(coalesce(p_threshold, 10), 100));

  if v_city_id = '' or length(v_city_id) < 2 or v_hash = '' or length(v_hash) < 4 then
    return jsonb_build_object('ok', false, 'error', 'bad_args');
  end if;
  -- soft_ Prefixe normalisieren (soft_wedel → wedel)
  if v_city_id like 'soft_%' then
    v_city_id := substring(v_city_id from 6);
  end if;
  if v_city_id = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_city');
  end if;
  if v_name = '' then
    v_name := initcap(replace(v_city_id, '_', ' '));
  end if;

  insert into public.city_pack_presence_pings as p
    (city_id, contributor_hash, city_name, lat, lng, last_seen_at)
  values
    (v_city_id, v_hash, v_name, p_lat, p_lng, now())
  on conflict (city_id, contributor_hash) do update
    set last_seen_at = now(),
        city_name = excluded.city_name,
        lat = coalesce(excluded.lat, p.lat),
        lng = coalesce(excluded.lng, p.lng);

  insert into public.city_pack_demand as d
    (city_id, city_name, lat, lng, unique_users, contributor_hashes, status, threshold, last_ping_at, updated_at)
  values
    (v_city_id, v_name, p_lat, p_lng, 1, array[v_hash], 'collecting', v_thr, now(), now())
  on conflict (city_id) do update
    set city_name = excluded.city_name,
        lat = coalesce(excluded.lat, d.lat),
        lng = coalesce(excluded.lng, d.lng),
        last_ping_at = now(),
        updated_at = now(),
        threshold = greatest(d.threshold, excluded.threshold),
        contributor_hashes = case
          when d.status in ('published', 'building') then d.contributor_hashes
          when v_hash = any (d.contributor_hashes) then d.contributor_hashes
          else array_append(d.contributor_hashes, v_hash)
        end
  returning contributor_hashes, status
  into v_hashes, v_status;

  v_count := cardinality(coalesce(v_hashes, array[]::text[]));

  update public.city_pack_demand
  set unique_users = v_count,
      updated_at = now()
  where city_id = v_city_id;

  if v_status = 'collecting' and v_count >= v_thr then
    update public.city_pack_demand
    set status = 'queued',
        queued_at = coalesce(queued_at, now()),
        updated_at = now()
    where city_id = v_city_id
      and status = 'collecting';
    v_became_queued := true;
    v_status := 'queued';
  end if;

  return jsonb_build_object(
    'ok', true,
    'cityId', v_city_id,
    'cityName', v_name,
    'uniqueUsers', v_count,
    'threshold', v_thr,
    'status', v_status,
    'becameQueued', v_became_queued
  );
end;
$$;

grant execute on function public.ping_city_pack_demand(text, text, text, double precision, double precision, int)
  to anon, authenticated, service_role;

/**
 * Builder/CI: nächste queued Stadt claimen.
 */
create or replace function public.claim_city_pack_demand(p_city_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.city_pack_demand%rowtype;
begin
  if p_city_id is not null and length(trim(p_city_id)) > 0 then
    update public.city_pack_demand
    set status = 'building',
        building_at = now(),
        updated_at = now()
    where city_id = lower(trim(p_city_id))
      and status = 'queued'
    returning * into r;
  else
    update public.city_pack_demand d
    set status = 'building',
        building_at = now(),
        updated_at = now()
    from (
      select city_id
      from public.city_pack_demand
      where status = 'queued'
      order by queued_at nulls last, unique_users desc
      limit 1
    ) q
    where d.city_id = q.city_id
    returning d.* into r;
  end if;

  if r.city_id is null then
    return jsonb_build_object('ok', false, 'empty', true);
  end if;

  return jsonb_build_object(
    'ok', true,
    'cityId', r.city_id,
    'cityName', r.city_name,
    'lat', r.lat,
    'lng', r.lng,
    'uniqueUsers', r.unique_users
  );
end;
$$;

grant execute on function public.claim_city_pack_demand(text)
  to anon, authenticated, service_role;

create or replace function public.finish_city_pack_demand(
  p_city_id text,
  p_ok boolean,
  p_pack_id text default null,
  p_fail_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id text := lower(trim(coalesce(p_city_id, '')));
begin
  if v_id = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_args');
  end if;

  if p_ok then
    update public.city_pack_demand
    set status = 'published',
        pack_id = coalesce(nullif(trim(p_pack_id), ''), city_id),
        published_at = now(),
        fail_reason = null,
        updated_at = now()
    where city_id = v_id;
  else
    update public.city_pack_demand
    set status = 'failed',
        failed_at = now(),
        fail_reason = left(coalesce(p_fail_reason, 'unknown'), 400),
        updated_at = now()
    where city_id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'cityId', v_id, 'published', p_ok);
end;
$$;

grant execute on function public.finish_city_pack_demand(text, boolean, text, text)
  to anon, authenticated, service_role;
