-- ═══════════════════════════════════════════
-- S.E.E.D. Internal Terminal — DB Schema
-- ═══════════════════════════════════════════

-- 모든 테이블은 단일 사용자 개인용이므로 단순한 구조 사용.
-- 로그인 요원 이름과 계정을 Supabase Auth로 분리하지 않고,
-- 현재 앱의 로직(agent.account) 을 그대로 유지합니다.
-- 보안: anon key로 읽기/쓰기 모두 허용 (개인 프로젝트 기준)

-- ── 소속 ────────────────────────────────────
create table if not exists agent_groups (
  id text primary key,
  name text not null,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 요원 ────────────────────────────────────
create table if not exists agents (
  id text primary key,
  group_id text references agent_groups(id) on delete cascade,
  name text,
  id_no text,
  rank text,
  unit text,
  talent text,
  photo_url text,
  account_username text unique,
  account_password text,   -- plain text (personal project); 정말 보안 필요하면 bcrypt 사용
  blocks jsonb default '[]'::jsonb,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 기관 소개 ──────────────────────────────
create table if not exists about_items (
  id text primary key,
  title text,
  blocks jsonb default '[]'::jsonb,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 사건 일람 ──────────────────────────────
create table if not exists cases (
  id text primary key,
  case_no text,
  target text,
  class_level text,
  sector text,
  status text,
  observer text,
  blocks jsonb default '[]'::jsonb,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 대상 보고서 ────────────────────────────
create table if not exists dossier (
  id text primary key,
  case_no text,
  target text,
  class_level text,
  sector text,
  status text,
  observer text,
  blocks jsonb default '[]'::jsonb,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 작전 일지 ──────────────────────────────
create table if not exists logs (
  id text primary key,
  title text,
  date text,
  blocks jsonb default '[]'::jsonb,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ═══════════════════════════════════════════
-- Row Level Security — 개인 프로젝트용으로
-- anon key에 모든 CRUD를 허용 (신뢰하는 사용자만 사이트 URL 사용)
-- ═══════════════════════════════════════════

alter table agent_groups enable row level security;
alter table agents        enable row level security;
alter table about_items   enable row level security;
alter table cases         enable row level security;
alter table dossier       enable row level security;
alter table logs          enable row level security;

-- anon 및 authenticated 모두에게 전체 접근 허용
do $$
declare t text;
begin
  for t in select unnest(array['agent_groups','agents','about_items','cases','dossier','logs']) loop
    execute format('drop policy if exists "anon_all_%I" on %I', t, t);
    execute format(
      'create policy "anon_all_%I" on %I for all to anon, authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

-- ═══════════════════════════════════════════
-- Auto-update timestamp trigger
-- ═══════════════════════════════════════════
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  for t in select unnest(array['agent_groups','agents','about_items','cases','dossier','logs']) loop
    execute format('drop trigger if exists tr_updated_at_%I on %I', t, t);
    execute format(
      'create trigger tr_updated_at_%I before update on %I for each row execute function set_updated_at()',
      t, t
    );
  end loop;
end $$;
