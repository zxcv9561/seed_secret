-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v5 (자료실)
-- Run AFTER supabase-schema-v4.sql
-- ═══════════════════════════════════════════

-- ── 자료실 테이블 ───────────────────────────
create table if not exists archive (
  id text primary key,
  title text not null default '',
  description text default '',
  file_type text default 'upload',      -- 'upload' | 'link'
  file_url text not null,                -- Storage URL 또는 외부 링크
  file_name text default '',
  file_size bigint default 0,            -- 바이트 단위
  file_mime text default '',
  author_id text references agents(id) on delete set null,
  author_name text,
  sort_order int default 0,
  visibility text default 'public',
  owner_id text,
  editor_ids jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 섹션별 권한에 archive 추가 ──────────────
-- 기존 agents 테이블의 section_perms 기본값 업데이트 (새 사용자용)
alter table agents alter column section_perms set default '{
  "about":{"view":true,"edit":false,"del":false},
  "cases":{"view":true,"edit":false,"del":false},
  "dossier":{"view":true,"edit":false,"del":false},
  "agents":{"view":true,"edit":false,"del":false},
  "logs":{"view":true,"edit":false,"del":false},
  "classified":{"view":false,"edit":false,"del":false},
  "board":{"view":true,"edit":true,"del":false},
  "archive":{"view":true,"edit":true,"del":false}
}'::jsonb;

-- ── RLS ────────────────────────────────────
alter table archive enable row level security;

do $$
begin
  execute 'drop policy if exists "anon_all_archive" on archive';
  execute 'create policy "anon_all_archive" on archive for all to anon, authenticated using (true) with check (true)';
end $$;

-- ── updated_at trigger ─────────────────────
drop trigger if exists tr_updated_at_archive on archive;
create trigger tr_updated_at_archive
  before update on archive
  for each row execute function set_updated_at();

-- ── files 버킷 생성 (Storage) ──────────────
-- 이 SQL로는 버킷 생성 불가. 대시보드에서 'files' 버킷 수동 생성 필요:
-- Storage → New bucket → Name: files, Public: yes
