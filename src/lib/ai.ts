import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Vercel AI SDK 용 Google(Gemini) 프로바이더.
 * 기존 GEMINI_API_KEY(AI Studio 키)를 그대로 사용한다.
 */
export const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

/** 스트리밍 답변에 사용할 기본 모델 */
export const STREAM_MODEL = "gemini-2.5-flash";
