-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v12 (사이트 제목 폰트)
-- Run AFTER supabase-schema-v11.sql
-- ═══════════════════════════════════════════

-- ── 사이트 설정 테이블 (Key-Value) ─────────
create table if not exists site_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz default now()
);

-- ── RLS ────────────────────────────────────
alter table site_settings enable row level security;

do $$
begin
  execute 'drop policy if exists "anon_all_settings" on site_settings';
  execute 'create policy "anon_all_settings" on site_settings for all to anon, authenticated using (true) with check (true)';
end $$;

-- ── 제목 폰트 설정 기본값 (최초 실행 시만 삽입) ──
insert into site_settings (key, value) values
  ('font-section-title', ''),
  ('font-sidebar-logo', '')
on conflict (key) do nothing;

-- 참고:
--   값이 빈 문자열 ('')이면 기본 폰트(Black Han Sans) 사용
--   커스텀 폰트를 쓰려면 fonts 테이블의 family_name 값을 넣으면 됨
--   예: update site_settings set value = 'seed-font-ft-123abc' where key = 'font-section-title';
