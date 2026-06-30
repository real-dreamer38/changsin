import { genAI, GENERATION_MODEL, ANSWER_SCHEMA } from "./gemini";
import { embedQuery } from "./embeddings";
import { tavilySearch } from "./tavily";
import { createAdminClient } from "./supabase/admin";
import type { AiAnswer, ChatResponse, MatchedChunk } from "@/types";

// 관련도 임계치: 이 값 미만이면 사내 자료가 불충분하다고 판단 → 웹 딥서치
const SIMILARITY_THRESHOLD = 0.55;
// retrieval 시 1차로 가져올 후보 (느슨한 임계치)
const RETRIEVE_THRESHOLD = 0.35;
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

  // --- 1) 내부 자료 검색 ---
  const queryEmbedding = await embedQuery(question);
  const { data: matches, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: queryEmbedding,
    match_threshold: RETRIEVE_THRESHOLD,
    match_count: RETRIEVE_COUNT,
  });

  if (error) {
    throw new Error(`벡터 검색 실패: ${error.message}`);
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

  const internalContext = chunks
    .map(
      (c, i) =>
        `[사내자료 ${i + 1} | 출처: ${c.file_name} | 유사도: ${c.similarity.toFixed(
          2
        )}]\n${c.content}`
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
  const system = `당신은 사내 자료를 기반으로 정확하게 답하는 내부용 AI 어시스턴트입니다.
규칙:
- 제공된 "사내 자료"를 최우선 근거로 사용하세요.
- 사내 자료에 없는 내용을 지어내지 마세요(할루시네이션 금지).
- 웹 검색 결과가 제공된 경우에만 외부 정보를 보조로 사용하고, 사용한 출처를 external_references 에 명시하세요.
- 근거가 부족하면 "제공된 자료로는 확인되지 않습니다"라고 솔직히 밝히세요.
- script 는 발표 스크립트처럼 제목/소제목/문단이 잘 구분된 마크다운으로 작성하세요.
- presentation.points 는 핵심 포인트 3~5개로 작성하세요.`;

  const prompt = `# 사용자 질문
${question}

# 사내 자료 (벡터 검색 결과)
${ctx.internalContext || "(관련 사내 자료를 찾지 못했습니다.)"}

${
  ctx.usedWeb
    ? `# 웹 딥서치 결과 (보조 근거)
${ctx.webContext || "(웹 결과 없음)"}

위 웹 출처를 사용했다면 external_references 에 "설명 — URL" 형식으로 넣으세요.`
    : "# 웹 검색\n수행하지 않음. external_references 는 빈 배열로 두세요."
}

위 근거를 종합하여 제안서 슬라이드(presentation)와 상세 스크립트(script)를 생성하세요.`;

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
