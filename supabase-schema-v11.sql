-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Schema v11 (커스텀 폰트)
-- Run AFTER supabase-schema-v10.sql
-- ═══════════════════════════════════════════

-- ── 폰트 등록 테이블 ──────────────────────
create table if not exists fonts (
  id text primary key,
  name text not null default '',
  family_name text not null default '',    -- CSS font-family 이름 (중복 방지 용도)
  url text not null default '',
  format text default 'woff2',              -- woff2 / woff / ttf / otf
  owner_id text references agents(id) on delete set null,
  created_at timestamptz default now(),
  sort_order int default 0
);

create index if not exists idx_fonts_sort on fonts (sort_order);

alter table fonts enable row level security;

do $$
begin
  execute 'drop policy if exists "anon_all_fonts" on fonts';
  execute 'create policy "anon_all_fonts" on fonts for all to anon, authenticated using (true) with check (true)';
end $$;
