create or replace function public.get_shared_set(share_token uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'group', g.name,
    'date', s.played_on,
    'sequence', s.sequence,
    'rate', s.details->'rate',
    'chipRate', s.details->'chipRate',
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', case when jsonb_typeof(p.item) = 'string' then p.item #>> '{}' else p.item->>'name' end,
        'chips', p.item->>'chips'
      ) order by p.pos)
      from jsonb_array_elements(s.details->'players') with ordinality p(item, pos)
    ), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mode', r.mode,
        'scores', (select jsonb_agg(
          r.scores -> coalesce(p.item->>'id', (p.pos - 1)::text) order by p.pos
        ) from jsonb_array_elements(s.details->'players') with ordinality p(item, pos))
      ) order by r.position)
      from public.rounds r where r.set_id = s.id
    ), '[]'::jsonb)
  )
  from public.set_shares h
  join public.game_sets s on s.id = h.set_id
  join public.groups g on g.id = s.group_id
  where h.token = share_token and s.status = 'finished';
$$;
