begin;

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  template_key text not null default 'standard' check (char_length(template_key) between 1 and 40),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now()
);

create index groups_owner_idx on public.groups (owner_id);

create table public.game_sets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  played_on date not null,
  sequence integer not null check (sequence > 0),
  status text not null default 'in_progress' check (status in ('in_progress', 'finished')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  unique (group_id, played_on, sequence)
);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.game_sets(id) on delete cascade,
  position integer not null check (position > 0),
  mode text not null check (mode in ('normal', 'north', 'yonma')),
  scores jsonb not null default '{}'::jsonb check (jsonb_typeof(scores) = 'object'),
  unique (set_id, position)
);

alter table public.groups enable row level security;
alter table public.game_sets enable row level security;
alter table public.rounds enable row level security;

revoke all on public.groups, public.game_sets, public.rounds from public, anon, authenticated;
grant select, insert, delete on public.groups, public.game_sets, public.rounds to authenticated;
grant update (name, template_key, settings) on public.groups to authenticated;
grant update (played_on, sequence, status, details) on public.game_sets to authenticated;
grant update (position, mode, scores) on public.rounds to authenticated;

create policy groups_owner_access on public.groups
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy sets_owner_access on public.game_sets
  for all to authenticated
  using (exists (select 1 from public.groups g where g.id = game_sets.group_id and g.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.groups g where g.id = game_sets.group_id and g.owner_id = (select auth.uid())));

create policy rounds_owner_access on public.rounds
  for all to authenticated
  using (exists (
    select 1 from public.game_sets s join public.groups g on g.id = s.group_id
    where s.id = rounds.set_id and g.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.game_sets s join public.groups g on g.id = s.group_id
    where s.id = rounds.set_id and g.owner_id = (select auth.uid())
  ));

commit;
