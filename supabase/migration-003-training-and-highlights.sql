-- Synapse migration 003 — training module + pattern highlights
-- Paste into the Supabase SQL Editor and Run. Safe to run more than once.
--
-- Training follows docs/specs/size-blueprint-log.md. Every user-owned row
-- carries user_id directly (not only through program_runs) so row level
-- security is one cheap equality check per table.

-- ================================================================ programs
-- Programs are shared reference data: readable by any signed-in user,
-- writable only by the service role (seeded below).
create table if not exists public.programs (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  weeks      int  not null check (weeks between 1 and 52),
  created_at timestamptz not null default now()
);

create table if not exists public.program_exercises (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs(id) on delete cascade,
  workout     text not null check (workout in ('A','B')),
  code        text not null,
  key         text not null,
  name        text not null,
  sets        int  not null check (sets between 1 and 10),
  rep_lo      int  not null check (rep_lo between 0 and 100),
  rep_hi      int  not null check (rep_hi between 0 and 100),
  note        text not null default '',
  -- one-leg / one-arm work: record left and right reps separately
  unilateral  boolean not null default false,
  sort        int  not null,
  unique (program_id, workout, key)
);

-- =========================================================== user-owned rows
create table if not exists public.program_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  program_id  uuid not null references public.programs(id),
  start_date  date not null,
  created_at  timestamptz not null default now()
);
create index if not exists program_runs_user_idx on public.program_runs (user_id, created_at desc);

create table if not exists public.training_sessions (
  id       uuid primary key default gen_random_uuid(),
  run_id   uuid not null references public.program_runs(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  week     int  not null check (week between 1 and 52),
  slot     int  not null check (slot between 0 and 2),
  -- always equal to sessionOrder(week)[slot]; stored for easy querying
  workout  text not null check (workout in ('A','B')),
  date     date,
  done     boolean not null default false,
  unique (run_id, week, slot)
);

create table if not exists public.exercise_entries (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.training_sessions(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  exercise_key  text not null,
  load_kg       numeric(5,2) check (load_kg between 0 and 60),
  variation     text,
  unique (session_id, exercise_key)
);

create table if not exists public.exercise_sets (
  entry_id    uuid not null references public.exercise_entries(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  set_index   int  not null check (set_index between 0 and 9),
  -- for unilateral work this is the LEFT side; reps_right holds the right
  reps        int  check (reps between 0 and 100),
  reps_right  int  check (reps_right between 0 and 100),
  primary key (entry_id, set_index)
);

create table if not exists public.weekly_checkins (
  run_id     uuid not null references public.program_runs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  week       int  not null check (week between 1 and 52),
  weight_kg  numeric(5,2) check (weight_kg between 30 and 150),
  sleep_h    numeric(4,2) check (sleep_h between 0 and 24),
  food       text check (food in ('Same as last week','Added ~300 kcal/day','Missed meals')),
  notes      text,
  updated_at timestamptz not null default now(),
  primary key (run_id, week)
);

create table if not exists public.measurements (
  run_id    uuid not null references public.program_runs(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  week      int  not null check (week between 1 and 52),
  waist_cm  numeric(5,1) check (waist_cm between 20 and 250),
  chest_cm  numeric(5,1) check (chest_cm between 20 and 250),
  arm_cm    numeric(5,1) check (arm_cm between 10 and 100),
  thigh_cm  numeric(5,1) check (thigh_cm between 10 and 150),
  photos    boolean not null default false,
  primary key (run_id, week)
);

-- ============================================================== highlights
-- What the pattern engine noticed. Feedback is the learning signal: it is fed
-- back into the next generation so the engine drifts toward what you value.
create table if not exists public.highlights (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('theme','shift','loop','link','growth','nudge')),
  title       text not null,
  body        text not null,
  note_ids    uuid[] not null default '{}',
  evidence    jsonb not null default '{}'::jsonb,
  score       real not null default 0.5,
  feedback    text check (feedback in ('useful','not_useful')),
  feedback_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists highlights_user_idx on public.highlights (user_id, created_at desc);

-- ===================================================================== RLS
alter table public.programs          enable row level security;
alter table public.program_exercises enable row level security;

drop policy if exists "read programs" on public.programs;
create policy "read programs" on public.programs for select to authenticated using (true);
drop policy if exists "read program exercises" on public.program_exercises;
create policy "read program exercises" on public.program_exercises for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array[
    'program_runs','training_sessions','exercise_entries','exercise_sets',
    'weekly_checkins','measurements','highlights'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own %1$s" on public.%1$I', t);
    execute format(
      'create policy "own %1$s" on public.%1$I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t
    );
  end loop;
end $$;

-- ====================================================== one-call upserts
-- Each logged rep is one round trip instead of three (session → entry → set).
-- security invoker: they run as the caller, so RLS still applies.

create or replace function public.training_session_id(p_run uuid, p_week int, p_slot int)
returns uuid
language plpgsql security invoker
as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.program_runs where id = p_run and user_id = auth.uid()) then
    raise exception 'run not found' using errcode = '42501';
  end if;
  insert into public.training_sessions (run_id, user_id, week, slot, workout)
  values (
    p_run, auth.uid(), p_week, p_slot,
    case when p_week % 2 = 1 then (array['A','B','A'])[p_slot + 1]
         else (array['B','A','B'])[p_slot + 1] end
  )
  on conflict (run_id, week, slot) do update set week = excluded.week
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.training_entry_id(p_run uuid, p_week int, p_slot int, p_key text)
returns uuid
language plpgsql security invoker
as $$
declare v_session uuid; v_id uuid;
begin
  v_session := public.training_session_id(p_run, p_week, p_slot);
  insert into public.exercise_entries (session_id, user_id, exercise_key)
  values (v_session, auth.uid(), p_key)
  on conflict (session_id, exercise_key) do update set exercise_key = excluded.exercise_key
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.training_upsert_set(
  p_run uuid, p_week int, p_slot int, p_key text, p_set int, p_reps int, p_reps_right int default null
)
returns void
language plpgsql security invoker
as $$
declare v_entry uuid;
begin
  v_entry := public.training_entry_id(p_run, p_week, p_slot, p_key);
  if p_reps is null and p_reps_right is null then
    delete from public.exercise_sets where entry_id = v_entry and set_index = p_set;
  else
    insert into public.exercise_sets (entry_id, user_id, set_index, reps, reps_right)
    values (v_entry, auth.uid(), p_set, p_reps, p_reps_right)
    on conflict (entry_id, set_index) do update
      set reps = excluded.reps, reps_right = excluded.reps_right;
  end if;
end $$;

create or replace function public.training_upsert_entry(
  p_run uuid, p_week int, p_slot int, p_key text, p_load numeric, p_variation text
)
returns void
language plpgsql security invoker
as $$
declare v_entry uuid;
begin
  v_entry := public.training_entry_id(p_run, p_week, p_slot, p_key);
  update public.exercise_entries
     set load_kg = p_load, variation = nullif(p_variation, '')
   where id = v_entry;
end $$;

create or replace function public.training_upsert_session(
  p_run uuid, p_week int, p_slot int, p_date date, p_done boolean
)
returns void
language plpgsql security invoker
as $$
declare v_session uuid;
begin
  v_session := public.training_session_id(p_run, p_week, p_slot);
  update public.training_sessions set date = p_date, done = p_done where id = v_session;
end $$;

-- ===================================================================== seed
insert into public.programs (slug, name, weeks)
values ('size-blueprint-1', 'Size Blueprint Phase 1', 12)
on conflict (slug) do update set name = excluded.name, weeks = excluded.weeks;

insert into public.program_exercises
  (program_id, workout, code, key, name, sets, rep_lo, rep_hi, note, unilateral, sort)
select p.id, x.workout, x.code, x.key, x.name, x.sets, x.rep_lo, x.rep_hi, x.note, x.unilateral, x.sort
from public.programs p
cross join (values
  ('A','A1','pushups',  'Backpack push-ups',            3,  8, 15, '',        false, 1),
  ('A','A2','tablerows','Table rows',                   3,  8, 15, '',        false, 2),
  ('A','B1','bss',      'Bulgarian split squats',       3,  8, 12, 'per leg', true,  3),
  ('A','B2','lateral',  'Lateral raises',               3, 12, 20, '',        false, 4),
  ('A','C1','dips',     'Chair dips',                   2,  8, 15, '',        false, 5),
  ('A','C2','curls',    'Bicep curls',                  2, 10, 15, '',        false, 6),
  ('B','A1','pike',     'Pike push-ups',                3,  6, 12, '',        false, 1),
  ('B','A2','pullups',  'Sliding pull-ups / towel rows',3,  8, 12, '',        false, 2),
  ('B','B1','rdl',      'Romanian deadlifts',           3, 10, 15, '',        false, 3),
  ('B','B2','lateral',  'Lateral raises',               3, 12, 20, '',        false, 4),
  ('B','C1','fepush',   'Feet-elevated push-ups',       2,  8, 15, '',        false, 5),
  ('B','C2','facepull', 'Door face pulls',              2, 12, 20, '',        false, 6),
  ('B','D1','ohext',    'Overhead triceps extensions',  2,  8, 15, '',        false, 7),
  ('B','D2','curls',    'Bicep curls',                  2, 10, 15, '',        false, 8)
) as x(workout, code, key, name, sets, rep_lo, rep_hi, note, unilateral, sort)
where p.slug = 'size-blueprint-1'
on conflict (program_id, workout, key) do update set
  code = excluded.code, name = excluded.name, sets = excluded.sets,
  rep_lo = excluded.rep_lo, rep_hi = excluded.rep_hi, note = excluded.note,
  unilateral = excluded.unilateral, sort = excluded.sort;

-- Explicit, in case the project's default function privileges are locked down.
grant execute on function public.training_session_id(uuid, int, int) to authenticated;
grant execute on function public.training_entry_id(uuid, int, int, text) to authenticated;
grant execute on function public.training_upsert_set(uuid, int, int, text, int, int, int) to authenticated;
grant execute on function public.training_upsert_entry(uuid, int, int, text, numeric, text) to authenticated;
grant execute on function public.training_upsert_session(uuid, int, int, date, boolean) to authenticated;
