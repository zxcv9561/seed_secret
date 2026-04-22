-- ═══════════════════════════════════════════
-- S.E.E.D. Terminal — Storage RLS Policies
-- 3개 public 버킷(photos, images, audio)에 대한
-- anon/authenticated 전체 접근 허용 (개인 프로젝트용)
-- ═══════════════════════════════════════════

-- 기존 정책 있으면 제거 (재실행 가능하게)
drop policy if exists "anon_read_storage"   on storage.objects;
drop policy if exists "anon_insert_storage" on storage.objects;
drop policy if exists "anon_update_storage" on storage.objects;
drop policy if exists "anon_delete_storage" on storage.objects;

-- 읽기 (SELECT) — 모든 4개 버킷
create policy "anon_read_storage"
on storage.objects for select
to anon, authenticated
using (bucket_id in ('photos', 'images', 'audio', 'files'));

-- 업로드 (INSERT)
create policy "anon_insert_storage"
on storage.objects for insert
to anon, authenticated
with check (bucket_id in ('photos', 'images', 'audio', 'files'));

-- 수정 (UPDATE)
create policy "anon_update_storage"
on storage.objects for update
to anon, authenticated
using (bucket_id in ('photos', 'images', 'audio', 'files'))
with check (bucket_id in ('photos', 'images', 'audio', 'files'));

-- 삭제 (DELETE)
create policy "anon_delete_storage"
on storage.objects for delete
to anon, authenticated
using (bucket_id in ('photos', 'images', 'audio', 'files'));
