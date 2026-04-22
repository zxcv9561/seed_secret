-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v2 (전체 기능)
-- Run AFTER the initial supabase-schema.sql
-- ═══════════════════════════════════════════

-- ── agents: role 추가 (master / member / viewer) ──
alter table agents add column if not exists role text default 'member';
-- ── agents: 섹션별 권한 맵 ──
alter table agents add column if not exists section_perms jsonb default '{
  "about":{"view":true,"edit":false,"del":false},
  "cases":{"view":true,"edit":false,"del":false},
  "dossier":{"view":true,"edit":false,"del":false},
  "agents":{"view":true,"edit":false,"del":false},
  "logs":{"view":true,"edit":false,"del":false},
  "classified":{"view":false,"edit":false,"del":false},
  "board":{"view":true,"edit":true,"del":false}
}'::jsonb;

-- ── 각 엔티티에 권한/공개여부 컬럼 추가 ──
alter table about_items add column if not exists visibility text default 'public';
alter table about_items add column if not exists owner_id text;
alter table about_items add column if not exists editor_ids jsonb default '[]'::jsonb;

alter table cases add column if not exists visibility text default 'public';
alter table cases add column if not exists owner_id text;
alter table cases add column if not exists editor_ids jsonb default '[]'::jsonb;

alter table dossier add column if not exists visibility text default 'public';
alter table dossier add column if not exists owner_id text;
alter table dossier add column if not exists editor_ids jsonb default '[]'::jsonb;

alter table agents add column if not exists visibility text default 'public';
alter table agents add column if not exists owner_id text;
alter table agents add column if not exists editor_ids jsonb default '[]'::jsonb;

alter table logs add column if not exists visibility text default 'public';
alter table logs add column if not exists owner_id text;
alter table logs add column if not exists editor_ids jsonb default '[]'::jsonb;

-- ── 자유게시판 ──────────────────────────────
create table if not exists posts (
  id text primary key,
  title text not null default '',
  author_id text references agents(id) on delete set null,
  author_name text,
  preview_image text,
  blocks jsonb default '[]'::jsonb,
  sort_order int default 0,
  visibility text default 'public',
  owner_id text,
  editor_ids jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 기밀 문서 ────────────────────────────────
create table if not exists classified (
  id text primary key,
  title text not null default '',
  clearance_level text default '1',
  blocks jsonb default '[]'::jsonb,
  sort_order int default 0,
  owner_id text,
  editor_ids jsonb default '[]'::jsonb,
  viewer_ids jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 메신저 ─────────────────────────────────
create table if not exists messages (
  id text primary key,
  sender_id text references agents(id) on delete cascade,
  receiver_id text references agents(id) on delete cascade,
  content text not null,
  is_read boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_msg_pair on messages (sender_id, receiver_id, created_at);
create index if not exists idx_msg_receiver on messages (receiver_id, created_at desc);

-- ── 즐겨찾기 ───────────────────────────────
create table if not exists favorites (
  id text primary key,
  user_agent_id text references agents(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  created_at timestamptz default now(),
  unique (user_agent_id, entity_type, entity_id)
);

-- ── 주크박스 ───────────────────────────────
create table if not exists jukebox_tracks (
  id text primary key,
  title text not null default '',
  source_type text not null default 'url',
  source text not null,
  duration int,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── RLS ────────────────────────────────────
alter table posts enable row level security;
alter table classified enable row level security;
alter table messages enable row level security;
alter table favorites enable row level security;
alter table jukebox_tracks enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['posts','classified','messages','favorites','jukebox_tracks']) loop
    execute format('drop policy if exists "anon_all_%I" on %I', t, t);
    execute format(
      'create policy "anon_all_%I" on %I for all to anon, authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

-- ── updated_at trigger ─────────────────────
do $$
declare t text;
begin
  for t in select unnest(array['posts','classified','jukebox_tracks']) loop
    execute format('drop trigger if exists tr_updated_at_%I on %I', t, t);
    execute format(
      'create trigger tr_updated_at_%I before update on %I for each row execute function set_updated_at()',
      t, t
    );
  end loop;
end $$;

-- ── Realtime publication ───────────────────
alter publication supabase_realtime add table messages;
