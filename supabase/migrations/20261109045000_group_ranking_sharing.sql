begin;

create table public.group_ranking_shares (
  group_id uuid primary key references public.groups(id) on delete cascade,
  token uuid not null unique default gen_random_uuid()
);

alter table public.group_ranking_shares enable row level security;
revoke all on public.group_ranking_shares from public, anon, authenticated;
grant select, insert, delete on public.group_ranking_shares to authenticated;

create policy ranking_shares_owner_access on public.group_ranking_shares
  for all to authenticated
  using (exists (
    select 1 from public.groups g
    where g.id = group_ranking_shares.group_id and g.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.groups g
    where g.id = group_ranking_shares.group_id and g.owner_id = (select auth.uid())
  ));

create function public.get_shared_group_ranking(share_token uuid, target_month date)
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

revoke all on function public.get_shared_group_ranking(uuid, date) from public, anon, authenticated;
grant execute on function public.get_shared_group_ranking(uuid, date) to anon, authenticated;

commit;
