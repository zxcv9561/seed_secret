-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v6 (작전 일지 첨부파일)
-- Run AFTER supabase-schema-v5.sql
-- ═══════════════════════════════════════════

-- ── logs 테이블에 attachments 컬럼 추가 ──
-- attachments: jsonb array of { type, url, name, size, mime }
alter table logs add column if not exists attachments jsonb default '[]'::jsonb;
