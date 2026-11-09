begin;

create table public.usage_dashboard_operators (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.usage_dashboard_operators enable row level security;
revoke all on public.usage_dashboard_operators from public, anon, authenticated;

create function public.get_usage_dashboard(date_from date, date_to date)
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
  with users as (
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
  ), people as (
    select u.id,u.email,u.registered,u.confirmed,count(g.id) as tables,
      coalesce(sum(g.sets),0) as sets,coalesce(sum(g.rounds),0) as rounds,
      min(g.first_day) as first_day,max(g.last_day) as last_day,
      case when u.confirmed is null then 'unconfirmed' when count(g.id)=0 then 'registered'
        when bool_or(g.days>1) then 'returning' when min(g.first_day) is not null then 'first'
        else 'created' end as stage
    from users u left join groups g on g.owner_id=u.id
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
      'newUsers',(select count(*) from cohort),'activeUsers',(select count(distinct owner_id) from period_sets),
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
    'groups',coalesce((select jsonb_agg(to_jsonb(g) order by last_day desc nulls last,created desc,id) from groups g),'[]'::jsonb)
  ) into report;
  return report;
end;
$$;

revoke all on function public.get_usage_dashboard(date,date) from public, anon, authenticated;
grant execute on function public.get_usage_dashboard(date,date) to authenticated;

commit;
