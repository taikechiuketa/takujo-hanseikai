begin;

create table public.ranking_hidden_players (
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id text not null,
  player_name text not null,
  primary key (group_id, player_id)
);
alter table public.ranking_hidden_players enable row level security;
revoke all on public.ranking_hidden_players from public, anon, authenticated;

create function public.remember_removed_hidden_players() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ranking_hidden_players (group_id, player_id, player_name)
  select old.id, p.item->>'id', p.item->>'name'
  from jsonb_array_elements(old.sheet_players) p(item)
  where p.item->>'rankingVisible' = 'false'
    and p.item->>'id' is not null and p.item->>'name' is not null
    and not exists (
      select 1 from jsonb_array_elements(new.sheet_players) n(item)
      where n.item->>'id' = p.item->>'id'
    )
  on conflict (group_id, player_id) do update set player_name = excluded.player_name;

  delete from public.ranking_hidden_players h
  where h.group_id = new.id and exists (
    select 1 from jsonb_array_elements(new.sheet_players) p(item)
    where p.item->>'id' = h.player_id and p.item->>'rankingVisible' = 'true'
  );
  return new;
end;
$$;
revoke all on function public.remember_removed_hidden_players() from public, anon, authenticated;

create trigger preserve_removed_hidden_players
after update of sheet_players on public.groups
for each row when (old.sheet_players is distinct from new.sheet_players)
execute function public.remember_removed_hidden_players();

create or replace function public.save_sheet_workspace(
  target_group uuid, expected_revision uuid, request_id uuid, draft jsonb, players jsonb, sets jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  revision uuid;
  entry jsonb;
  saved_id uuid;
  retained_ids uuid[] := array[]::uuid[];
  archive_key text;
  new_date date;
  new_sequence integer;
begin
  select sheet_revision into revision
  from public.groups where id = target_group and owner_id = (select auth.uid()) for update;
  if not found then raise exception 'Group not accessible' using errcode = '42501'; end if;
  if revision = request_id then return revision; end if;
  if revision is distinct from expected_revision then
    raise exception 'Workspace changed' using errcode = '40001';
  end if;
  if jsonb_typeof(draft) is distinct from 'object'
    or jsonb_typeof(players) is distinct from 'array'
    or jsonb_typeof(sets) is distinct from 'array'
  then raise exception 'Invalid workspace'; end if;

  -- Validate identities before changing rows. Old backups can omit archiveId.
  if exists (
    select 1 from jsonb_array_elements(sets) as entries(item)
    where jsonb_typeof(item->'rounds') is distinct from 'array'
      or nullif(item->>'date', '') is null
      or coalesce((item->>'sequence')::integer, 0) < 1
  ) then raise exception 'Invalid set history'; end if;

  -- Remove only sets the submitted workspace no longer contains.
  delete from public.game_sets existing
  where existing.group_id = target_group and not exists (
    select 1 from jsonb_array_elements(sets) as entries(item)
    where coalesce(existing.details->>'archiveId', existing.id::text) = nullif(item->>'archiveId', '')
      or (
        nullif(item->>'archiveId', '') is null
        and existing.played_on = replace(item->>'date', '/', '-')::date
        and existing.sequence = (item->>'sequence')::integer
      )
  );

  for entry in select value from jsonb_array_elements(sets)
  loop
    archive_key := nullif(entry->>'archiveId', '');
    new_date := replace(entry->>'date', '/', '-')::date;
    new_sequence := (entry->>'sequence')::integer;
    select id into saved_id from public.game_sets
    where group_id = target_group and (
      coalesce(details->>'archiveId', id::text) = archive_key
      or (archive_key is null and played_on = new_date and sequence = new_sequence)
    );
    if saved_id is null then
      insert into public.game_sets (group_id, played_on, sequence, status, details)
      values (target_group, new_date, new_sequence, 'finished', entry - 'rounds')
      returning id into saved_id;
    else
      -- A legacy restore can match by number without proving set identity.
      if archive_key is null then
        delete from public.set_shares where set_id = saved_id;
      end if;
      update public.game_sets
      set played_on = new_date, sequence = new_sequence, status = 'finished',
          details = entry - 'rounds'
      where id = saved_id and (played_on, sequence, status, details)
        is distinct from (new_date, new_sequence, 'finished'::text, entry - 'rounds');
    end if;
    if saved_id = any(retained_ids) then raise exception 'Duplicate set identity'; end if;
    retained_ids := array_append(retained_ids, saved_id);

    delete from public.rounds r
    where r.set_id = saved_id and r.position > jsonb_array_length(entry->'rounds');

    -- Keep the IDs of existing half-round positions as well.
    insert into public.rounds as existing (set_id, position, mode, scores)
    select saved_id, ordinal::integer, item->>'mode', item->'scores'
    from jsonb_array_elements(entry->'rounds') with ordinality as round(item, ordinal)
    on conflict (set_id, position) do update
    set mode = excluded.mode, scores = excluded.scores
    where (existing.mode, existing.scores) is distinct from (excluded.mode, excluded.scores);
  end loop;
  update public.groups set sheet_revision = request_id, sheet_draft = draft, sheet_players = players
  where id = target_group;
  return request_id;
end;
$$;

create or replace function public.get_shared_group_ranking(share_token uuid, target_month date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with selected_group as (
    select g.id, g.name, g.sheet_players
    from public.group_ranking_shares h join public.groups g on g.id = h.group_id
    where h.token = share_token
  ), finished_sets as (
    select s.*
    from public.game_sets s join selected_group g on g.id = s.group_id
    where s.status = 'finished'
  ), played as (
    select coalesce(nullif(p.item->>'masterId', ''), m.item->>'id', 'name:' || n.name) as player_key,
      coalesce(m.item->>'name', n.name) as name,
      s.played_on, s.sequence, score.value::numeric as points
    from finished_sets s
    join selected_group g on g.id = s.group_id
    join public.rounds r on r.set_id = s.id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(s.details->'players') = 'array' then s.details->'players' else '[]'::jsonb end
    ) with ordinality p(item, position)
    cross join lateral (select case when jsonb_typeof(p.item) = 'string'
      then p.item #>> '{}' else p.item->>'name' end as name) n
    left join lateral (
      select entry.item
      from jsonb_array_elements(g.sheet_players) with ordinality entry(item, position)
      where entry.item->>'id' = p.item->>'masterId' or entry.item->>'name' = n.name
      order by (entry.item->>'id' = p.item->>'masterId') desc nulls last, entry.position
      limit 1
    ) m on true
    cross join lateral (select r.scores->>coalesce(p.item->>'id', (p.position - 1)::text) as value) score
    where (target_month is null or (
      s.played_on >= target_month and s.played_on < target_month + interval '1 month'
    ))
      and coalesce(m.item->>'rankingVisible', p.item->>'rankingVisible', 'true') <> 'false'
      and not exists (
        select 1 from public.ranking_hidden_players hidden
        where hidden.group_id = g.id and (
          hidden.player_id = p.item->>'masterId'
          or (nullif(p.item->>'masterId', '') is null and hidden.player_name = n.name)
        )
      )
      and n.name is not null and score.value ~ '^-?[0-9]{1,16}$'
  ), totals as (
    select (array_agg(name order by played_on desc, sequence desc, name))[1] as name,
      sum(points) as points, count(*) as rounds
    from played group by player_key
  ), ranked as (
    select rank() over (order by points desc) as rank, name, points, rounds from totals
  )
  select jsonb_build_object(
    'group', g.name,
    'months', coalesce((select jsonb_agg(month order by month desc)
      from (select distinct to_char(played_on, 'YYYY-MM') as month from finished_sets) months), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'rank', rank, 'name', name, 'points', points, 'rounds', rounds
    ) order by rank, name) from ranked), '[]'::jsonb)
  ) from selected_group g;
$$;


commit;
