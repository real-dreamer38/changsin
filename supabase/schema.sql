-- =====================================================================
--  창신 프로젝트 — RAG 내부용 AI 애플리케이션 / Supabase 스키마
--  실행 순서: Supabase Dashboard > SQL Editor 에 이 파일 전체를 붙여넣고 실행
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 확장(Extensions)
-- ---------------------------------------------------------------------
create extension if not exists "vector" with schema "extensions";
create extension if not exists "pgcrypto" with schema "extensions";

-- ---------------------------------------------------------------------
-- 1. 권한 ENUM
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('user', 'admin');
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 2. profiles : auth.users 1:1 확장 (권한 / 승인 상태)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        public.user_role not null default 'user',
  is_approved boolean          not null default false,   -- 승인된 팀원만 접근
  created_at  timestamptz      not null default now()
);

comment on table public.profiles is '사용자 프로필 / 권한 / 승인 상태';

-- ---------------------------------------------------------------------
-- 3. documents : 업로드된 원본 자료 1건당 1행
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  uploader_id   uuid references public.profiles(id) on delete set null,
  uploader_email text,
  file_name     text not null,
  file_type     text not null,                  -- 'txt' | 'pdf' | 'png' | 'jpg'
  file_size     bigint,
  file_hash     text not null,                  -- SHA-256 (중복 방지 키)
  storage_path  text not null,                  -- Supabase Storage 경로
  extracted_text text,                          -- OCR / 파싱된 전체 텍스트
  status        text not null default 'processing', -- processing | ready | error
  error_message text,
  created_at    timestamptz not null default now(),
  unique (file_hash)                            -- 동일 해시 재업로드 차단
);

comment on table public.documents is '업로드 원본 자료 메타데이터 (해시 유니크로 중복 차단)';

create index if not exists documents_uploader_idx on public.documents(uploader_id);
create index if not exists documents_created_idx  on public.documents(created_at desc);

-- ---------------------------------------------------------------------
-- 4. document_chunks : Chunking + 임베딩 (pgvector)
--    Google text-embedding-004 = 768 차원
-- ---------------------------------------------------------------------
create table if not exists public.document_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  chunk_index  int  not null,
  content      text not null,
  embedding    extensions.vector(768),
  created_at   timestamptz not null default now()
);

comment on table public.document_chunks is 'Chunk 텍스트 + 768차원 임베딩';

create index if not exists chunks_document_idx on public.document_chunks(document_id);

-- 벡터 유사도 인덱스 (코사인). 데이터가 쌓인 뒤 lists 값을 조정하세요.
create index if not exists chunks_embedding_idx
  on public.document_chunks
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);

-- =====================================================================
--  RLS (Row Level Security)
-- =====================================================================
alter table public.profiles        enable row level security;
alter table public.documents       enable row level security;
alter table public.document_chunks enable row level security;

-- ----- 헬퍼: 현재 사용자가 승인된 관리자인지 -----
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_approved = true
  );
$$;

create or replace function public.is_approved_user()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_approved = true
  );
$$;

-- ----- profiles 정책 -----
drop policy if exists "본인 프로필 조회" on public.profiles;
create policy "본인 프로필 조회" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "본인 프로필 수정" on public.profiles;
create policy "본인 프로필 수정" on public.profiles
  for update using (auth.uid() = id or public.is_admin());

-- 관리자는 모든 프로필 관리(승인/권한 변경)
drop policy if exists "관리자 프로필 관리" on public.profiles;
create policy "관리자 프로필 관리" on public.profiles
  for all using (public.is_admin());

-- ----- documents 정책 -----
drop policy if exists "승인 사용자 자료 조회" on public.documents;
create policy "승인 사용자 자료 조회" on public.documents
  for select using (public.is_approved_user());

drop policy if exists "승인 사용자 자료 업로드" on public.documents;
create policy "승인 사용자 자료 업로드" on public.documents
  for insert with check (public.is_approved_user() and uploader_id = auth.uid());

drop policy if exists "본인/관리자 자료 수정" on public.documents;
create policy "본인/관리자 자료 수정" on public.documents
  for update using (uploader_id = auth.uid() or public.is_admin());

drop policy if exists "관리자 자료 삭제" on public.documents;
create policy "관리자 자료 삭제" on public.documents
  for delete using (public.is_admin());

-- ----- document_chunks 정책 -----
drop policy if exists "승인 사용자 청크 조회" on public.document_chunks;
create policy "승인 사용자 청크 조회" on public.document_chunks
  for select using (public.is_approved_user());

drop policy if exists "관리자 청크 관리" on public.document_chunks;
create policy "관리자 청크 관리" on public.document_chunks
  for all using (public.is_admin());

-- =====================================================================
--  Trigger : auth.users 신규 가입 시 profiles 자동 생성
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, is_approved)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'user',
    false                       -- 기본 미승인. 관리자가 승인해야 접근 가능
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
