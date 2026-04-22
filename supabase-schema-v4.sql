-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v4 (주크박스 재생목록)
-- Run AFTER supabase-schema-v3.sql
-- ═══════════════════════════════════════════

-- ── 재생목록 ────────────────────────────────
create table if not exists jukebox_playlists (
  id text primary key,
  name text not null default '재생목록',
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── jukebox_tracks에 playlist_id 추가 ──────
alter table jukebox_tracks add column if not exists playlist_id text;

-- FK는 굳이 강제하지 않고 앱에서 관리 (NULL = 모든 트랙 뷰)

-- ── RLS ────────────────────────────────────
alter table jukebox_playlists enable row level security;

do $$
begin
  execute 'drop policy if exists "anon_all_jukebox_playlists" on jukebox_playlists';
  execute 'create policy "anon_all_jukebox_playlists" on jukebox_playlists for all to anon, authenticated using (true) with check (true)';
end $$;

-- ── updated_at trigger ─────────────────────
drop trigger if exists tr_updated_at_jukebox_playlists on jukebox_playlists;
create trigger tr_updated_at_jukebox_playlists
  before update on jukebox_playlists
  for each row execute function set_updated_at();
