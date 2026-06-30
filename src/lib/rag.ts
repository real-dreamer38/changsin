import { genAI, GENERATION_MODEL, ANSWER_SCHEMA } from "./gemini";
import { embedQuery } from "./embeddings";
import { tavilySearch } from "./tavily";
import { createAdminClient } from "./supabase/admin";
import type { AiAnswer, ChatResponse, MatchedChunk } from "@/types";

// 관련도 임계치: 이 값 미만이면 사내 자료가 불충분하다고 판단 → 웹 딥서치
const SIMILARITY_THRESHOLD = 0.55;
// 하이브리드 검색으로 가져올 청크 수
const RETRIEVE_COUNT = 8;

export interface RagContext {
  /** 벡터 검색으로 구성한 사내 자료 컨텍스트 */
  internalContext: string;
  /** 웹 딥서치 보조 컨텍스트 */
  webContext: string;
  usedInternal: boolean;
  usedWeb: boolean;
  /** 참고한 사내 자료 파일명 목록 */
  sourceFiles: string[];
  /** 웹 출처 ("제목 — URL") 목록 */
  webReferences: string[];
}

/**
 * RAG 컨텍스트 검색 (답변 생성 직전 단계까지).
 * 1) 질문 임베딩 → pgvector 유사도 검색
 * 2) 최고 유사도가 임계치 미만이면 Tavily 웹 딥서치 보강
 * 스트리밍/비스트리밍 답변 생성 양쪽에서 재사용한다.
 */
export async function retrieveContext(question: string): Promise<RagContext> {
  const supabase = createAdminClient();

  // --- 1) 내부 자료 검색 (하이브리드: 전문검색 + 벡터 RRF) ---
  const queryEmbedding = await embedQuery(question);
  const { data: matches, error } = await supabase.rpc(
    "hybrid_match_document_chunks",
    {
      query_text: question,
      query_embedding: queryEmbedding,
      match_count: RETRIEVE_COUNT,
    }
  );

  if (error) {
    throw new Error(`하이브리드 검색 실패: ${error.message}`);
  }

  const chunks = (matches ?? []) as MatchedChunk[];
  const topSimilarity = chunks.length > 0 ? chunks[0].similarity : 0;
  const usedInternal = chunks.length > 0;

  // --- 2) 할루시네이션 방지: 사내 자료 부족 시 웹 딥서치 ---
  let webContext = "";
  let webReferences: string[] = [];
  let usedWeb = false;

  if (topSimilarity < SIMILARITY_THRESHOLD) {
    try {
      const category = await classifyCategory(question);
      const searchQuery = category ? `${question} (${category})` : question;
      const tavily = await tavilySearch(searchQuery, 5);
      usedWeb = true;

      webReferences = tavily.results.map((r) => `${r.title} — ${r.url}`);
      webContext = tavily.results
        .map((r, i) => `[웹출처 ${i + 1}] ${r.title}\n${r.content}\nURL: ${r.url}`)
        .join("\n\n");
      if (tavily.answer) {
        webContext = `[웹 요약]\n${tavily.answer}\n\n${webContext}`;
      }
    } catch (e) {
      // 웹 검색 실패는 치명적이지 않음 — 내부 자료만으로 진행
      console.error("Tavily 검색 실패:", e);
    }
  }

  // 각 청크에 원본 파일명을 명시적으로 묶어 전달 → 답변에 출처(Citation) 표기 가능
  const internalContext = chunks
    .map(
      (c, i) =>
        `[사내자료 ${i + 1} | 파일명: ${c.file_name}]\n${c.content}`
    )
    .join("\n\n");

  const sourceFiles = Array.from(new Set(chunks.map((c) => c.file_name)));

  return {
    internalContext,
    webContext,
    usedInternal,
    usedWeb,
    sourceFiles,
    webReferences,
  };
}

/**
 * 하이브리드 RAG 파이프라인 (비스트리밍 — 한 번에 JSON 반환).
 */
export async function runRagPipeline(question: string): Promise<ChatResponse> {
  const ctx = await retrieveContext(question);

  const answer = await generateAnswer({
    question,
    internalContext: ctx.internalContext,
    webContext: ctx.webContext,
    usedWeb: ctx.usedWeb,
  });

  return {
    ...answer,
    // 외부 참고가 비어있으면 null 로 정규화
    external_references:
      answer.external_references && answer.external_references.length > 0
        ? answer.external_references
        : ctx.usedWeb && ctx.webReferences.length > 0
          ? ctx.webReferences
          : null,
    used_internal: ctx.usedInternal,
    used_web: ctx.usedWeb,
    source_files: ctx.sourceFiles,
  };
}

/** 스트리밍 답변용 프롬프트 구성 (system / prompt 문자열) */
export function buildAnswerPrompt(question: string, ctx: RagContext): {
  system: string;
  prompt: string;
} {
  const system = `당신은 제공된 [사내 문서 데이터]를 최우선으로 신뢰하는 '사내 전문 백과사전' AI 입니다.
웹 기반 일반 챗봇이 아니라, 우리 회사 내부 지식의 권위자로서 사내 문서를 절대 기준으로 삼아 답합니다.

[절대 원칙 — 사내 문서 우위]
1. 회사명·브랜드명·제품명·인물명 등 모든 고유명사의 '정체성'은 오직 [사내 문서]를 기준으로 정의한다.
2. 특정 고유명사에 대해, [사내 문서]에 기술된 맥락(산업군·특징·우리 회사와의 관계 등)과 [웹 검색]의 맥락이 충돌하거나 서로 다른 산업군/다른 회사를 가리키면, [웹 검색] 정보는 '동명의 다른 대상'으로 간주하고 무조건 무시한다. 반드시 [사내 문서] 기준으로만 답한다.
3. [웹 검색]은 [사내 문서]에 이미 존재하는 내용을 부연 설명하기 위한 '일반 지식' 용도로만 보조 사용한다. 고유명사의 정체성을 웹 정보로 절대 덮어쓰지 않는다.
4. [사내 문서]에 근거가 없으면 지어내지 말고 "제공된 사내 자료로는 확인되지 않습니다"라고 솔직히 밝힌다.
5. 웹 검색을 보조로 사용했다면 external_references 에 "설명 — URL" 형식으로 명시한다. 사용하지 않았으면 빈 배열/ null.
6. script 는 발표 스크립트처럼 제목/소제목/문단이 잘 구분된 마크다운으로, presentation.points 는 핵심 포인트 3~5개로 작성한다.

[출처(Citation) 표기 — 필수]
- [사내 문서] 내용을 근거로 문장/단락을 작성할 때는, 반드시 그 문장 또는 단락의 끝에 출처를 \`[참고: 파일명.pdf]\` 형태로 표기한다.
- 출처에 쓰는 파일명은 각 사내자료 블록의 "파일명:" 값을 그대로 사용한다(지어내지 말 것).
- 서로 다른 파일을 함께 근거로 썼다면 \`[참고: A.pdf, B.docx]\` 처럼 함께 표기한다.
- 출처 표기는 주로 script 본문에 단다. 사내 자료가 전혀 없어 근거가 없으면 출처를 달지 않는다.`;

  const prompt = `# 사용자 질문
${question}

# [사내 문서 데이터] (최우선·절대 기준 — 벡터 검색 결과)
${ctx.internalContext || "(관련 사내 자료를 찾지 못했습니다.)"}

${
  ctx.usedWeb
    ? `# [웹 검색] (보조 일반지식 — 고유명사 정체성에는 사용 금지)
${ctx.webContext || "(웹 결과 없음)"}

주의: 위 [웹 검색] 결과가 [사내 문서]와 다른 산업군/다른 회사를 가리키면 '동명의 다른 대상'이므로 무시하고, 반드시 [사내 문서] 기준으로만 답하세요. 웹을 실제로 인용했다면 external_references 에 "설명 — URL" 형식으로 넣으세요.`
    : "# [웹 검색]\n수행하지 않음. external_references 는 빈 배열/ null 로 두세요."
}

위 근거를 [사내 문서] 우선 원칙에 따라 종합하여, 제안서 슬라이드(presentation)와 상세 스크립트(script)를 생성하세요.`;

  return { system, prompt };
}

/** 질문 카테고리 파악 (웹 검색 쿼리 보강용) */
async function classifyCategory(question: string): Promise<string | null> {
  try {
    const model = genAI.getGenerativeModel({ model: GENERATION_MODEL });
    const res = await model.generateContent(
      `다음 질문의 핵심 주제 카테고리를 한국어 명사구 하나로만 답하세요. 설명 금지.\n질문: "${question}"`
    );
    const out = res.response.text().trim().replace(/[".]/g, "");
    return out.length > 0 && out.length < 40 ? out : null;
  } catch {
    return null;
  }
}

interface GenerateArgs {
  question: string;
  internalContext: string;
  webContext: string;
  usedWeb: boolean;
}

async function generateAnswer({
  question,
  internalContext,
  webContext,
  usedWeb,
}: GenerateArgs): Promise<AiAnswer> {
  const model = genAI.getGenerativeModel({
    model: GENERATION_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: ANSWER_SCHEMA,
      temperature: 0.3,
    },
    systemInstruction: `당신은 사내 자료를 기반으로 정확하게 답하는 내부용 AI 어시스턴트입니다.
규칙:
- 제공된 "사내 자료"를 최우선 근거로 사용하세요.
- 사내 자료에 없는 내용을 지어내지 마세요(할루시네이션 금지).
- 웹 검색 결과가 제공된 경우에만 외부 정보를 보조로 사용하고, 사용한 출처를 external_references 에 명시하세요.
- 근거가 부족하면 "제공된 자료로는 확인되지 않습니다"라고 솔직히 밝히세요.
- script 는 발표 스크립트처럼 제목/소제목/문단이 잘 구분된 마크다운으로 작성하세요.
- 반드시 지정된 JSON 스키마로만 응답하세요.`,
  });

  const prompt = `# 사용자 질문
${question}

# 사내 자료 (벡터 검색 결과)
${internalContext || "(관련 사내 자료를 찾지 못했습니다.)"}

${
  usedWeb
    ? `# 웹 딥서치 결과 (보조 근거)
${webContext || "(웹 결과 없음)"}

위 웹 출처를 사용했다면 external_references 에 "설명 — URL" 형식으로 넣으세요.`
    : "# 웹 검색\n수행하지 않음. external_references 는 빈 배열로 두세요."
}

위 근거를 종합하여 지정된 JSON 스키마로 답변을 생성하세요.`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text();

  let parsed: AiAnswer;
  try {
    parsed = JSON.parse(raw) as AiAnswer;
  } catch {
    // 스키마 강제에도 파싱 실패 시 폴백
    parsed = {
      presentation: {
        title: "답변",
        points: ["응답 형식 처리 중 오류가 발생했습니다."],
        diagram_text: "",
      },
      script: raw,
      external_references: null,
    };
  }

  return parsed;
}
