-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v8 (댓글 + 리액션)
-- Run AFTER supabase-schema-v7.sql
-- ═══════════════════════════════════════════

-- ── 댓글 테이블 ────────────────────────────
create table if not exists comments (
  id text primary key,
  post_id text not null references posts(id) on delete cascade,
  author_id text references agents(id) on delete set null,
  author_name text default '',
  content text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_comments_post on comments (post_id, created_at);

-- ── 리액션 테이블 (좋아요/싫어요) ──────────
-- 한 사용자는 각 게시글에 하나의 reaction만 (like 또는 dislike)
create table if not exists reactions (
  post_id text not null references posts(id) on delete cascade,
  agent_id text not null references agents(id) on delete cascade,
  reaction text not null check (reaction in ('like', 'dislike')),
  created_at timestamptz default now(),
  primary key (post_id, agent_id)
);

create index if not exists idx_reactions_post on reactions (post_id);

-- ── RLS ────────────────────────────────────
alter table comments enable row level security;
alter table reactions enable row level security;

do $$
begin
  execute 'drop policy if exists "anon_all_comments" on comments';
  execute 'create policy "anon_all_comments" on comments for all to anon, authenticated using (true) with check (true)';
  execute 'drop policy if exists "anon_all_reactions" on reactions';
  execute 'create policy "anon_all_reactions" on reactions for all to anon, authenticated using (true) with check (true)';
end $$;

-- ── updated_at 트리거 ──────────────────────
drop trigger if exists tr_updated_at_comments on comments;
create trigger tr_updated_at_comments
  before update on comments
  for each row execute function set_updated_at();
