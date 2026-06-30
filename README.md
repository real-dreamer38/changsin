# 창신 프로젝트 — 사내 RAG AI 어시스턴트

팀 자료(txt/pdf/png/jpg)를 업로드·벡터화하고, 질문하면 **사내 자료 우선 검색 →
부족 시 Tavily 웹 딥서치**로 보강해 **프레젠테이션 슬라이드 + 발표 스크립트**
형태로 답변하는 내부용 AI 웹앱.

## 기술 스택

- **Framework**: Next.js 14 (App Router) · React · TypeScript
- **UI**: Tailwind CSS · shadcn/ui
- **DB / Auth / Vector**: Supabase (Postgres + pgvector)
- **AI**: Google Gemini 1.5 Pro (멀티모달 OCR + 생성) · `text-embedding-004` (768d)
- **Web Search**: Tavily API
- **Export**: html2canvas · jspdf

---

## 1. 사전 준비

1. [Supabase](https://supabase.com) 프로젝트 생성
2. [Google AI Studio](https://aistudio.google.com/app/apikey) 에서 Gemini API 키 발급
3. [Tavily](https://app.tavily.com) API 키 발급

## 2. 환경 변수

```bash
cp .env.local.example .env.local
```

`.env.local` 을 실제 값으로 채웁니다. (`SUPABASE_SERVICE_ROLE_KEY` 는 서버 전용)

## 3. Supabase 스키마 적용

Supabase Dashboard > **SQL Editor** 에서 아래 순서로 실행:

1. `supabase/schema.sql` — 테이블 / RLS / 트리거 / pgvector
2. `supabase/functions.sql` — 유사도 검색 RPC
3. `supabase/storage.sql` — `documents` 버킷 + 정책

## 4. 설치 및 실행

```bash
npm install
npm run dev
```

`http://localhost:3000` 접속.

## 5. 첫 관리자 지정

1. `/signup` 으로 회원가입 (기본은 **미승인** 상태 → `/pending`)
2. Supabase **SQL Editor** 에서 본인 계정을 승인 + 관리자로 승격:

```sql
update public.profiles
set role = 'admin', is_approved = true
where email = '본인이메일@회사.com';
```

3. 다시 로그인하면 `/admin` 접근 가능. 이후 다른 팀원은 관리자 페이지에서 승인.

---

## 주요 동작

| 영역 | 설명 |
|---|---|
| **권한** | 미들웨어에서 인증/승인/관리자 라우팅 가드. 미승인 → `/pending` |
| **업로드** | 클라이언트 SHA-256 해시로 **중복 사전 차단** → 서버 재검증 → Storage 저장 → (이미지=Gemini Vision OCR) 텍스트 추출 → 청킹 → 임베딩 → pgvector |
| **RAG** | 질문 임베딩 → `match_document_chunks` 검색. 최고 유사도 < 0.55 면 카테고리 분류 후 Tavily 딥서치 보강 |
| **답변** | Gemini 가 강제 JSON 스키마(`presentation`/`script`/`external_references`)로 응답 |
| **UI** | 슬라이드 카드(우상단 PDF/이미지 다운로드) + 마크다운 스크립트 + 회색 "외부 내용 참고란" |
| **관리자** | 자료 목록/열람/삭제(DB+Storage+벡터 동시 삭제), 사용자 승인/권한 관리 |

## 디렉터리

```
supabase/            스키마·함수·스토리지 SQL
src/
  app/
    (app)/           인증·승인 필요한 보호 영역 (chat·upload·admin)
    api/             upload · chat · admin/* 라우트 핸들러
    login·signup·pending·auth
  components/        ui(shadcn) · chat · upload · admin · nav
  lib/
    supabase/        client·server·admin·middleware
    gemini·embeddings·tavily·chunking·hash·ingest·rag·auth
  types/
middleware.ts        세션 갱신 + 라우팅 가드
```

## 튜닝 포인트

- `src/lib/rag.ts` : `SIMILARITY_THRESHOLD`(웹검색 전환 임계치), `RETRIEVE_*`
- `src/lib/chunking.ts` : `chunkSize` / `overlap`
- `supabase/schema.sql` : ivfflat `lists` (데이터 규모에 맞춰 조정)
