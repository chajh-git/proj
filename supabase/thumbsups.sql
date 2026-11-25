-- 👍 추천 (thumbsup) 테이블과 함수 — Supabase SQL Editor 에서 한 번에 실행
create table if not exists public.thumbsups (
  file   text primary key,                          -- 작품 키 (2026: 파일명, 2027~: 저장소 경로/학교/student/파일명)
  thumbs integer not null default 0 check (thumbs >= 0)
);

create or replace function public.add_thumbsup(p_file text)
returns void language sql security definer set search_path = public as $$
  insert into public.thumbsups (file, thumbs) values (p_file, 1)
  on conflict (file) do update set thumbs = public.thumbsups.thumbs + 1;
$$;

create or replace function public.remove_thumbsup(p_file text)
returns void language sql security definer set search_path = public as $$
  update public.thumbsups set thumbs = greatest(thumbs - 1, 0) where file = p_file;
$$;

alter table public.thumbsups enable row level security;
drop policy if exists "thumbsups read" on public.thumbsups;
create policy "thumbsups read" on public.thumbsups for select using (true);   -- 읽기만 공개, 쓰기는 함수로만

grant execute on function public.add_thumbsup(text)    to anon;
grant execute on function public.remove_thumbsup(text) to anon;

-- ※ 아래는 새 사이트가 배포되어 동작을 확인한 뒤에 실행하세요 (옛 조회수·별점 삭제)
-- drop table if exists public.views;
-- drop table if exists public.ratings;
-- drop function if exists public.increment_views(text);
