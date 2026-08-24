-- Personal Besties Running Coach - Supabase schema (with auth & roles)
-- Run in Supabase Dashboard -> SQL Editor.
-- Then: set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env
-- and deploy the edge functions in supabase/functions/.
--
-- Roles: the FIRST user to sign up becomes the coach, everyone after
-- is an athlete (handled by the on_auth_user_created trigger).

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'athlete' check (role in ('coach','athlete')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles readable by authenticated" on public.profiles
  for select to authenticated using (true);
create policy "profiles own update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when not exists (select 1 from public.profiles) then 'coach' else 'athlete' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_coach()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'coach');
$$;

create table if not exists public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  athlete_name text not null,
  date date not null,
  type text not null check (type in ('easy','interval','tempo','long','strength','rest')),
  title text not null,
  duration_min int,
  status text not null default 'planned' check (status in ('planned','completed','missed','moved')),
  move_count int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  athlete_name text not null,
  session_title text not null,
  session_type text not null,
  from_date date not null,
  to_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

create index if not exists idx_sessions_date on public.training_sessions(date);
create index if not exists idx_sessions_athlete on public.training_sessions(athlete_id);
create index if not exists idx_requests_status on public.change_requests(status);

alter table public.training_sessions enable row level security;
alter table public.change_requests enable row level security;

drop policy if exists "sessions read" on public.training_sessions;
create policy "sessions read" on public.training_sessions
  for select to authenticated using (true);

drop policy if exists "sessions insert" on public.training_sessions;
create policy "sessions insert" on public.training_sessions
  for insert to authenticated
  with check (athlete_id = auth.uid() or public.is_coach());

drop policy if exists "sessions update" on public.training_sessions;
create policy "sessions update" on public.training_sessions
  for update to authenticated
  using (athlete_id = auth.uid() or public.is_coach())
  with check (athlete_id = auth.uid() or public.is_coach());

drop policy if exists "sessions delete" on public.training_sessions;
create policy "sessions delete" on public.training_sessions
  for delete to authenticated using (public.is_coach());

drop policy if exists "requests read" on public.change_requests;
create policy "requests read" on public.change_requests
  for select to authenticated using (athlete_id = auth.uid() or public.is_coach());

drop policy if exists "requests insert" on public.change_requests;
create policy "requests insert" on public.change_requests
  for insert to authenticated
  with check (athlete_id = auth.uid() or public.is_coach());

drop policy if exists "requests update" on public.change_requests;
create policy "requests update" on public.change_requests
  for update to authenticated
  using (athlete_id = auth.uid() or public.is_coach())
  with check (athlete_id = auth.uid() or public.is_coach());
