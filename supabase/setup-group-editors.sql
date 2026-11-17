-- 卓上反省会専用Supabase（aexmoblpehhcqptvagxh）のSQL Editorで全文実行します。
-- 成績を削除しません。再実行可能。実行後はページを更新してください。
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


create or replace function public.get_usage_dashboard(date_from date, date_to date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare report jsonb;
begin
  if not exists (select 1 from public.usage_dashboard_operators where user_id = (select auth.uid())) then
    raise exception 'Usage dashboard access denied' using errcode = '42501';
  end if;
  if date_from is null or date_to is null or date_to < date_from or date_to - date_from > 365 then
    raise exception 'Choose a range of up to 366 days' using errcode = '22023';
  end if;
  with memberships as (
    select id as group_id,owner_id as user_id,'owner'::text as role,created_at as joined_at from public.groups
    union all select m.group_id,m.user_id,'editor',m.joined_at from public.group_members m join public.groups g on g.id=m.group_id where m.user_id<>g.owner_id
  ), users as (
    select id,email,(created_at at time zone 'Asia/Tokyo')::date as registered,
      (email_confirmed_at at time zone 'Asia/Tokyo')::date as confirmed
    from auth.users
  ), finished as (
    select s.id,s.group_id,s.played_on,g.owner_id
    from public.game_sets s join public.groups g on g.id=s.group_id
    where s.status='finished'
  ), period_sets as (
    select * from finished where played_on between date_from and date_to
  ), rounds_per_set as (
    select r.set_id,count(*) as rounds from public.rounds r join finished f on f.id=r.set_id group by r.set_id
  ), first_days as (
    select group_id,min(played_on) as first_day,max(played_on) as last_day,count(*) as lifetime_sets,
      count(distinct played_on) as days from finished group by group_id
  ), groups as (
    select g.id,g.owner_id,g.name,(g.created_at at time zone 'Asia/Tokyo')::date as created,
      d.first_day,d.last_day,coalesce(d.days,0) as days,
      count(s.id) as sets,coalesce(sum(r.rounds),0) as rounds
    from public.groups g left join first_days d on d.group_id=g.id
    left join period_sets s on s.group_id=g.id left join rounds_per_set r on r.set_id=s.id
    group by g.id,g.owner_id,g.name,g.created_at,d.first_day,d.last_day,d.days
  ), group_details as (
    select g.*,(select count(*) from memberships m where m.group_id=g.id) as member_count,
      (select u.email from auth.users u where u.id=g.owner_id) as owner_email,
      (select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'email',u.email,'joined_at',m.joined_at) order by m.role desc,u.email)
       from memberships m join auth.users u on u.id=m.user_id where m.group_id=g.id) as members
    from groups g
  ), people as (
    select u.id,u.email,u.registered,u.confirmed,count(g.id) as tables,count(g.id) filter(where g.owner_id=u.id) as owned_tables,
      (select count(*) from public.group_edit_activity a where a.user_id=u.id and (a.edited_at at time zone 'Asia/Tokyo')::date between date_from and date_to) as edits,
      coalesce(sum(g.sets),0) as sets,coalesce(sum(g.rounds),0) as rounds,
      min(g.first_day) as first_day,max(g.last_day) as last_day,
      case when u.confirmed is null then 'unconfirmed' when count(g.id)=0 then 'registered'
        when bool_or(g.days>1) then 'returning' when min(g.first_day) is not null then 'first'
        else 'created' end as stage
    from users u left join memberships m on m.user_id=u.id left join groups g on g.id=m.group_id
    group by u.id,u.email,u.registered,u.confirmed
  ), weeks as (
    select week::date as week,
      (select count(*) from users where registered between greatest(week::date,date_from) and least(week::date+6,date_to)) as registrations,
      (select count(distinct group_id) from period_sets where played_on between week::date and week::date+6) as tables,
      (select count(*) from period_sets where played_on between week::date and week::date+6) as sets
    from generate_series(date_trunc('week',date_from::timestamp),date_trunc('week',date_to::timestamp),interval '7 days') as w(week)
  ), cohort as (
    select * from people where registered between date_from and date_to
  ), retention as (
    select d.first_day,exists(select 1 from finished f where f.group_id=d.group_id
      and f.played_on between d.first_day+1 and d.first_day+30) as returned
    from first_days d where d.first_day between date_from and date_to
  )
  select jsonb_build_object(
    'totals',jsonb_build_object('registered',(select count(*) from users),
      'newUsers',(select count(*) from cohort),'totalGroups',(select count(*) from public.groups),
      'activeUsers',(select count(*) from (select owner_id as id from period_sets union select user_id from public.group_edit_activity where user_id is not null and (edited_at at time zone 'Asia/Tokyo')::date between date_from and date_to) active),
      'activeGroups',(select count(distinct group_id) from period_sets),'sets',(select count(*) from period_sets),
      'rounds',(select coalesce(sum(r.rounds),0) from rounds_per_set r join period_sets s on s.id=r.set_id)),
    'funnel',(select jsonb_build_object('registered',count(*),'confirmed',count(confirmed),
      'created',count(*) filter(where confirmed is not null and tables>0),
      'finished',count(*) filter(where confirmed is not null and first_day is not null),
      'medianDays',percentile_cont(0.5) within group(order by first_day-registered)
        filter(where first_day>=registered)) from cohort),
    'retention',(select jsonb_build_object('eligible',count(*) filter(where first_day+30 <= (now() at time zone 'Asia/Tokyo')::date),
      'returned',count(*) filter(where returned and first_day+30 <= (now() at time zone 'Asia/Tokyo')::date),
      'observing',count(*) filter(where first_day+30 > (now() at time zone 'Asia/Tokyo')::date)) from retention),
    'weeks',coalesce((select jsonb_agg(to_jsonb(w) order by week) from weeks w),'[]'::jsonb),
    'users',coalesce((select jsonb_agg(to_jsonb(p) order by registered desc,id) from people p),'[]'::jsonb),
    'groups',coalesce((select jsonb_agg(to_jsonb(g) order by last_day desc nulls last,created desc,id) from group_details g),'[]'::jsonb)
  ) into report;
  return report;
end;
$$;




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
