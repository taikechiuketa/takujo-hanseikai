-- 卓上反省会専用Supabase（aexmoblpehhcqptvagxh）のSQL Editorで全文実行します。
-- 成績を削除しません。再実行可能。実行後はページを更新してください。
begin;

-- A used invitation must remain used after an account is erased.
alter table public.group_editor_invites drop constraint if exists group_editor_invites_accepted_by_fkey;
alter table public.group_editor_invites add constraint group_editor_invites_accepted_by_fkey
 foreign key(accepted_by) references auth.users(id) on delete set null;

-- Preserve a server-owned tombstone for known private players, not just UI flags.
insert into public.ranking_hidden_players(group_id,player_id,player_name)
select g.id,p.item->>'id',p.item->>'name' from public.groups g
cross join lateral jsonb_array_elements(g.sheet_players) p(item)
where p.item->>'rankingVisible'='false' and nullif(p.item->>'id','') is not null and nullif(p.item->>'name','') is not null
on conflict(group_id,player_id) do nothing;
insert into public.ranking_hidden_players(group_id,player_id,player_name)
select distinct s.group_id,'private-name:'||encode(sha256(convert_to(btrim(p.item->>'name'),'UTF8')),'hex'),btrim(p.item->>'name')
from public.game_sets s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.details->'players')='array' then s.details->'players' else '[]'::jsonb end) p(item)
where p.item->>'rankingVisible'='false' and nullif(btrim(p.item->>'name'),'') is not null
and not exists(select 1 from public.groups g cross join lateral jsonb_array_elements(g.sheet_players) m(item)
 where g.id=s.group_id and coalesce(m.item->>'rankingVisible','true')='true' and (m.item->>'id'=p.item->>'masterId' or m.item->>'name'=p.item->>'name'))
on conflict(group_id,player_id) do nothing;

create or replace function public.remember_removed_hidden_players() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.ranking_hidden_players(group_id,player_id,player_name)
 select old.id,p.item->>'id',p.item->>'name' from jsonb_array_elements(old.sheet_players) p(item)
 where p.item->>'rankingVisible'='false' and nullif(p.item->>'id','') is not null and nullif(p.item->>'name','') is not null
 on conflict(group_id,player_id) do update set player_name=excluded.player_name;
 insert into public.ranking_hidden_players(group_id,player_id,player_name)
 select new.id,p.item->>'id',p.item->>'name' from jsonb_array_elements(new.sheet_players) p(item)
 where p.item->>'rankingVisible'='false' and nullif(p.item->>'id','') is not null and nullif(p.item->>'name','') is not null
 on conflict(group_id,player_id) do update set player_name=excluded.player_name;
 insert into public.ranking_hidden_players(group_id,player_id,player_name)
 select old.id,'private-name:'||encode(sha256(convert_to(btrim(p.item->>'name'),'UTF8')),'hex'),btrim(p.item->>'name')
 from jsonb_array_elements(old.sheet_players||new.sheet_players) p(item)
 where p.item->>'rankingVisible'='false' and nullif(btrim(p.item->>'name'),'') is not null
 group by btrim(p.item->>'name')
 on conflict(group_id,player_id) do nothing;
 if new.owner_id=auth.uid() then
  delete from public.ranking_hidden_players h where h.group_id=new.id and exists(
   select 1 from jsonb_array_elements(new.sheet_players) p(item)
   where coalesce(p.item->>'rankingVisible','true')='true'
   and (p.item->>'id'=h.player_id or (h.player_id like 'private-name:%' and btrim(p.item->>'name')=h.player_name
    and not exists(select 1 from jsonb_array_elements(new.sheet_players) private(item)
     where private.item->>'rankingVisible'='false' and btrim(private.item->>'name')=h.player_name))));
 end if;
 return new;
end; $$;
revoke all on function public.remember_removed_hidden_players() from public,anon,authenticated;

-- Private helper: wrappers authorize/lock first; callers cannot invoke this directly.
create or replace function public.assert_editor_ranking_privacy(target_group uuid,players jsonb,sets jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare g public.groups; existing jsonb; incoming jsonb; saved public.game_sets; replacement jsonb;
 known_private boolean; old_private boolean; master_privacy text; existing_position bigint;
begin
 select * into g from public.groups where id=target_group;
 if g.owner_id=auth.uid() then return; end if;
 if not public.can_edit_group(target_group) then raise exception 'Group not accessible' using errcode='42501'; end if;
 if jsonb_typeof(players) is distinct from 'array' then raise exception 'Invalid players' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(players) p(item)
  where jsonb_typeof(item) is distinct from 'object' or nullif(item->>'id','') is null or nullif(btrim(item->>'name'),'') is null)
 or exists(select 1 from jsonb_array_elements(players) p(item) group by item->>'id' having count(*)>1)

 then raise exception 'Invalid or duplicate player identity' using errcode='22023'; end if;
 -- Legacy duplicate names remain saveable, but their identity/visibility order is not editable by members.
 for existing in select to_jsonb(name) from (
  select btrim(item->>'name') as name from jsonb_array_elements(players) p(item) group by btrim(item->>'name') having count(*)>1
  union select btrim(item->>'name') from jsonb_array_elements(g.sheet_players) p(item) group by btrim(item->>'name') having count(*)>1
 ) duplicate_names loop
  if (select jsonb_agg(jsonb_build_array(item->>'id',coalesce(item->>'rankingVisible','true')) order by position)
      from jsonb_array_elements(players) with ordinality p(item,position) where btrim(item->>'name')=existing#>>'{}')
    is distinct from (select jsonb_agg(jsonb_build_array(item->>'id',coalesce(item->>'rankingVisible','true')) order by position)
      from jsonb_array_elements(g.sheet_players) with ordinality p(item,position) where btrim(item->>'name')=existing#>>'{}') then
   raise exception 'Only the owner may change ambiguous player identities' using errcode='42501';
  end if;
 end loop;
 -- Existing visibility is owner-controlled. Private identities cannot be removed or renamed by editors.
 for existing in select value from jsonb_array_elements(g.sheet_players) loop
  select item into incoming from jsonb_array_elements(players) p(item) where item->>'id'=existing->>'id';
  if existing->>'rankingVisible'='false' then
   if incoming is null or incoming->>'name' is distinct from existing->>'name' or incoming->>'rankingVisible' is distinct from 'false' then
    raise exception 'Only the owner may change private player visibility or identity' using errcode='42501';
   end if;
  elsif incoming is not null and coalesce(incoming->>'rankingVisible','true') is distinct from coalesce(existing->>'rankingVisible','true') then
   raise exception 'Only the owner may change ranking visibility' using errcode='42501';
  end if;
 end loop;
 -- A deleted private player cannot be reintroduced under a different master ID using the same name.
 for incoming in select value from jsonb_array_elements(players) loop
  select exists(select 1 from public.ranking_hidden_players h where h.group_id=target_group
   and (h.player_id=incoming->>'id' or btrim(h.player_name)=btrim(incoming->>'name'))) into known_private;
  if exists(select 1 from public.ranking_hidden_players h where h.group_id=target_group
   and h.player_id=incoming->>'id' and btrim(h.player_name) is distinct from btrim(incoming->>'name')) then
   raise exception 'Only the owner may rename a private player identity' using errcode='42501';
  end if;
  if known_private and incoming->>'rankingVisible' is distinct from 'false' and not exists(
   select 1 from jsonb_array_elements(g.sheet_players) p(item) where item->>'id'=incoming->>'id'
    and item->>'name'=incoming->>'name' and coalesce(item->>'rankingVisible','true')=coalesce(incoming->>'rankingVisible','true')
    and coalesce(item->>'rankingVisible','true')='true') then
   raise exception 'Only the owner may republish a private player' using errcode='42501';
  end if;
  if not known_private and incoming->>'rankingVisible'='false' and not exists(
   select 1 from jsonb_array_elements(g.sheet_players) p(item) where item->>'id'=incoming->>'id' and item->>'rankingVisible'='false') then
   raise exception 'Only the owner may change ranking visibility' using errcode='42501';
  end if;
 end loop;
 if sets is null then return; end if;
 if jsonb_typeof(sets) is distinct from 'array' then raise exception 'Invalid set history' using errcode='22023'; end if;
 -- Private participants in an existing saved set retain their identity and position.
 -- Editors can still correct scores/chips/dates; structural changes to private history need the owner.
 for saved in select * from public.game_sets where group_id=target_group loop
  for existing,existing_position in select item,position from jsonb_array_elements(case when jsonb_typeof(saved.details->'players')='array' then saved.details->'players' else '[]'::jsonb end) with ordinality p(item,position) loop
   select existing->>'rankingVisible'='false' or exists(
    select 1 from public.ranking_hidden_players h where h.group_id=target_group and
     (h.player_id=existing->>'masterId' or h.player_id=existing->>'id' or btrim(h.player_name)=btrim(case when jsonb_typeof(existing)='string' then existing#>>'{}' else existing->>'name' end))) into old_private;
   select item into replacement from jsonb_array_elements(sets) p(item)
    where nullif(item->>'archiveId','')=coalesce(saved.details->>'archiveId',saved.id::text)
      or (nullif(item->>'archiveId','') is null and replace(item->>'date','/','-')::date=saved.played_on and (item->>'sequence')::integer=saved.sequence);
   if replacement is not null and exists(
    select 1 from jsonb_array_elements(case when jsonb_typeof(replacement->'players')='array' then replacement->'players' else '[]'::jsonb end) p(item)
    where item->>'id' is not distinct from existing->>'id' and item->>'rankingVisible' is distinct from existing->>'rankingVisible') then
    raise exception 'Only the owner may change ranking visibility' using errcode='42501';
   end if;
   if not coalesce(old_private,false) then continue; end if;
   if replacement is null or not exists(
    select 1 from jsonb_array_elements(case when jsonb_typeof(replacement->'players')='array' then replacement->'players' else '[]'::jsonb end) p(item)
    where (item->>'id' is not distinct from existing->>'id' or (jsonb_typeof(existing)='string' and item->>'id'=(existing_position-1)::text))
      and item->>'masterId' is not distinct from existing->>'masterId'
      and (case when jsonb_typeof(item)='string' then item#>>'{}' else item->>'name' end) is not distinct from (case when jsonb_typeof(existing)='string' then existing#>>'{}' else existing->>'name' end)
      and item->>'rankingVisible' is not distinct from existing->>'rankingVisible') then
     raise exception 'Only the owner may change private history identities' using errcode='42501';
   end if;
  end loop;
 end loop;
 -- Set-local flags may not override a known private identity or a deleted-master tombstone.
 for replacement in select value from jsonb_array_elements(sets) loop
  for incoming in select value from jsonb_array_elements(case when jsonb_typeof(replacement->'players')='array' then replacement->'players' else '[]'::jsonb end) loop
   select exists(select 1 from public.ranking_hidden_players h where h.group_id=target_group and
    (h.player_id=incoming->>'masterId' or h.player_id=incoming->>'id' or btrim(h.player_name)=btrim(case when jsonb_typeof(incoming)='string' then incoming#>>'{}' else incoming->>'name' end))) into known_private;
   select m.item->>'rankingVisible' into master_privacy from jsonb_array_elements(players) with ordinality m(item,position)
    where m.item->>'id'=incoming->>'masterId' or m.item->>'name'=(case when jsonb_typeof(incoming)='string' then incoming#>>'{}' else incoming->>'name' end)
    order by (m.item->>'id'=incoming->>'masterId') desc nulls last,m.position limit 1;
   -- The fallback below intentionally mirrors anonymous SQL's exact name match.
   -- Trimming it would allow a new whitespace alias that the public query does not hide.
   if known_private and coalesce(master_privacy,incoming->>'rankingVisible','true')<>'false'
     and not exists(select 1 from public.ranking_hidden_players h where h.group_id=target_group and
      (h.player_id=incoming->>'masterId' or (nullif(incoming->>'masterId','') is null and h.player_name=(case when jsonb_typeof(incoming)='string' then incoming#>>'{}' else incoming->>'name' end))))
     and not exists(select 1 from jsonb_array_elements(g.sheet_players) m(item)
      where m.item->>'id'=incoming->>'masterId' and coalesce(m.item->>'rankingVisible','true')='true'
       and not exists(select 1 from public.ranking_hidden_players h where h.group_id=target_group and h.player_id=m.item->>'id')) then
    raise exception 'Only the owner may republish a private player' using errcode='42501';
   end if;
   if not known_private and incoming->>'rankingVisible'='false' and not exists(
    select 1 from public.game_sets s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.details->'players')='array' then s.details->'players' else '[]'::jsonb end) p(item)
    where s.group_id=target_group and item->>'id'=incoming->>'id' and item->>'masterId' is not distinct from incoming->>'masterId'
      and item->>'name' is not distinct from incoming->>'name' and item->>'rankingVisible'='false') then
    raise exception 'Only the owner may change ranking visibility' using errcode='42501';
   end if;
  end loop;
 end loop;
end; $$;
revoke all on function public.assert_editor_ranking_privacy(uuid,jsonb,jsonb) from public,anon,authenticated;


create or replace function public.record_private_history_players(target_group uuid,players jsonb) returns void
language sql security definer set search_path='' as $$
 insert into public.ranking_hidden_players(group_id,player_id,player_name)
 select distinct target_group,'private-name:'||encode(sha256(convert_to(btrim(p.item->>'name'),'UTF8')),'hex'),btrim(p.item->>'name')
 from public.game_sets s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.details->'players')='array' then s.details->'players' else '[]'::jsonb end) p(item)
 where s.group_id=target_group and p.item->>'rankingVisible'='false' and nullif(btrim(p.item->>'name'),'') is not null
 and not exists(select 1 from jsonb_array_elements(players) m(item)
  where coalesce(m.item->>'rankingVisible','true')='true' and (m.item->>'id'=p.item->>'masterId' or m.item->>'name'=p.item->>'name'))
 on conflict(group_id,player_id) do nothing;
$$;
revoke all on function public.record_private_history_players(uuid,jsonb) from public,anon,authenticated;

create or replace function public.save_sheet_workspace(
  target_group uuid, expected_revision uuid, request_id uuid, draft jsonb, players jsonb, sets jsonb
) returns uuid
language plpgsql
security definer
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
  from public.groups where id = target_group for update;
  if not found or not public.can_edit_group(target_group) then raise exception 'Group not accessible' using errcode = '42501'; end if;
  if request_id is null then raise exception 'Request ID required' using errcode='22023'; end if;
  if revision = request_id then return revision; end if;
  if revision is distinct from expected_revision then
    raise exception 'Workspace changed' using errcode = '40001';
  end if;
  if jsonb_typeof(draft) is distinct from 'object'
    or jsonb_typeof(players) is distinct from 'array'
    or jsonb_typeof(sets) is distinct from 'array'
  then raise exception 'Invalid workspace'; end if;

  perform public.assert_editor_ranking_privacy(target_group,players,sets);

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
  perform public.record_private_history_players(target_group,players);
  update public.groups set sheet_revision = request_id, sheet_draft = draft, sheet_players = players
  where id = target_group;
  insert into public.group_edit_activity(request_id,group_id,user_id,kind) values(request_id,target_group,auth.uid(),'workspace');
  return request_id;
end;
$$;


create or replace function public.save_sheet_players(target_group uuid,expected_revision uuid,request_id uuid,players jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare revision uuid;
begin
 select sheet_revision into revision from public.groups where id=target_group for update;
 if not found or not public.can_edit_group(target_group) then raise exception 'Group not accessible' using errcode='42501'; end if;
 if request_id is null or jsonb_typeof(players) is distinct from 'array' then raise exception 'Invalid players' using errcode='22023'; end if;
 if revision=request_id then return revision; end if;
 if revision is distinct from expected_revision then raise exception 'Workspace changed' using errcode='40001'; end if;
 perform public.assert_editor_ranking_privacy(target_group,players,null);
 update public.groups set sheet_revision=request_id,sheet_players=players where id=target_group;
 insert into public.group_edit_activity(request_id,group_id,user_id,kind) values(request_id,target_group,auth.uid(),'players');
 return request_id;
end; $$;

create or replace function public.release_schema_version() returns text
language sql stable set search_path='' as $$ select '2026-11-17.1'::text $$;
revoke all on function public.release_schema_version() from public;
grant execute on function public.release_schema_version() to anon,authenticated;

commit;
notify pgrst, 'reload schema';
