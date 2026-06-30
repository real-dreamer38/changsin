import {
  GoogleGenerativeAI,
  SchemaType,
  type ResponseSchema,
} from "@google/generative-ai";
import { sleep } from "./utils";

const apiKey = process.env.GEMINI_API_KEY!;
export const genAI = new GoogleGenerativeAI(apiKey);

export const GENERATION_MODEL = "gemini-2.5-flash";
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIM = 768; // DB 스키마 vector(768) 와 일치 (MRL 축소)

// ===== Gemini generateContent 전역 레이트리미터 + 끈질긴 재시도 =====
// 무료 티어 RPM(분당 요청, 예: 15 RPM) 회피용.
// 여러 이미지/PDF 가 동시에 들어와도 호출을 '직렬화'하고 최소 간격(4.5s)을 강제하며,
// 429 가 나면 API 가 알려준 대기시간을 파싱해 기다렸다가 최대 7회까지 재시도한다.
const GEN_MIN_GAP_MS = 4500; // 호출 사이 최소 간격(≈13 RPM, 15 RPM 안전 마진)
const GEN_MAX_RETRIES = 7; // 429 발생 시 최대 재시도 횟수 (넉넉하게)
const GEN_RETRY_MARGIN_MS = 2000; // API 가 알려준 대기시간에 더할 안전 마진(2초)
const GEN_DEFAULT_WAIT_MS = 15000; // 대기시간 파싱 실패 시 기본 15초
const GEN_MAX_WAIT_MS = 120000; // 1회 대기 상한 (2분)

let genChain: Promise<unknown> = Promise.resolve();
let genLastCallAt = 0;

/** 429(Rate Limit)/일시적 서버 오류 판별 */
export function isRateLimited(err: any): boolean {
  const status = err?.status ?? err?.code ?? err?.response?.status;
  if (status === 429 || status === 503 || status === 500) return true;
  const msg = String(err?.message ?? err);
  return /\b(429|503)\b|quota|rate limit|too many requests|resource exhausted|overloaded|unavailable|retry in/i.test(
    msg
  );
}

/**
 * 에러 메시지에서 명시적 대기시간을 파싱한다.
 * 예) "Please retry in 13.928348019s", "retryDelay":"14s", "retry after 10 s"
 * 반환: 밀리초(ms) 또는 null
 */
export function parseRetryDelayMs(err: any): number | null {
  const msg = String(err?.message ?? err);
  const patterns = [
    /retry in\s*([\d.]+)\s*s/i,
    /retryDelay["']?\s*[:=]\s*["']?([\d.]+)\s*s/i,
    /retry after\s*([\d.]+)\s*s/i,
  ];
  for (const re of patterns) {
    const m = msg.match(re);
    if (m) {
      const sec = parseFloat(m[1]);
      if (!Number.isNaN(sec) && sec >= 0) return Math.ceil(sec * 1000);
    }
  }
  return null;
}

/**
 * generateContent 호출을 전역 직렬화 + 최소 간격(4.5s) + 429 스마트 재시도로 감싼다.
 * - Promise.all 동시 호출 대신 '한 번에 하나씩'(체인) 순차 처리.
 * - 429 발생 시: API 가 알려준 시간(+2초) 또는 기본 15초(지수 증가) 대기 후 재시도(최대 7회).
 * - 429 는 절대 그대로 throw 하지 않는다(7회 모두 실패 시에만 친절한 메시지로 변환).
 */
export async function rateLimitedGenerate<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const run = genChain.then(async () => {
    // 1) 직전 호출과 최소 간격 보장 (RPM 제한 선제 회피)
    const since = Date.now() - genLastCallAt;
    if (genLastCallAt > 0 && since < GEN_MIN_GAP_MS) {
      await sleep(GEN_MIN_GAP_MS - since);
    }

    // 2) 끈질긴 재시도 루프
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const result = await fn();
        genLastCallAt = Date.now();
        return result;
      } catch (e) {
        // 429/일시적 오류가 아니면 그대로 전달 (코드/형식 오류 등)
        if (!isRateLimited(e)) {
          genLastCallAt = Date.now();
          throw e;
        }

        attempt++;
        if (attempt > GEN_MAX_RETRIES) {
          genLastCallAt = Date.now();
          // 7회 재시도에도 실패 → 원본 429 대신 친절한 메시지로 변환
          throw new Error(
            `Gemini API 사용량 한도(429)로 ${GEN_MAX_RETRIES}회 재시도 후에도 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.`
          );
        }

        // 대기시간 결정: API 명시값(+2초) 우선, 없으면 기본 15초 지수 증가
        const parsed = parseRetryDelayMs(e);
        const waitMs =
          parsed != null
            ? Math.min(parsed + GEN_RETRY_MARGIN_MS, GEN_MAX_WAIT_MS)
            : Math.min(
                GEN_DEFAULT_WAIT_MS * 2 ** (attempt - 1),
                GEN_MAX_WAIT_MS
              );

        console.warn(
          `[gemini] ${label} 429 — ${attempt}/${GEN_MAX_RETRIES}회차 재시도, ${(
            waitMs / 1000
          ).toFixed(1)}s 대기 ${parsed != null ? "(API 명시값)" : "(기본 백오프)"}`
        );
        await sleep(waitMs);
      }
    }
  });
  // 한 작업이 실패해도 체인이 끊기지 않도록 (다음 작업 계속 진행)
  genChain = run.then(
    () => undefined,
    () => undefined
  );
  return run as Promise<T>;
}

/** AI 답변 강제 JSON 스키마 (핵심 요구사항) */
export const ANSWER_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    presentation: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING, description: "시각화용 요약 제목" },
        points: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: "핵심 포인트 3~5개",
        },
        diagram_text: {
          type: SchemaType.STRING,
          description: "도식화나 흐름을 설명하는 짧은 텍스트",
        },
      },
      required: ["title", "points", "diagram_text"],
    },
    script: {
      type: SchemaType.STRING,
      description:
        "발표 스크립트처럼 읽기 좋게 타이틀/내용/문단이 구분된 상세 텍스트 (마크다운)",
    },
    external_references: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "웹 검색으로 얻은 외부 출처 링크 및 설명. 없으면 빈 배열.",
      nullable: true,
    },
  },
  required: ["presentation", "script"],
};

/** 회의록 분석 강제 JSON 스키마 (/meetings) */
export const MEETING_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    summary: {
      type: SchemaType.STRING,
      description: "회의 핵심 내용 및 결론 요약 (가독성 좋은 마크다운 포맷)",
    },
    action_items: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "후속 작업 목록 (가능하면 담당자/기한 포함)",
    },
    requires_presentation: {
      type: SchemaType.BOOLEAN,
      description:
        "이 회의가 후속으로 '제안서'나 '기획 문서' 작성이 필요한 성격인지 판단",
    },
    presentation: {
      type: SchemaType.OBJECT,
      nullable: true,
      description: "requires_presentation 이 true 일 때만 제안서 초안을 채움",
      properties: {
        title: { type: SchemaType.STRING, description: "제안서 제목" },
        points: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: "제안 포인트 3~5개",
        },
        diagram_text: {
          type: SchemaType.STRING,
          description: "도식화나 흐름을 설명하는 짧은 텍스트",
        },
      },
      required: ["title", "points", "diagram_text"],
    },
  },
  required: ["summary", "action_items", "requires_presentation"],
};

/**
 * 이미지에서 텍스트(OCR) + 상황 설명을 추출 (Gemini 1.5 Pro 멀티모달).
 */
export async function extractTextFromImage(
  base64Data: string,
  mimeType: string
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: GENERATION_MODEL });

  const prompt = `이 이미지는 내부 프로젝트 자료(문서 캡처, 채팅 캡처, 다이어그램 등)입니다.
다음을 한국어로 추출/정리하세요:
1) 이미지에 보이는 모든 텍스트를 빠짐없이 그대로 옮겨 적기 (OCR).
2) 채팅 캡처라면 화자/순서를 구분해 대화 흐름을 정리.
3) 표/도표/다이어그램이라면 구조와 의미를 설명.
4) 마지막에 한두 문장으로 전체 상황 요약.
설명용 머리말 없이, 추출된 내용만 출력하세요.`;

  // 전역 레이트리미터를 통해 직렬 + 4.5s 간격 + 429 백오프로 호출
  const result = await rateLimitedGenerate("image-ocr", () =>
    model.generateContent([
      { text: prompt },
      { inlineData: { data: base64Data, mimeType } },
    ])
  );

  return result.response.text().trim();
}

const PDF_OCR_PROMPT = `이 PDF는 내부 프로젝트 자료입니다. (텍스트 레이어가 없는 스캔본일 수 있습니다.)
다음을 한국어로 추출/정리하세요:
1) 문서에 보이는 모든 텍스트를 페이지 순서대로 빠짐없이 그대로 옮겨 적기 (OCR).
2) 표/도표/다이어그램은 구조와 의미를 설명.
3) 마지막에 한두 문장으로 전체 내용 요약.
설명용 머리말 없이, 추출된 내용만 출력하세요.`;

// 이 크기를 넘는 PDF 는 inline 대신 Files API 로 업로드해 처리 (요청 페이로드 한도 회피)
const INLINE_PDF_LIMIT = 7 * 1024 * 1024; // 7MB

/**
 * 텍스트 레이어가 없는(스캔본) PDF 를 Gemini 멀티모달로 직접 읽어 텍스트 추출.
 * - 작은 PDF: inlineData 로 바로 전송
 * - 큰 PDF(최대 50MB): Files API 로 업로드 후 fileData 참조
 */
export async function extractTextFromPdfWithGemini(
  buffer: Buffer
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: GENERATION_MODEL });

  if (buffer.length <= INLINE_PDF_LIMIT) {
    const result = await rateLimitedGenerate("pdf-ocr-inline", () =>
      model.generateContent([
        { text: PDF_OCR_PROMPT },
        {
          inlineData: {
            data: buffer.toString("base64"),
            mimeType: "application/pdf",
          },
        },
      ])
    );
    return result.response.text().trim();
  }

  // 대용량 PDF → Files API (서버 전용 모듈은 런타임 동적 import)
  const os = await import("os");
  const path = await import("path");
  const fs = await import("fs/promises");
  const { GoogleAIFileManager, FileState } = await import(
    "@google/generative-ai/server"
  );

  const fileManager = new GoogleAIFileManager(apiKey);
  const tmpPath = path.join(
    os.tmpdir(),
    `pdf-ocr-${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`
  );
  await fs.writeFile(tmpPath, buffer);

  try {
    const uploaded = await fileManager.uploadFile(tmpPath, {
      mimeType: "application/pdf",
      displayName: "scanned.pdf",
    });

    // 파일이 ACTIVE 상태가 될 때까지 폴링 (최대 2분)
    let file = uploaded.file;
    const start = Date.now();
    while (file.state === FileState.PROCESSING) {
      if (Date.now() - start > 120_000) {
        throw new Error("Gemini PDF 처리 시간 초과");
      }
      await sleep(2000);
      file = await fileManager.getFile(uploaded.file.name);
    }
    if (file.state === FileState.FAILED) {
      throw new Error("Gemini PDF 처리 실패");
    }

    const result = await rateLimitedGenerate("pdf-ocr-file", () =>
      model.generateContent([
        { text: PDF_OCR_PROMPT },
        {
          fileData: {
            fileUri: file.uri,
            mimeType: file.mimeType ?? "application/pdf",
          },
        },
      ])
    );

    // 업로드 파일 정리 (실패해도 무시)
    await fileManager.deleteFile(uploaded.file.name).catch(() => {});
    return result.response.text().trim();
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}
