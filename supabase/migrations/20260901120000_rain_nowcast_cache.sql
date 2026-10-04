-- Shared Regen-Radar Nowcast: 1 Bright-Sky-Call / ~1 km Zelle / TTL (~5 Min)
create table if not exists public.rain_nowcast_cache (
  cache_key text primary key,
  lat double precision not null,
  lng double precision not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists rain_nowcast_cache_expires_at_idx
  on public.rain_nowcast_cache (expires_at);

alter table public.rain_nowcast_cache enable row level security;
-- service_role only via rain-nowcast Edge Function (no anon policies)
