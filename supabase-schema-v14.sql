-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v14 (대상 보고서 + 작전 일지 계층)
-- Run AFTER supabase-schema-v13.sql
-- ═══════════════════════════════════════════

-- ── dossier 계층 ───────────────────────────
alter table dossier add column if not exists parent_id text references dossier(id) on delete set null;
alter table dossier add column if not exists depth int default 0;
alter table dossier add column if not exists is_folder boolean default false;

-- ── logs 계층 ──────────────────────────────
alter table logs add column if not exists parent_id text references logs(id) on delete set null;
alter table logs add column if not exists depth int default 0;
alter table logs add column if not exists is_folder boolean default false;

-- ── 인덱스 ─────────────────────────────────
create index if not exists idx_dossier_parent on dossier (parent_id);
create index if not exists idx_logs_parent on logs (parent_id);

-- 참고:
--   is_folder = true → 하위 폴더 (블록 X, 자식만 가짐)
--   is_folder = false → 일반 보고서/일지 (블록 O)
--   depth: 0=최상위, 1~2=하위 (최대 3단계)
