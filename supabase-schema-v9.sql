-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v9
-- 댓글 대댓글 + 댓글 리액션 + 멘션/알림
-- Run AFTER supabase-schema-v8.sql
-- ═══════════════════════════════════════════

-- ── 댓글에 parent_id 추가 (대댓글) ────────
alter table comments add column if not exists parent_id text references comments(id) on delete cascade;
create index if not exists idx_comments_parent on comments (parent_id);

-- ── 댓글 리액션 테이블 ─────────────────────
create table if not exists comment_reactions (
  comment_id text not null references comments(id) on delete cascade,
  agent_id text not null references agents(id) on delete cascade,
  reaction text not null check (reaction in ('like', 'dislike')),
  created_at timestamptz default now(),
  primary key (comment_id, agent_id)
);

create index if not exists idx_creactions_cmt on comment_reactions (comment_id);

-- ── 알림 테이블 ────────────────────────────
create table if not exists notifications (
  id text primary key,
  recipient_id text not null references agents(id) on delete cascade,
  sender_id text references agents(id) on delete set null,
  sender_name text default '',
  type text not null,                     -- 'comment', 'reply', 'mention', 'reaction'
  post_id text references posts(id) on delete cascade,
  comment_id text references comments(id) on delete cascade,
  preview text default '',                -- 내용 요약 (50자 정도)
  is_read boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_notif_recipient on notifications (recipient_id, created_at desc);
create index if not exists idx_notif_unread on notifications (recipient_id, is_read) where is_read = false;

-- ── RLS ────────────────────────────────────
alter table comment_reactions enable row level security;
alter table notifications enable row level security;

do $$
begin
  execute 'drop policy if exists "anon_all_creactions" on comment_reactions';
  execute 'create policy "anon_all_creactions" on comment_reactions for all to anon, authenticated using (true) with check (true)';
  execute 'drop policy if exists "anon_all_notifs" on notifications';
  execute 'create policy "anon_all_notifs" on notifications for all to anon, authenticated using (true) with check (true)';
end $$;

-- ── Realtime enable ──────────────────────
-- Supabase 대시보드에서 해당 테이블의 Realtime을 활성화하거나 여기서 직접 publication에 추가:
-- (이미 활성화되어 있다면 에러 무시)
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table reactions';
  exception when duplicate_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table comments';
  exception when duplicate_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table comment_reactions';
  exception when duplicate_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table notifications';
  exception when duplicate_object then null;
  end;
end $$;
