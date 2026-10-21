create extension if not exists pgcrypto;

create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'invitee' check (role in ('owner', 'invitee')),
  created_at timestamptz not null default now()
);

create table public.team_people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 70),
  email text not null check (char_length(email) <= 254),
  role text not null check (char_length(role) between 1 and 50),
  salary numeric(12, 2) not null default 0 check (salary >= 0),
  points integer not null default 0 check (points >= 0),
  money numeric(12, 2) not null default 0 check (money >= 0),
  paid_week text,
  user_id uuid unique references auth.users (id) on delete set null,
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index team_people_email_lower_unique on public.team_people (lower(email));

create table public.team_activity (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  person_id uuid references public.team_people (id) on delete set null,
  person_name text not null,
  kind text not null check (kind in ('points', 'money', 'salary')),
  amount numeric(12, 2) not null check (amount >= 0),
  note text not null default '',
  created_at timestamptz not null default now()
);

create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.team_people (id) on delete cascade,
  requester_id uuid not null references auth.users (id) on delete cascade,
  field text not null check (field in ('points', 'money', 'role', 'name')),
  requested_value text not null default '' check (char_length(requested_value) <= 120),
  message text not null check (char_length(message) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'under_review', 'resolved')),
  created_at timestamptz not null default now()
);

create table public.appeal_comments (
  id uuid primary key default gen_random_uuid(),
  appeal_id uuid not null references public.appeals (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index appeals_person_created_idx on public.appeals (person_id, created_at desc);
create index appeal_comments_appeal_created_idx on public.appeal_comments (appeal_id, created_at);

create function public.is_workspace_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = (select auth.uid())
      and role = 'owner'
  );
$$;

create function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, role)
  values (new.id, 'invitee')
  on conflict (id) do nothing;

  if new.email is not null then
    update public.team_people
    set user_id = new.id,
        accepted_at = case
          when new.email_confirmed_at is not null then coalesce(accepted_at, now())
          else accepted_at
        end
    where lower(email) = lower(new.email)
      and invited_at is not null
      and (user_id is null or user_id = new.id);
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created_goodwork
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.create_profile_for_auth_user();

insert into public.user_profiles (id, role)
select id, 'invitee' from auth.users
on conflict (id) do nothing;

alter table public.user_profiles enable row level security;
alter table public.team_people enable row level security;
alter table public.team_activity enable row level security;
alter table public.appeals enable row level security;
alter table public.appeal_comments enable row level security;

create policy "Users can read their own profile"
  on public.user_profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Owners can read and manage team people"
  on public.team_people for all to authenticated
  using ((select public.is_workspace_owner()))
  with check ((select public.is_workspace_owner()));

create policy "Invitees can read their own team record"
  on public.team_people for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Owners can manage team activity"
  on public.team_activity for all to authenticated
  using ((select public.is_workspace_owner()))
  with check (
    (select public.is_workspace_owner())
    and owner_id = (select auth.uid())
  );

create policy "Owners and record owners can read appeals"
  on public.appeals for select to authenticated
  using (
    (select public.is_workspace_owner())
    or exists (
      select 1
      from public.team_people
      where team_people.id = appeals.person_id
        and team_people.user_id = (select auth.uid())
    )
  );

create policy "Invitees can create their own appeals"
  on public.appeals for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and exists (
      select 1
      from public.team_people
      where team_people.id = appeals.person_id
        and team_people.user_id = (select auth.uid())
    )
  );

create policy "Owners can update appeal status"
  on public.appeals for update to authenticated
  using ((select public.is_workspace_owner()))
  with check ((select public.is_workspace_owner()));

create policy "Owners and appeal participants can read comments"
  on public.appeal_comments for select to authenticated
  using (
    (select public.is_workspace_owner())
    or exists (
      select 1
      from public.appeals
      join public.team_people on team_people.id = appeals.person_id
      where appeals.id = appeal_comments.appeal_id
        and team_people.user_id = (select auth.uid())
    )
  );

create policy "Owners and appeal participants can comment"
  on public.appeal_comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (select public.is_workspace_owner())
      or exists (
        select 1
        from public.appeals
        join public.team_people on team_people.id = appeals.person_id
        where appeals.id = appeal_comments.appeal_id
          and team_people.user_id = (select auth.uid())
      )
    )
  );

grant select on public.user_profiles to authenticated;
grant select, insert, update, delete on public.team_people to authenticated;
grant select, insert, update, delete on public.team_activity to authenticated;
grant select, insert, update, delete on public.appeals to authenticated;
grant select, insert, update, delete on public.appeal_comments to authenticated;
