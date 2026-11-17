begin;

-- Owners remain the sole group administrators. Editors are explicitly invited accounts.
create table if not exists public.group_members (
 group_id uuid not null references public.groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(group_id,user_id)
);
create index if not exists group_members_user_idx on public.group_members(user_id);
create table if not exists public.group_editor_invites (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.groups(id) on delete cascade,
 token_hash text not null unique,
 created_by uuid not null references auth.users(id),
 expires_at timestamptz not null default now()+interval '7 days',
 accepted_by uuid references auth.users(id),
 accepted_at timestamptz,
 revoked_at timestamptz
);
create table if not exists public.group_edit_activity (
 request_id uuid primary key,
 group_id uuid not null references public.groups(id) on delete cascade,
 user_id uuid references auth.users(id) on delete set null,
 kind text not null check(kind in ('workspace','players')),
 edited_at timestamptz not null default now()
);
create index if not exists group_edit_activity_period_idx on public.group_edit_activity(edited_at,group_id,user_id);
alter table public.group_members enable row level security;
alter table public.group_editor_invites enable row level security;
alter table public.group_edit_activity enable row level security;
revoke all on public.group_members,public.group_editor_invites,public.group_edit_activity from public,anon,authenticated;

create or replace function public.can_edit_group(target_group uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (exists(select 1 from public.groups where id=target_group and owner_id=auth.uid())
 or exists(select 1 from public.group_members where group_id=target_group and user_id=auth.uid()));
$$;
revoke all on function public.can_edit_group(uuid) from public,anon;
grant execute on function public.can_edit_group(uuid) to authenticated;
drop policy if exists groups_member_read on public.groups;
create policy groups_member_read on public.groups for select to authenticated using(public.can_edit_group(id));
drop policy if exists sets_member_read on public.game_sets;
create policy sets_member_read on public.game_sets for select to authenticated using(public.can_edit_group(group_id));
drop policy if exists rounds_member_read on public.rounds;
create policy rounds_member_read on public.rounds for select to authenticated using(exists(select 1 from public.game_sets s where s.id=rounds.set_id and public.can_edit_group(s.group_id)));
drop policy if exists ranking_shares_member_read on public.group_ranking_shares;
create policy ranking_shares_member_read on public.group_ranking_shares for select to authenticated using(public.can_edit_group(group_id));
-- The original set-sharing policy inherited visibility of game_sets. Keep changes owner-only.
drop policy if exists set_shares_owner_access on public.set_shares;
create policy set_shares_owner_access on public.set_shares for all to authenticated
 using(exists(select 1 from public.game_sets s join public.groups g on g.id=s.group_id where s.id=set_shares.set_id and g.owner_id=auth.uid()))
 with check(exists(select 1 from public.game_sets s join public.groups g on g.id=s.group_id where s.id=set_shares.set_id and g.owner_id=auth.uid()));
drop policy if exists set_shares_member_read on public.set_shares;
create policy set_shares_member_read on public.set_shares for select to authenticated using(exists(select 1 from public.game_sets s where s.id=set_shares.set_id and public.can_edit_group(s.group_id)));

create or replace function public.get_group_members(target_group uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g public.groups; result jsonb;
begin
 select * into g from public.groups where id=target_group;
 if not found or not public.can_edit_group(target_group) then raise exception 'Group not accessible' using errcode='42501'; end if;
 result:=jsonb_build_object('group',g.name,'role',case when g.owner_id=auth.uid() then 'owner' else 'editor' end,
  'count',1+(select count(*) from public.group_members where group_id=target_group and user_id<>g.owner_id));
 if g.owner_id=auth.uid() then
  result:=result||jsonb_build_object('members',(select jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'role',case when u.id=g.owner_id then 'owner' else 'editor' end) order by u.id<>g.owner_id,u.email)
   from auth.users u where u.id=g.owner_id or exists(select 1 from public.group_members m where m.group_id=target_group and m.user_id=u.id)));
 end if;
 return result;
end; $$;

create or replace function public.create_group_editor_invite(target_group uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare secret text; expiry timestamptz;
begin
 perform 1 from public.groups where id=target_group and owner_id=auth.uid() for update;
 if not found then raise exception 'Owner required' using errcode='42501'; end if;
 if (select count(*) from public.group_editor_invites where group_id=target_group and accepted_at is null and revoked_at is null and expires_at>now())>=20 then raise exception 'Too many invitations' using errcode='54000'; end if;
 secret:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');expiry:=now()+interval '7 days';
 insert into public.group_editor_invites(group_id,token_hash,created_by,expires_at) values(target_group,encode(sha256(convert_to(secret,'UTF8')),'hex'),auth.uid(),expiry);
 return jsonb_build_object('token',secret,'expires',expiry);
end; $$;

create or replace function public.preview_group_editor_invite(invite_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
 if invite_token is null or invite_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation' using errcode='22023'; end if;
 select jsonb_build_object('group',g.name,'group_id',g.id) into result from public.group_editor_invites i join public.groups g on g.id=i.group_id
 where i.token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') and i.revoked_at is null and i.expires_at>now() and (i.accepted_at is null or i.accepted_by=auth.uid());
 if result is null then raise exception 'Invitation expired or unavailable' using errcode='22023'; end if;
 return result;
end; $$;

create or replace function public.accept_group_editor_invite(invite_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare invitation public.group_editor_invites; gid uuid;
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
 if invite_token is null or invite_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation' using errcode='22023'; end if;
 select group_id into gid from public.group_editor_invites where token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex');
 -- All permission-changing operations serialize on the group, just like score saves.
 perform 1 from public.groups where id=gid for update;
 select * into invitation from public.group_editor_invites where group_id=gid and token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') for update;
 if not found or invitation.revoked_at is not null or invitation.expires_at<=now() then raise exception 'Invitation expired or unavailable' using errcode='22023'; end if;
 if invitation.accepted_at is not null then
  if invitation.accepted_by=auth.uid() and public.can_edit_group(gid) then return gid; end if;
  raise exception 'Invitation already used' using errcode='22023';
 end if;
 if exists(select 1 from public.groups where id=gid and owner_id=auth.uid()) then raise exception 'Owner already belongs to group' using errcode='22023'; end if;
 insert into public.group_members(group_id,user_id) values(gid,auth.uid()) on conflict do nothing;
 update public.group_editor_invites set accepted_by=auth.uid(),accepted_at=now() where id=invitation.id;
 return gid;
end; $$;

create or replace function public.remove_group_editor(target_group uuid,target_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.groups where id=target_group and owner_id=auth.uid() for update;
 if not found then raise exception 'Owner required' using errcode='42501'; end if;
 if target_user=auth.uid() then raise exception 'Owner cannot be removed' using errcode='22023'; end if;
 delete from public.group_members where group_id=target_group and user_id=target_user;
end; $$;
create or replace function public.revoke_group_editor_invites(target_group uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.groups where id=target_group and owner_id=auth.uid() for update;
 if not found then raise exception 'Owner required' using errcode='42501'; end if;
 update public.group_editor_invites set revoked_at=now() where group_id=target_group and accepted_at is null and revoked_at is null;
end; $$;

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
 update public.groups set sheet_revision=request_id,sheet_players=players where id=target_group;
 insert into public.group_edit_activity(request_id,group_id,user_id,kind) values(request_id,target_group,auth.uid(),'players');
 return request_id;
end; $$;
-- Only checked save functions may change score data; settings remain owner-only.
revoke update(sheet_revision,sheet_draft,sheet_players) on public.groups from authenticated;
revoke insert,update,delete on public.game_sets,public.rounds from authenticated;
revoke update(played_on,sequence,status,details) on public.game_sets from authenticated;
revoke update(position,mode,scores) on public.rounds from authenticated;

revoke all on function public.get_group_members(uuid) from public,anon,authenticated;
grant execute on function public.get_group_members(uuid) to authenticated;
revoke all on function public.create_group_editor_invite(uuid) from public,anon,authenticated;
grant execute on function public.create_group_editor_invite(uuid) to authenticated;
revoke all on function public.preview_group_editor_invite(text) from public,anon,authenticated;
grant execute on function public.preview_group_editor_invite(text) to authenticated;
revoke all on function public.accept_group_editor_invite(text) from public,anon,authenticated;
grant execute on function public.accept_group_editor_invite(text) to authenticated;
revoke all on function public.remove_group_editor(uuid,uuid) from public,anon,authenticated;
grant execute on function public.remove_group_editor(uuid,uuid) to authenticated;
revoke all on function public.revoke_group_editor_invites(uuid) from public,anon,authenticated;
grant execute on function public.revoke_group_editor_invites(uuid) to authenticated;
revoke all on function public.save_sheet_players(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_sheet_players(uuid,uuid,uuid,jsonb) to authenticated;
revoke all on function public.save_sheet_workspace(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_sheet_workspace(uuid,uuid,uuid,jsonb,jsonb,jsonb) to authenticated;
commit;
