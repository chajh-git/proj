-- supabase/policies.sql  (86번)
-- 행 수준 보안(RLS). schema.sql 을 먼저 실행한 뒤 실행한다. (다시 실행해도 안전)
-- 원칙: 기본은 모두 막고, 필요한 것만 연다. 서버는 서비스 키로 접속하므로 RLS 를 거치지 않는다(키는 서버 환경 변수로만).
--   · 경기·리그·로스터·리플레이·도감의 '쓰기'는 서버만 한다(정책 없음 = 브라우저에서는 불가)
--   · 상대 팀의 설계·전술(robots, rosters)은 읽을 수 없다
--   · recipes_secret 은 지휘관만(브라우저의 anon 키로는 일반 접속자가 읽을 수 없다)
--
-- 지휘관 지정(SQL Editor 에서 직접):  update public.profiles set role='commander' where login_id='선생님아이디';
-- 팀 배정:                           update public.profiles set team_id='t1' where login_id='학생아이디';

-- ── 도우미 함수 ─────────────────────────────────────────
create or replace function public.is_commander() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'commander');
$$;

create or replace function public.my_team() returns text
language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid();
$$;

-- 같은 팀인지 (기체 주인의 팀과 내 팀)
create or replace function public.same_team(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select team_id from public.profiles where id = other) = public.my_team(), false);
$$;

revoke all on function public.is_commander() from public;
revoke all on function public.my_team() from public;
revoke all on function public.same_team(uuid) from public;
grant execute on function public.is_commander() to authenticated;
grant execute on function public.my_team() to authenticated;
grant execute on function public.same_team(uuid) to authenticated;

-- ── 켜기 ────────────────────────────────────────────────
alter table public.teams          enable row level security;
alter table public.profiles       enable row level security;
alter table public.robots         enable row level security;
alter table public.robot_versions enable row level security;
alter table public.team_tactics   enable row level security;
alter table public.leagues        enable row level security;
alter table public.league_teams   enable row level security;
alter table public.rosters        enable row level security;
alter table public.matches        enable row level security;
alter table public.replays        enable row level security;
alter table public.codex          enable row level security;
alter table public.recipes_secret enable row level security;
alter table public.balance_public enable row level security;

-- 역할·팀은 본인이 바꿀 수 없다 (닉네임만 수정 가능)
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_commander() or auth.uid() is null then return new; end if; -- 지휘관, 또는 SQL Editor/서버 키
  if new.role is distinct from old.role or new.team_id is distinct from old.team_id or new.login_id is distinct from old.login_id then
    raise exception '역할·팀·아이디는 지휘관만 바꿀 수 있습니다';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

-- 정책 다시 만들기
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- teams: 로그인한 모두 읽기, 지휘관 쓰기
create policy teams_read  on public.teams for select to authenticated using (true);
create policy teams_write on public.teams for all    to authenticated using (public.is_commander()) with check (public.is_commander());

-- profiles: 본인·같은 팀·지휘관이 읽기, 닉네임은 본인만 수정, 지휘관은 전체
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_commander() or (team_id is not null and team_id = public.my_team()));
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_commander   on public.profiles for all    to authenticated using (public.is_commander()) with check (public.is_commander());

-- robots: 본인 전부, 같은 팀은 읽기, 지휘관 전부
create policy robots_own on public.robots for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy robots_team_read on public.robots for select to authenticated using (public.same_team(owner));
create policy robots_commander on public.robots for all to authenticated using (public.is_commander()) with check (public.is_commander());

create policy robot_versions_read on public.robot_versions for select to authenticated
  using (exists (select 1 from public.robots r where r.id = robot_id and (r.owner = auth.uid() or public.is_commander())));

-- team_tactics: 같은 팀 읽기·쓰기, 지휘관 전부
create policy team_tactics_team on public.team_tactics for all to authenticated
  using (team_id = public.my_team() or public.is_commander()) with check (team_id = public.my_team() or public.is_commander());

-- leagues·league_teams·matches·replays: 로그인한 모두 읽기. 쓰기는 지휘관(직접 수정) 또는 서버
create policy leagues_read on public.leagues for select to authenticated using (true);
create policy leagues_commander on public.leagues for all to authenticated using (public.is_commander()) with check (public.is_commander());
create policy league_teams_read on public.league_teams for select to authenticated using (true);
create policy league_teams_commander on public.league_teams for all to authenticated using (public.is_commander()) with check (public.is_commander());
create policy matches_read on public.matches for select to authenticated using (true);
create policy matches_commander on public.matches for all to authenticated using (public.is_commander()) with check (public.is_commander());
create policy replays_read on public.replays for select to authenticated using (true);
create policy replays_commander on public.replays for delete to authenticated using (public.is_commander());

-- rosters: 설계·전술 스냅샷이 들어 있으므로 자기 팀과 지휘관만 읽기 (쓰기는 서버만)
create policy rosters_read on public.rosters for select to authenticated using (team_id = public.my_team() or public.is_commander());

-- codex: 공개된 것 + 자기 팀이 찾은 것 + 지휘관
create policy codex_read on public.codex for select to authenticated
  using (public or found_by_team = public.my_team() or public.is_commander());
create policy codex_commander on public.codex for all to authenticated using (public.is_commander()) with check (public.is_commander());

-- recipes_secret: 지휘관만 (서버는 서비스 키)
create policy recipes_secret_commander on public.recipes_secret for all to authenticated using (public.is_commander()) with check (public.is_commander());

-- balance_public: 로그인한 모두 읽기, 지휘관 쓰기
create policy balance_read on public.balance_public for select to authenticated using (true);
create policy balance_commander on public.balance_public for all to authenticated using (public.is_commander()) with check (public.is_commander());

-- 비로그인(anon)에게는 어떤 정책도 없으므로 모두 막힌다.
revoke all on all tables in schema public from anon;
