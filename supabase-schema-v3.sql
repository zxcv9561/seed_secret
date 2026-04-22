-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v3 (이모티콘)
-- Run AFTER supabase-schema-v2.sql
-- ═══════════════════════════════════════════

-- ── 이모티콘 테이블 ─────────────────────────
create table if not exists emoticons (
  id text primary key,
  owner_id text references agents(id) on delete cascade,
  name text default '',
  url text not null,
  sort_order int default 0,
  created_at timestamptz default now()
);

create index if not exists idx_emo_owner on emoticons (owner_id, sort_order);

-- ── messages에 type/emoticon_url 컬럼 추가 ──
alter table messages add column if not exists msg_type text default 'text';
-- msg_type: 'text' | 'emoticon'
alter table messages add column if not exists emoticon_url text;

-- ── RLS ────────────────────────────────────
alter table emoticons enable row level security;

do $$
begin
  execute 'drop policy if exists "anon_all_emoticons" on emoticons';
  execute 'create policy "anon_all_emoticons" on emoticons for all to anon, authenticated using (true) with check (true)';
end $$;
