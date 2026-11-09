begin;

create or replace function public.get_shared_group_stats(share_token uuid, target_month date, target_mode text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  payload jsonb;
  settings jsonb;
  ratings jsonb := '{}'::jsonb;
  rating_rows jsonb;
  game jsonb;
  player jsonb;
  old_entry jsonb;
  rating_key text;
  previous numeric;
  updated numeric;
begin
  with selected_group as (
    select g.id, g.name, g.sheet_players, h.options
    from public.group_ranking_shares h join public.groups g on g.id=h.group_id
    where h.token=share_token
  ), all_sets as (
    select s.* from public.game_sets s join selected_group g on g.id=s.group_id where s.status='finished'
  ), finished_sets as (
    select * from all_sets where target_month is null or
      (played_on >= target_month and played_on < target_month + interval '1 month')
  ), played as (
    select coalesce(nullif(p.item->>'masterId', ''), m.item->>'id', 'name:' || n.name) as player_key,
      coalesce(m.item->>'name', n.name) as name,
      s.id as set_id, r.position, case when r.mode in ('north','yonma') then r.mode else 'normal' end as mode, s.played_on, s.sequence, score.value::numeric as points,
      coalesce(p.item->>'chips','0') as chips, s.details->>'rate' as rate, s.details->>'chipRate' as chip_rate,
      coalesce(m.item->>'rankingVisible', p.item->>'rankingVisible', 'true') <> 'false'
      and not exists (select 1 from public.ranking_hidden_players hidden where hidden.group_id=g.id
        and (hidden.player_id=p.item->>'masterId' or (nullif(p.item->>'masterId','') is null and hidden.player_name=n.name))) as visible
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
    where n.name is not null and score.value ~ '^-?[0-9]{1,16}$'
      and (target_mode = 'all' or (case when r.mode in ('north','yonma') then r.mode else 'normal' end) = target_mode)
  ), placements as (
    select *, rank() over (partition by set_id, position order by points desc) as place,
      count(*) over (partition by set_id, position) as size,
      count(*) over (partition by set_id, position, player_key) as duplicates,
      min(points) over (partition by set_id, position) as low_score
    from played
  ), set_totals as (
    select player_key, set_id, played_on, sequence, sum(points) as points,
      max(case when chips ~ '^-?[0-9]{1,16}$' and (target_mode='all' or not exists (
        select 1 from public.rounds other_round
        where other_round.set_id=played.set_id
          and (case when other_round.mode in ('north','yonma') then other_round.mode else 'normal' end)<>target_mode
          and exists (select 1 from jsonb_each_text(other_round.scores) score where score.value ~ '^-?[0-9]{1,16}$')
      )) then chips::numeric else 0 end) as chips,
      max(case when rate ~ '^[0-9]{1,16}(\.[0-9]{1,8})?$' then rate::numeric else 0 end) as rate,
      max(case when chip_rate ~ '^[0-9]{1,16}(\.[0-9]{1,8})?$' then chip_rate::numeric else 0 end) as chip_rate
    from played where visible group by player_key,set_id,played_on,sequence
  ), personal_progress as (
    select player_key,played_on,sequence,set_id,
      sum(points) over w as points,sum(chips) over w as chips,
      sum(points*rate+chips*chip_rate) over w as balance
    from set_totals
    window w as (partition by player_key order by played_on,sequence,set_id)
  ), finance as (
    select player_key, count(*) as sets, sum(chips) as chips, sum(points*rate+chips*chip_rate) as balance
    from set_totals group by player_key
  ), summary as (
    select p.player_key, (array_agg(p.name order by p.played_on desc,p.sequence desc,p.position desc))[1] as name,
      sum(p.points) as points,count(*) as rounds,
      count(*) filter (where size=case when mode='normal' then 3 else 4 end) as ranked,
      count(*) filter (where place=1 and size=case when mode='normal' then 3 else 4 end) as firsts,
      count(*) filter (where place=2 and size=case when mode='normal' then 3 else 4 end) as seconds,
      count(*) filter (where place=3 and size=case when mode='normal' then 3 else 4 end) as thirds,
      count(*) filter (where place=4 and size=case when mode='normal' then 3 else 4 end) as fourths,
      count(*) filter (where points=low_score and size=case when mode='normal' then 3 else 4 end) as lasts
    from placements p where visible group by p.player_key
  ), metrics as (
    select s.*, jsonb_build_object('points',s.points,'rounds',s.rounds,'sets',f.sets,
      'chips',f.chips,'balance',f.balance,'top',round(100.0*firsts/nullif(ranked,0),1),
      'topTwo',round(100.0*(firsts+seconds)/nullif(ranked,0),1),
      'last',round(100.0*lasts/nullif(ranked,0),1),'placements',jsonb_build_array(firsts,seconds,thirds,fourths),
      'averagePoints',round(s.points/s.rounds,2),
      'averagePlace',round((firsts+2.0*seconds+3.0*thirds+4.0*fourths)/nullif(ranked,0),2)) as values
    from summary s join finance f using(player_key)
  ), opponents as (
    select a.player_key, b.player_key as opponent_key,count(*) as rounds,
      count(*) filter(where a.points>b.points) as wins,count(*) filter(where a.points<b.points) as losses,
      count(*) filter(where a.points=b.points) as ties,round(avg(a.points),2) as average_points
    from placements a join placements b using(set_id,position)
    where a.visible and b.visible and a.player_key<>b.player_key and a.size=case when a.mode='normal' then 3 else 4 end
      and not exists (select 1 from placements c where c.set_id=a.set_id and c.position=a.position and c.duplicates>1)
    group by a.player_key,b.player_key
  ), totals as (
    select m.*, rank() over(order by points desc) as rank from metrics m
  )
  select g.options, jsonb_build_object(
    'group',g.name,
    'months',coalesce((select jsonb_agg(month order by month desc) from
      (select distinct to_char(played_on,'YYYY-MM') as month from all_sets) dates),'[]'::jsonb),
    'options',g.options,
    'totals',case when jsonb_array_length(g.options->'totals')>0 then coalesce((
      select jsonb_agg(jsonb_build_object('name',t.name) ||
        case when (g.options->'totals') ? 'points' then jsonb_build_object('rank',t.rank) else '{}'::jsonb end ||
        coalesce((select jsonb_object_agg(key,value) from jsonb_each(t.values) where (g.options->'totals') ? key),'{}'::jsonb)
        order by case when (g.options->'totals') ? 'points' then t.rank else 0 end,t.name) from totals t),'[]'::jsonb) end,
    'personal',case when jsonb_array_length(g.options->'personal')>0 then coalesce((
      select jsonb_agg(jsonb_build_object('name',m.name) ||
        coalesce((select jsonb_object_agg(key,value) from jsonb_each(m.values) where (g.options->'personal') ? key),'{}'::jsonb) ||
        case when target_mode='all' and (g.options->'personal') ?| array['points','chips','balance']
          then jsonb_build_object('progress',coalesce((
            select jsonb_agg(jsonb_build_object('date',p.played_on) ||
              case when (g.options->'personal') ? 'points' then jsonb_build_object('points',p.points) else '{}'::jsonb end ||
              case when (g.options->'personal') ? 'chips' then jsonb_build_object('chips',p.chips) else '{}'::jsonb end ||
              case when (g.options->'personal') ? 'balance' then jsonb_build_object('balance',p.balance) else '{}'::jsonb end
              order by p.played_on,p.sequence,p.set_id) from personal_progress p where p.player_key=m.player_key
          ),'[]'::jsonb)) else '{}'::jsonb end ||
        case when (g.options->'personal') ? 'opponents' then jsonb_build_object('opponents',coalesce((
          select jsonb_agg(jsonb_build_object('name',other.name,'rounds',o.rounds,'wins',o.wins,'losses',o.losses,
            'ties',o.ties,'winRate',round(100.0*o.wins/o.rounds,1)) ||
            case when (g.options->'personal') ? 'averagePoints' then jsonb_build_object('averagePoints',o.average_points) else '{}'::jsonb end
            order by o.rounds desc,other.name) from opponents o join metrics other on other.player_key=o.opponent_key
          where o.player_key=m.player_key),'[]'::jsonb)) else '{}'::jsonb end
        order by m.name) from metrics m),'[]'::jsonb) end,
    'games',case when jsonb_array_length(g.options->'rating')>0 then coalesce((
      select jsonb_agg(players order by played_on,sequence,position,set_id) from (
        select set_id,played_on,sequence,position, jsonb_agg(jsonb_build_object(
          'id',player_key,'name',name,'visible',visible,'points',points,'date',played_on)) as players
        from played group by set_id,played_on,sequence,position,mode
        having count(*)=case when mode='normal' then 3 else 4 end and count(distinct player_key)=count(*) and sum(points)=0
      ) games),'[]'::jsonb) end
  ) into settings,payload from selected_group g;
  if payload is null then return null; end if;
  if jsonb_typeof(payload->'games')='array' then
    for game in select value from jsonb_array_elements(payload->'games') loop
      old_entry := ratings;
      for player in select value from jsonb_array_elements(game) loop
        rating_key := player->>'id';
        previous := coalesce((old_entry->rating_key->>'rating')::numeric,1500);
        select previous + sum(24 * ((case when (player->>'points')::numeric=(other->>'points')::numeric then 0.5
          when (player->>'points')::numeric>(other->>'points')::numeric then 1 else 0 end) -
          1/(1+power(10::numeric,(coalesce((old_entry->(other->>'id')->>'rating')::numeric,1500)-previous)/400)))
          /(jsonb_array_length(game)-1))
        into updated from jsonb_array_elements(game) as others(other) where other->>'id'<>rating_key;
        ratings := jsonb_set(ratings,array[rating_key],jsonb_build_object('name',player->>'name',
          'visible',player->'visible','rating',updated,'change',round(updated)-round(previous),
          'ratingRounds',coalesce((old_entry->rating_key->>'ratingRounds')::integer,0)+1,
          'trend',case when (settings->'rating') ? 'trend' and (settings->'rating') ? 'rating'
            then coalesce(old_entry->rating_key->'trend','[]'::jsonb) ||
              jsonb_build_object('date',player->>'date','rating',round(updated),'before',round(previous)) else null end));
      end loop;
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('name',entry->>'name') ||
      coalesce((select jsonb_object_agg(key,case when key='rating' then to_jsonb(round((value#>>'{}')::numeric)) else value end)
        from jsonb_each(entry) where (settings->'rating') ? key and key in ('rating','ratingRounds','change','trend')
          and (key not in ('trend','change') or (settings->'rating') ? 'rating')),'{}'::jsonb)
      order by case when (settings->'rating') ? 'rating' then (entry->>'rating')::numeric else 0 end desc,entry->>'name'),'[]'::jsonb)
    into rating_rows from jsonb_each(ratings) as players(id,entry) where (entry->>'visible')::boolean;
    payload := payload || jsonb_build_object('rating',rating_rows);
  end if;
  return payload - 'games';
end;
$$;

commit;
