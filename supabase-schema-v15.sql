-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v15 (보고서 커스텀 필드 + 숨김 필드)
-- 보고서별로 자유롭게 필드 추가/수정 가능
-- Run AFTER supabase-schema-v14.sql
-- ═══════════════════════════════════════════

-- ── dossier 커스텀 필드 ────────────────────
alter table dossier add column if not exists custom_fields jsonb default '[]'::jsonb;
alter table dossier add column if not exists hidden_fields jsonb default '[]'::jsonb;

-- ── logs 커스텀 필드 ───────────────────────
alter table logs add column if not exists custom_fields jsonb default '[]'::jsonb;
alter table logs add column if not exists hidden_fields jsonb default '[]'::jsonb;

-- 참고:
--   custom_fields = [{ "id": "f1", "label": "코드명", "value": "..." }, ...]
--   hidden_fields = ["caseNo", "sector"] — 기본 필드 중 숨길 것들의 키
--   기본 필드 키:
--     dossier: caseNo, classLevel, status, sector, observer
--     logs: date
