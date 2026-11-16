-- supabase/schema.sql  (85번)
-- 코딩메카 테이블. Supabase 대시보드 → SQL Editor 에서 이 파일 → policies.sql 순서로 한 번씩 실행한다. (다시 실행해도 안전)
-- 서버(server/db.js)가 쓰는 열과 같다. 명세 4-2의 designs/tactics 는 한 행으로 합친 robots(design, tactics) 를 쓴다.
-- 로그인은 아이디 + 비밀번호(가상 이메일 아이디@codingmeca.invalid). 이메일 인증은 Auth 설정에서 꺼 둔다.


-- ── 계정 ────────────────────────────────────────────────
create table if not exists public.teams (
  id        text primary key,
  name      text not null check (char_length(name) between 1 and 30),
  color     text not null default '#888888'
);

create table if not exists public.profiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  login_id  text not null unique check (login_id ~ '^[a-z0-9_]{3,20}$'),
  nickname  text not null default '' check (char_length(nickname) <= 20),
  role      text not null default 'mechanic' check (role in ('mechanic','commander')),
  team_id   text references public.teams(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 가입하면 프로필을 자동으로 만든다. 역할은 항상 mechanic (지휘관 승격은 DB에서 직접)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare lid text := lower(split_part(new.email, '@', 1));
begin
  insert into public.profiles (id, login_id, nickname)
  values (new.id, lid, left(coalesce(new.raw_user_meta_data->>'nickname', lid), 20))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 기체 ────────────────────────────────────────────────
create table if not exists public.robots (
  id        uuid primary key default gen_random_uuid(),
  owner     uuid not null references public.profiles(id) on delete cascade,
  name      text not null default '' check (char_length(name) <= 40),
  design    jsonb not null,
  tactics   jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists robots_owner_idx on public.robots(owner);

-- 저장할 때마다 이전 내용을 남긴다 (되돌리기용)
create table if not exists public.robot_versions (
  id        bigint generated always as identity primary key,
  robot_id  uuid not null references public.robots(id) on delete cascade,
  design    jsonb not null,
  tactics   jsonb,
  saved_at  timestamptz not null default now()
);
create index if not exists robot_versions_robot_idx on public.robot_versions(robot_id, saved_at desc);

create or replace function public.robots_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and (old.design is distinct from new.design or old.tactics is distinct from new.tactics) then
    insert into public.robot_versions (robot_id, design, tactics) values (old.id, old.design, old.tactics);
    -- 기체당 최근 30개만 보관
    delete from public.robot_versions where robot_id = old.id
      and id not in (select id from public.robot_versions where robot_id = old.id order by saved_at desc, id desc limit 30);
  end if;
  return new;
end $$;
drop trigger if exists robots_touch on public.robots;
create trigger robots_touch before insert or update on public.robots for each row execute function public.robots_touch();

-- 팀 공용 문서(융합 후 전술 등)
create table if not exists public.team_tactics (
  id        uuid primary key default gen_random_uuid(),
  team_id   text not null references public.teams(id) on delete cascade,
  kind      text not null,
  data      jsonb not null,
  locked_by uuid references public.profiles(id) on delete set null,
  locked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (team_id, kind)
);

-- ── 리그·경기 ───────────────────────────────────────────
create table if not exists public.leagues (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  config    jsonb not null default '{}'::jsonb,
  status    text not null default 'open' check (status in ('open','running','finished')),
  view_code text not null unique,
  balance_version integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.league_teams (
  id        uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id   text not null references public.teams(id) on delete cascade,
  seed      integer,
  registered_at timestamptz not null default now(),
  unique (league_id, team_id)
);

create table if not exists public.rosters (
  id        uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id   text not null references public.teams(id) on delete cascade,
  snapshot  jsonb not null,
  locked    boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (league_id, team_id)
);

create table if not exists public.matches (
  id        text primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  round     integer not null default 0,
  slot      integer not null default 0,
  team_a    text references public.teams(id) on delete set null,
  team_b    text references public.teams(id) on delete set null,
  map_id    text,
  status    text not null default 'scheduled' check (status in ('scheduled','prep','running','paused','finished','aborted','needs_decision')),
  result    jsonb,
  replay_id uuid,
  bracket_id text,
  draws     integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at   timestamptz
);
create index if not exists matches_league_idx on public.matches(league_id, round, slot);

create table if not exists public.replays (
  id        uuid primary key default gen_random_uuid(),
  match_id  text references public.matches(id) on delete cascade,
  meta      jsonb not null default '{}'::jsonb,
  data      text not null,            -- base64(gzip(json)) · 경기 스트림만 들어 있고 전술은 없다
  created_at timestamptz not null default now()
);
create index if not exists replays_match_idx on public.replays(match_id);

-- ── 도감·수치 ───────────────────────────────────────────
create table if not exists public.codex (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     text not null,
  found_by_team text references public.teams(id) on delete set null,
  found_at      timestamptz not null default now(),
  match_id      text,
  public        boolean not null default false
);
create index if not exists codex_recipe_idx on public.codex(recipe_id);

create table if not exists public.recipes_secret (
  id    text primary key,
  data  jsonb not null
);

create table if not exists public.balance_public (
  version    integer primary key,
  data       jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  note       text
);
