-- =====================================================================
--  엔터프라이즈 고도화 마이그레이션
--  실행 순서: schema.sql, functions.sql 적용 후 이 파일을 SQL Editor 에 붙여넣고 실행
--  내용: (1) 하이브리드 검색(FTS+벡터 RRF)  (2) 채팅 기록 테이블
-- =====================================================================

-- =====================================================================
--  1) 하이브리드 검색 — 전문검색(Full-Text Search) + 벡터 결합 (RRF)
-- =====================================================================

-- 1-1) 청크 본문의 tsvector 생성 컬럼 (STORED) + GIN 인덱스
--      한국어/부품번호/고유명사 정확매칭을 위해 'simple' 구성을 사용한다
--      (형태소 분석 없이 토큰 단위 정확 매칭 → 브랜드명/모델명에 강함).
alter table public.document_chunks
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('simple', content)) stored;

create index if not exists chunks_fts_idx
  on public.document_chunks using gin (content_tsv);

-- 1-2) 하이브리드 매칭 RPC (Reciprocal Rank Fusion)
--      키워드 순위와 벡터 순위를 RRF 로 융합해 정확도를 극대화한다.
--      score = Σ ( weight / (rrf_k + rank) )
create or replace function public.hybrid_match_document_chunks(
  query_text       text,
  query_embedding  extensions.vector(768),
  match_count      int   default 8,
  full_text_weight float default 1.0,
  semantic_weight  float default 1.0,
  rrf_k            int   default 50
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
set search_path = public, extensions
as $$
with fts_query as (
  select websearch_to_tsquery('simple', coalesce(query_text, '')) as q
),
full_text as (
  select
    c.id,
    row_number() over (
      order by ts_rank_cd(c.content_tsv, (select q from fts_query)) desc
    ) as rank_ix
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where d.status = 'ready'
    and c.content_tsv @@ (select q from fts_query)
  order by rank_ix
  limit least(match_count, 30) * 2
),
semantic as (
  select
    c.id,
    row_number() over (
      order by c.embedding <=> query_embedding
    ) as rank_ix
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where d.status = 'ready'
  order by rank_ix
  limit least(match_count, 30) * 2
)
select
  c.id,
  c.document_id,
  c.content,
  d.file_name,
  1 - (c.embedding <=> query_embedding) as similarity
from full_text
full outer join semantic on full_text.id = semantic.id
join public.document_chunks c on c.id = coalesce(full_text.id, semantic.id)
join public.documents d on d.id = c.document_id
order by
  coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight +
  coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight
  desc
limit least(match_count, 30);
$$;

comment on function public.hybrid_match_document_chunks is
  '하이브리드 검색: 전문검색(FTS) 순위 + 벡터 유사도 순위를 RRF 로 융합.';


-- =====================================================================
--  2) 채팅 기록 — 세션 / 메시지 영구 저장
-- =====================================================================

-- 2-1) 채팅 세션 (대화 1건 = 1세션)
create table if not exists public.chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default '새 대화',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.chat_sessions is '채팅 세션(대화방) — 사용자별';

create index if not exists chat_sessions_user_idx
  on public.chat_sessions(user_id, updated_at desc);

-- 2-2) 채팅 메시지
create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text,            -- user 메시지 텍스트
  answer     jsonb,           -- assistant 구조화 답변(ChatResponse)
  error      text,            -- assistant 에러 메시지(있으면)
  created_at timestamptz not null default now()
);

comment on table public.chat_messages is '채팅 메시지(user 텍스트 / assistant 구조화 답변)';

create index if not exists chat_messages_session_idx
  on public.chat_messages(session_id, created_at asc);

-- 2-3) RLS — 본인 데이터만
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "본인 세션 관리" on public.chat_sessions;
create policy "본인 세션 관리" on public.chat_sessions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "본인 메시지 관리" on public.chat_messages;
create policy "본인 메시지 관리" on public.chat_messages
  for all
  using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chat_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

-- 2-4) 메시지 추가 시 세션 updated_at 자동 갱신 (목록 정렬용)
create or replace function public.touch_chat_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_sessions
    set updated_at = now()
    where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists on_chat_message_insert on public.chat_messages;
create trigger on_chat_message_insert
  after insert on public.chat_messages
  for each row execute function public.touch_chat_session();
