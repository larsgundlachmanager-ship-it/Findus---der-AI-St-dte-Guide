-- Crowd-Priors für Akt-3 Recherche-Fortschritt (Stage-Dauern).
create table if not exists public.reisebuero_stage_timings (
  stage_key text primary key,
  sample_count integer not null default 0,
  ewma_ms double precision not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.reisebuero_stage_timings enable row level security;

drop policy if exists "reisebuero_stage_timings_select_anon" on public.reisebuero_stage_timings;
create policy "reisebuero_stage_timings_select_anon"
  on public.reisebuero_stage_timings
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.reisebuero_stage_timings from anon, authenticated;
grant select on public.reisebuero_stage_timings to anon, authenticated;

create or replace function public.record_reisebuero_stage_timing(
  p_stage_key text,
  p_duration_ms double precision,
  p_alpha double precision default 0.12
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cur_count int;
  cur_ewma double precision;
  key text := lower(trim(p_stage_key));
  alpha double precision := greatest(0.05, least(0.35, coalesce(p_alpha, 0.12)));
begin
  if key is null or length(key) < 2 or length(key) > 80 then
    return;
  end if;
  if p_duration_ms is null or p_duration_ms < 400 or p_duration_ms > 1800000 then
    return;
  end if;
  select sample_count, ewma_ms into cur_count, cur_ewma
  from reisebuero_stage_timings where stage_key = key;
  if not found then
    insert into reisebuero_stage_timings(stage_key, sample_count, ewma_ms)
    values (key, 1, p_duration_ms);
  else
    update reisebuero_stage_timings set
      ewma_ms = cur_ewma * (1 - alpha) + p_duration_ms * alpha,
      sample_count = cur_count + 1,
      updated_at = now()
    where stage_key = key;
  end if;
end;
$$;

grant execute on function public.record_reisebuero_stage_timing(text, double precision, double precision) to anon, authenticated;
