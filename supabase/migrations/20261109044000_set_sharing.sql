begin;

create table public.set_shares (
  set_id uuid primary key references public.game_sets(id) on delete cascade,
  token uuid not null unique default gen_random_uuid()
);
alter table public.set_shares enable row level security;
revoke all on public.set_shares from public, anon, authenticated;
grant select, insert, delete on public.set_shares to authenticated;

create policy set_shares_owner_access on public.set_shares
  for all to authenticated
  using (exists (select 1 from public.game_sets s where s.id = set_shares.set_id))
  with check (exists (select 1 from public.game_sets s where s.id = set_shares.set_id));

create function public.get_shared_set(share_token uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'group', g.name,
    'date', s.played_on,
    'sequence', s.sequence,
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
revoke all on function public.get_shared_set(uuid) from public, anon, authenticated;
grant execute on function public.get_shared_set(uuid) to anon, authenticated;

commit;
