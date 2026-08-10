-- Phase 0.2–0.4: per-user cloud sync + marketing opt-in (authenticated users only)

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  content_hash text
);

create table if not exists public.user_stamps (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  content_hash text
);

create table if not exists public.user_timeline (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  content_hash text
);

create table if not exists public.user_memory (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  content_hash text
);

create table if not exists public.user_settings_extras (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  content_hash text
);

create table if not exists public.user_marketing (
  user_id uuid primary key references auth.users (id) on delete cascade,
  newsletter_opt_in boolean not null default false,
  opt_in_at timestamptz,
  locale text,
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
alter table public.user_stamps enable row level security;
alter table public.user_timeline enable row level security;
alter table public.user_memory enable row level security;
alter table public.user_settings_extras enable row level security;
alter table public.user_marketing enable row level security;

create policy "user_profiles_own"
  on public.user_profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_stamps_own"
  on public.user_stamps for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_timeline_own"
  on public.user_timeline for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_memory_own"
  on public.user_memory for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_settings_extras_own"
  on public.user_settings_extras for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_marketing_own"
  on public.user_marketing for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
