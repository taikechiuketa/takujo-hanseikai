begin;

create function public.save_game_set(
  target_group uuid, request_id uuid, game_date date, player_names jsonb, game_rounds jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_id uuid;
  next_number integer;
begin
  -- Serialize numbering within the same group and enforce ownership before writing.
  perform 1 from public.groups
  where id = target_group and owner_id = (select auth.uid())
  for update;
  if not found then
    raise exception 'Group not accessible' using errcode = '42501';
  end if;

  select id into saved_id from public.game_sets
  where id = request_id and group_id = target_group;
  if found then return saved_id; end if;

  if jsonb_typeof(player_names) is distinct from 'array'
    or jsonb_array_length(player_names) not between 3 and 4
    or jsonb_typeof(game_rounds) is distinct from 'array'
    or jsonb_array_length(game_rounds) not between 1 and 100
  then
    raise exception 'Invalid game set';
  end if;

  select coalesce(max(sequence), 0) + 1 into next_number
  from public.game_sets where group_id = target_group and played_on = game_date;

  insert into public.game_sets (id, group_id, played_on, sequence, status, details)
  values (request_id, target_group, game_date, next_number, 'finished', jsonb_build_object('players', player_names));

  insert into public.rounds (set_id, position, mode, scores)
  select request_id, ordinal, item->>'mode', item->'scores'
  from jsonb_array_elements(game_rounds) with ordinality as entry(item, ordinal);

  return request_id;
end;
$$;

revoke all on function public.save_game_set(uuid, uuid, date, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_game_set(uuid, uuid, date, jsonb, jsonb) to authenticated;

commit;
