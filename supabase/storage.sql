-- =====================================================================
--  Supabase Storage 버킷 + 정책
--  (Dashboard > Storage 에서 'documents' 버킷을 Private 으로 만들어도 되고,
--   아래 SQL 로 생성해도 됩니다.)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800) -- 50MB
on conflict (id) do nothing;

-- 이미 버킷이 존재하면 파일 크기 한도를 50MB 로 갱신
update storage.buckets
  set file_size_limit = 52428800 -- 50MB
  where id = 'documents';

-- 승인 사용자: 자기 폴더(uid/...)에 업로드
drop policy if exists "승인 사용자 업로드" on storage.objects;
create policy "승인 사용자 업로드" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.is_approved_user()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 승인 사용자: 자기 폴더 객체 덮어쓰기(재시도 upsert 허용)
drop policy if exists "승인 사용자 덮어쓰기" on storage.objects;
create policy "승인 사용자 덮어쓰기" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and public.is_approved_user()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 승인 사용자: 자료 조회(다운로드)
drop policy if exists "승인 사용자 조회" on storage.objects;
create policy "승인 사용자 조회" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and public.is_approved_user());

-- 관리자: 모든 객체 삭제
drop policy if exists "관리자 삭제" on storage.objects;
create policy "관리자 삭제" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and public.is_admin());
