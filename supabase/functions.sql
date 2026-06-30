-- =====================================================================
--  pgvector 유사도 검색 RPC 함수 (schema.sql 실행 후 실행)
-- =====================================================================

-- ---------------------------------------------------------------------
-- match_document_chunks
--   query_embedding 과 코사인 유사도가 match_threshold 이상인 청크를
--   유사도 내림차순으로 match_count 개 반환.
--   similarity = 1 - cosine_distance  (1에 가까울수록 유사)
-- ---------------------------------------------------------------------
create or replace function public.match_document_chunks(
  query_embedding extensions.vector(768),
  match_threshold float default 0.5,
  match_count     int   default 6
)
returns table (
  id          uuid,
  document_id uuid,
  content     text,
  file_name   text,
  similarity  float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.document_id,
    c.content,
    d.file_name,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where d.status = 'ready'
    and 1 - (c.embedding <=> query_embedding) >= match_threshold
  order by c.embedding <=> query_embedding asc
  limit match_count;
$$;

comment on function public.match_document_chunks is
  'pgvector 코사인 유사도 검색 (RAG retrieval). 임계치 이상 청크만 반환.';

-- ---------------------------------------------------------------------
-- (선택) 자료 완전 삭제 RPC — 관리자 삭제 시 트랜잭션 처리용.
--   chunks 는 ON DELETE CASCADE 로 함께 삭제되므로 documents 만 지우면 됨.
--   Storage 객체는 애플리케이션 레이어(service role)에서 별도 삭제.
-- ---------------------------------------------------------------------
create or replace function public.delete_document(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '권한이 없습니다 (관리자 전용)';
  end if;
  delete from public.documents where id = target_id;
end;
$$;
