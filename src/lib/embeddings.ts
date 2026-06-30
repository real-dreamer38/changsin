import { genAI, EMBEDDING_MODEL, EMBEDDING_DIM } from "./gemini";
import { TaskType } from "@google/generative-ai";
import { sleep } from "./utils";

// --- Rate limit 대응 파라미터 ---
const EMBED_BATCH_SIZE = 8; // 한 번에 보낼 청크 수 (5~10 권장)
const BATCH_DELAY_MS = 1500; // 배치 사이 딜레이 (1~2초)
const MAX_RETRIES = 5; // 지수 백오프 최대 재시도 횟수
const BASE_BACKOFF_MS = 1000; // 백오프 기준값 (1s, 2s, 4s, ...)

/** 429(Rate Limit) / 일시적 서버 오류인지 판별 */
function isRetriableError(err: any): boolean {
  const status = err?.status ?? err?.code;
  if (status === 429 || status === 500 || status === 503) return true;
  const msg = String(err?.message ?? err);
  return (
    /\b(429|500|503)\b/.test(msg) ||
    /too many requests|rate limit|quota|overloaded|unavailable|deadline|try again/i.test(
      msg
    )
  );
}

/** 지수 백오프 + 지터로 재시도하는 래퍼 */
async function withBackoff<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (!isRetriableError(err) || attempt > MAX_RETRIES) {
        throw err;
      }
      // 1s, 2s, 4s, 8s, 16s (+ 지터) — 상한 30s
      const backoff = Math.min(
        BASE_BACKOFF_MS * 2 ** (attempt - 1),
        30_000
      );
      const jitter = Math.floor(Math.random() * 500);
      console.warn(
        `[embeddings] ${label} 재시도 ${attempt}/${MAX_RETRIES} — ${backoff +
          jitter}ms 후 (${String((err as any)?.message ?? err).slice(0, 120)})`
      );
      await sleep(backoff + jitter);
    }
  }
}

/** 단일 텍스트 임베딩 (768차원). taskType 으로 문서/질의 구분 */
export async function embedText(
  text: string,
  taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  return withBackoff(async () => {
    const result = await model.embedContent({
      content: { role: "user", parts: [{ text }] },
      taskType,
      // gemini-embedding-001 기본 3072 → 768 로 축소 (SDK 0.21 타입 미선언)
      outputDimensionality: EMBEDDING_DIM,
    } as any);
    return result.embedding.values;
  }, "embedText");
}

/** 단일 배치(소량) 임베딩 — 내부용 */
async function embedOneBatch(texts: string[]): Promise<number[][]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.batchEmbedContents({
    requests: texts.map((text) => ({
      content: { role: "user", parts: [{ text }] },
      taskType: TaskType.RETRIEVAL_DOCUMENT,
      outputDimensionality: EMBEDDING_DIM,
    })) as any,
  });
  return result.embeddings.map((e) => e.values);
}

/**
 * 여러 청크를 임베딩.
 * 한 번에 보내지 않고 EMBED_BATCH_SIZE(기본 8)개씩 잘라 순차 처리하며,
 * 배치 사이에 딜레이를 두고, 각 배치는 429 지수 백오프로 재시도한다.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const out: number[][] = [];
  const total = Math.ceil(texts.length / EMBED_BATCH_SIZE);

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batchNo = Math.floor(i / EMBED_BATCH_SIZE) + 1;
    const slice = texts.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await withBackoff(
      () => embedOneBatch(slice),
      `배치 ${batchNo}/${total}`
    );
    out.push(...embeddings);

    // 마지막 배치가 아니면 딜레이로 속도 조절
    if (i + EMBED_BATCH_SIZE < texts.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return out;
}

/** 질의(질문) 전용 임베딩 */
export async function embedQuery(text: string): Promise<number[]> {
  return embedText(text, TaskType.RETRIEVAL_QUERY);
}
