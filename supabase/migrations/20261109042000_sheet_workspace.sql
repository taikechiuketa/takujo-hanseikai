begin;

alter table public.groups
  add column sheet_revision uuid,
  add column sheet_draft jsonb,
  add column sheet_players jsonb not null default '[]'::jsonb;

create function public.save_sheet_workspace(
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

  delete from public.game_sets where group_id = target_group;
  for entry in select value from jsonb_array_elements(sets)
  loop
    insert into public.game_sets (group_id, played_on, sequence, status, details)
    values (target_group, replace(entry->>'date','/','-')::date, (entry->>'sequence')::integer,
            'finished', entry - 'rounds')
    returning id into saved_id;
    insert into public.rounds (set_id, position, mode, scores)
    select saved_id, ordinal::integer, item->>'mode', item->'scores'
    from jsonb_array_elements(entry->'rounds') with ordinality as round(item, ordinal);
  end loop;
  update public.groups set sheet_revision = request_id, sheet_draft = draft, sheet_players = players
  where id = target_group;
  return request_id;
end;
$$;

grant update (sheet_revision, sheet_draft, sheet_players) on public.groups to authenticated;
revoke all on function public.save_sheet_workspace(uuid, uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_sheet_workspace(uuid, uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

-- The former simplified editor must not write outside the workspace revision.
do $$
begin
  if to_regprocedure('public.save_game_set(uuid,uuid,date,jsonb,jsonb)') is not null then
    revoke execute on function public.save_game_set(uuid,uuid,date,jsonb,jsonb) from authenticated;
  end if;
end;
$$;

commit;
