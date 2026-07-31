-- Synapse schema
-- Paste this whole file into the Supabase SQL Editor and hit Run.
-- Safe to run more than once.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  display_name text,
  created_at  timestamptz not null default now()
);

-- Every new auth user gets a profile row automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------- notes
create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default '',
  text       text not null,
  summary    text not null default '',
  sentiment  text not null default 'neutral'
             check (sentiment in ('positive','neutral','negative','urgent')),
  tags       text[] not null default '{}',
  source     text not null default 'voice' check (source in ('voice','text')),
  audio_path text,                      -- object path in the `recordings` bucket
  created_at timestamptz not null default now()
);

create index if not exists notes_user_created_idx on public.notes (user_id, created_at desc);
create index if not exists notes_tags_idx on public.notes using gin (tags);

-- ---------------------------------------------------------------- entities
-- Entities are per-user so two people can both have a "Sarah" without collision.
create table if not exists public.entities (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name    text not null,
  type    text not null
          check (type in ('person','project','org','concept','place','tool')),
  unique (user_id, lower(name), type)
);

create index if not exists entities_user_idx on public.entities (user_id);

create table if not exists public.note_entities (
  note_id   uuid not null references public.notes(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  primary key (note_id, entity_id)
);

create index if not exists note_entities_entity_idx on public.note_entities (entity_id);

-- ----------------------------------------------------------------- actions
create table if not exists public.actions (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.notes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  text       text not null,
  done       boolean not null default false,
  done_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists actions_user_done_idx on public.actions (user_id, done);

-- ----------------------------------------------------------- conversations
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  query      text not null,
  answer     text not null default '',
  citations  jsonb not null default '[]'::jsonb,
  tools_used text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_created_idx
  on public.conversations (user_id, created_at desc);

-- --------------------------------------------------------------------- RLS
-- Without these, any authenticated user could read everyone else's brain.
alter table public.profiles      enable row level security;
alter table public.notes         enable row level security;
alter table public.entities      enable row level security;
alter table public.note_entities enable row level security;
alter table public.actions       enable row level security;
alter table public.conversations enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own entities" on public.entities;
create policy "own entities" on public.entities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own actions" on public.actions;
create policy "own actions" on public.actions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Join table is reached through a note the user owns.
drop policy if exists "own note_entities" on public.note_entities;
create policy "own note_entities" on public.note_entities
  for all using (
    exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
  );

-- ----------------------------------------------------------------- storage
-- Private bucket for the original voice recordings.
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- Objects are stored at  <user_id>/<note_id>.webm  so the first path segment
-- is the owner check.
drop policy if exists "own recordings read" on storage.objects;
create policy "own recordings read" on storage.objects
  for select using (
    bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own recordings write" on storage.objects;
create policy "own recordings write" on storage.objects
  for insert with check (
    bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own recordings delete" on storage.objects;
create policy "own recordings delete" on storage.objects
  for delete using (
    bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text
  );
