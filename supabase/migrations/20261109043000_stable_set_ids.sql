begin;

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

commit;
