-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v10 (게시판 공지)
-- Run AFTER supabase-schema-v9.sql
-- ═══════════════════════════════════════════

-- ── posts 테이블에 is_notice 컬럼 추가 ─────
alter table posts add column if not exists is_notice boolean default false;

-- ── 공지 조회용 인덱스 ──────────────────────
create index if not exists idx_posts_notice on posts (is_notice, created_at desc);
