-- Synapse migration 002 — classification, facets, spaces
-- Paste into the Supabase SQL Editor and Run. Safe to run more than once.

-- ------------------------------------------------------------------ spaces
create table if not exists public.spaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text not null default '',
  color       text not null default '#7c8cff',
  -- the entity this space grew from, if it was auto-derived
  anchor_entity_id uuid references public.entities(id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index if not exists spaces_user_name_idx
  on public.spaces (user_id, lower(name));

-- ----------------------------------------------------------------- threads
-- A running conversation about one subject inside a space.
create table if not exists public.threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  space_id   uuid references public.spaces(id) on delete set null,
  title      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists threads_user_space_idx on public.threads (user_id, space_id);

-- ------------------------------------------------------- notes: new columns
alter table public.notes
  add column if not exists intent text not null default 'unclassified',
  add column if not exists intent_confidence real not null default 0,
  add column if not exists status text not null default 'needs_review',
  add column if not exists space_id uuid references public.spaces(id) on delete set null,
  add column if not exists thread_id uuid references public.threads(id) on delete set null,
  add column if not exists unclassified_reason text,
  add column if not exists reviewed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notes_intent_check') then
    alter table public.notes add constraint notes_intent_check check (intent in (
      'task','decision','idea','question','observation',
      'reflection','reference','log','unclassified'
    ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notes_status_check') then
    alter table public.notes add constraint notes_status_check check (status in (
      'inbox','needs_review','filed','archived'
    ));
  end if;
end $$;

create index if not exists notes_status_idx  on public.notes (user_id, status);
create index if not exists notes_intent_idx  on public.notes (user_id, intent);
create index if not exists notes_space_idx   on public.notes (user_id, space_id);

-- Full-text search, for hybrid retrieval alongside the vector index.
alter table public.notes
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(text,'') || ' ' || coalesce(summary,''))
  ) stored;

create index if not exists notes_search_idx on public.notes using gin (search_tsv);

-- ------------------------------------------------------ actions: enrichment
alter table public.actions
  add column if not exists due_date  date,
  add column if not exists owner     text,
  add column if not exists priority  text not null default 'normal';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'actions_priority_check') then
    alter table public.actions add constraint actions_priority_check
      check (priority in ('low','normal','high'));
  end if;
end $$;

-- ------------------------------------------------------------- data points
create table if not exists public.data_points (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.notes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  label      text not null,
  value      text not null,
  unit       text,
  kind       text not null default 'fact'
             check (kind in ('metric','date','money','identifier','fact')),
  created_at timestamptz not null default now()
);

create index if not exists data_points_user_idx on public.data_points (user_id);

-- ---------------------------------------------------------------- questions
create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references public.notes(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  text        text not null,
  resolved    boolean not null default false,
  resolved_by uuid references public.notes(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists questions_open_idx on public.questions (user_id, resolved);

-- ---------------------------------------------------------------- decisions
create table if not exists public.decisions (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid not null references public.notes(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  text         text not null,
  alternatives text[] not null default '{}',
  created_at   timestamptz not null default now()
);

create index if not exists decisions_user_idx on public.decisions (user_id);

-- ------------------------------------------------- corrections (self-learning)
-- Every manual reclassification becomes a few-shot example for the extractor.
create table if not exists public.corrections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  note_id     uuid references public.notes(id) on delete set null,
  field       text not null,          -- 'intent' | 'space' | 'entity'
  from_value  text,
  to_value    text not null,
  note_excerpt text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists corrections_user_field_idx on public.corrections (user_id, field);

-- --------------------------------------------------------------------- RLS
alter table public.spaces      enable row level security;
alter table public.threads     enable row level security;
alter table public.data_points enable row level security;
alter table public.questions   enable row level security;
alter table public.decisions   enable row level security;
alter table public.corrections enable row level security;

do $$
declare t text;
begin
  foreach t in array array['spaces','threads','data_points','questions','decisions','corrections']
  loop
    execute format('drop policy if exists "own %1$s" on public.%1$I', t);
    execute format(
      'create policy "own %1$s" on public.%1$I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t
    );
  end loop;
end $$;

-- ------------------------------------------------------- hybrid search fn
-- Keyword half of hybrid retrieval; the vector half stays in Qdrant.
create or replace function public.search_notes_text(p_user_id uuid, p_query text, p_limit int default 20)
returns table (id uuid, title text, rank real)
language sql stable
as $$
  select n.id, n.title, ts_rank(n.search_tsv, websearch_to_tsquery('english', p_query))::real as rank
  from public.notes n
  where n.user_id = p_user_id
    and n.search_tsv @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
$$;

-- Existing rows predate classification; surface them for review rather than
-- pretending they were classified.
update public.notes
set status = 'needs_review'
where status not in ('inbox','needs_review','filed','archived');
