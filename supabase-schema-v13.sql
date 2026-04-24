-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v13 (계층 소속)
-- agent_groups와 about_items에 parent_id 추가 (최대 3단계)
-- Run AFTER supabase-schema-v12.sql
-- ═══════════════════════════════════════════

-- ── 요원 소속 계층 ──────────────────────────
alter table agent_groups add column if not exists parent_id text references agent_groups(id) on delete set null;
alter table agent_groups add column if not exists depth int default 0;

-- ── 기관 소개 항목 계층 ─────────────────────
alter table about_items add column if not exists parent_id text references about_items(id) on delete set null;
alter table about_items add column if not exists depth int default 0;

-- ── 인덱스 (트리 조회 가속) ─────────────────
create index if not exists idx_agent_groups_parent on agent_groups (parent_id);
create index if not exists idx_about_items_parent on about_items (parent_id);

-- 참고:
--   parent_id = null → 최상위 (depth 0)
--   parent_id 지정 → 하위 (depth 1 또는 2)
--   최대 depth는 2 (즉 3단계: 0, 1, 2)
--   depth는 클라이언트에서 관리 (DB는 단순히 저장)
