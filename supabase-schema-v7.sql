-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v7 (단톡방)
-- Run AFTER supabase-schema-v6.sql
-- ═══════════════════════════════════════════

-- ── 채팅방 테이블 ──────────────────────────
create table if not exists chat_rooms (
  id text primary key,
  name text not null default '그룹 채팅',
  creator_id text references agents(id) on delete set null,
  created_at timestamptz default now()
);

-- ── 방 멤버 (다대다) ───────────────────────
create table if not exists chat_room_members (
  room_id text references chat_rooms(id) on delete cascade,
  agent_id text references agents(id) on delete cascade,
  joined_at timestamptz default now(),
  last_read_at timestamptz default now(),
  primary key (room_id, agent_id)
);

create index if not exists idx_rm_agent on chat_room_members (agent_id);
create index if not exists idx_rm_room on chat_room_members (room_id);

-- ── messages에 room_id 추가 ───────────────
-- room_id가 있으면 그룹 메시지, 없으면 기존 1:1 메시지
alter table messages add column if not exists room_id text references chat_rooms(id) on delete cascade;

create index if not exists idx_msg_room on messages (room_id, created_at);

-- ── RLS ────────────────────────────────────
alter table chat_rooms enable row level security;
alter table chat_room_members enable row level security;

do $$
begin
  execute 'drop policy if exists "anon_all_chat_rooms" on chat_rooms';
  execute 'create policy "anon_all_chat_rooms" on chat_rooms for all to anon, authenticated using (true) with check (true)';
  execute 'drop policy if exists "anon_all_chat_room_members" on chat_room_members';
  execute 'create policy "anon_all_chat_room_members" on chat_room_members for all to anon, authenticated using (true) with check (true)';
end $$;
