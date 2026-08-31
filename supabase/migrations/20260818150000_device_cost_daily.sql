-- Anonymisierte Geräte-API-Kosten pro Tag (contributor_hash).
-- App schreibt nur über RPC; Lesen für Weekly-Digest mit Service Role.

create table if not exists public.device_cost_daily (
  contributor_hash text not null,
  day date not null,
  conservative_eur numeric not null default 0,
  efficient_eur numeric not null default 0,
  gemini_requests int not null default 0,
  maps_requests int not null default 0,
  tts_chars int not null default 0,
  modules jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (contributor_hash, day)
);

create index if not exists device_cost_daily_day_idx
  on public.device_cost_daily (day);

alter table public.device_cost_daily enable row level security;

drop policy if exists "No public read device_cost_daily" on public.device_cost_daily;

create or replace function public.submit_device_cost_day(
  p_contributor_hash text,
  p_day date,
  p_conservative_eur numeric,
  p_efficient_eur numeric,
  p_gemini_requests int,
  p_maps_requests int,
  p_tts_chars int,
  p_modules jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hash text;
  v_day date;
  v_cons numeric;
  v_eff numeric;
begin
  v_hash := lower(trim(coalesce(p_contributor_hash, '')));
  if length(v_hash) < 8 or length(v_hash) > 128 then
    return jsonb_build_object('ok', false, 'error', 'bad_hash');
  end if;
  if p_day is null then
    return jsonb_build_object('ok', false, 'error', 'bad_day');
  end if;
  v_day := p_day;
  v_cons := greatest(0, coalesce(p_conservative_eur, 0));
  v_eff := greatest(0, coalesce(p_efficient_eur, 0));

  insert into public.device_cost_daily as d (
    contributor_hash,
    day,
    conservative_eur,
    efficient_eur,
    gemini_requests,
    maps_requests,
    tts_chars,
    modules,
    updated_at
  ) values (
    v_hash,
    v_day,
    v_cons,
    v_eff,
    greatest(0, coalesce(p_gemini_requests, 0)),
    greatest(0, coalesce(p_maps_requests, 0)),
    greatest(0, coalesce(p_tts_chars, 0)),
    coalesce(p_modules, '{}'::jsonb),
    now()
  )
  on conflict (contributor_hash, day) do update
    set conservative_eur = excluded.conservative_eur,
        efficient_eur = excluded.efficient_eur,
        gemini_requests = excluded.gemini_requests,
        maps_requests = excluded.maps_requests,
        tts_chars = excluded.tts_chars,
        modules = excluded.modules,
        updated_at = now();

  return jsonb_build_object('ok', true, 'day', v_day);
end;
$$;

revoke all on function public.submit_device_cost_day(
  text, date, numeric, numeric, int, int, int, jsonb
) from public;

grant execute on function public.submit_device_cost_day(
  text, date, numeric, numeric, int, int, int, jsonb
) to anon, authenticated;
