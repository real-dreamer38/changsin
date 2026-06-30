import { NextResponse } from "next/server";
import { streamObject } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { google, STREAM_MODEL } from "@/lib/ai";
import { retrieveContext, buildAnswerPrompt } from "@/lib/rag";

export const maxDuration = 60; // Vercel 무료(Hobby) 티어 최대치

// 스트리밍으로 채워질 구조화 답변 스키마 (기존 AiAnswer 와 동일 형태)
const answerSchema = z.object({
  presentation: z.object({
    title: z.string().describe("제안서/슬라이드 제목"),
    points: z.array(z.string()).describe("핵심 포인트 3~5개"),
    diagram_text: z.string().describe("도식/흐름을 설명하는 짧은 텍스트"),
  }),
  script: z
    .string()
    .describe("발표 스크립트처럼 제목/문단이 구분된 상세 마크다운"),
  external_references: z
    .array(z.string())
    .nullable()
    .describe("웹 출처 '설명 — URL' 목록. 없으면 null"),
});

/** 에러를 사용자용 친절 메시지로 변환 */
function toFriendlyError(e: any): string {
  const msg = String(e?.message ?? e);
  if (/429|quota|rate limit|too many requests|resource exhausted/i.test(msg)) {
    return "AI 사용량 한도(429)에 도달했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "답변 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}

export async function POST(request: Request) {
  // 승인 사용자만
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_approved")
    .eq("id", user.id)
    .single();
  if (!profile?.is_approved) {
    return NextResponse.json({ error: "승인된 사용자가 아닙니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const question = (body?.question ?? "").toString().trim();
  if (!question) {
    return NextResponse.json({ error: "질문을 입력하세요." }, { status: 400 });
  }

  const encoder = new TextEncoder();

  // NDJSON 스트림: 응답을 '즉시' 반환해 연결을 열고, 내부에서 검색→생성을 진행한다.
  // - status: 초기/하트비트 더미 (5초 이내 + 주기적으로 송출 → keep-alive)
  // - meta:   RAG 근거(badge) 메타데이터
  // - object: 부분 답변(스트리밍)
  // - done:   최종 답변
  // - error:  처리 중 발생한 오류(친절 메시지)
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      // 검색/생성이 느려도 연결이 끊기지 않도록 5초마다 하트비트
      send({ type: "status", message: "자료를 분석 중입니다..." });
      const heartbeat = setInterval(() => {
        send({ type: "status", message: "자료를 분석 중입니다..." });
      }, 5000);

      try {
        // 1) RAG 컨텍스트 검색 (벡터 + 필요 시 웹 딥서치)
        const ctx = await retrieveContext(question);
        send({
          type: "meta",
          used_internal: ctx.usedInternal,
          used_web: ctx.usedWeb,
          source_files: ctx.sourceFiles,
          web_references: ctx.webReferences,
        });

        // 2) 구조화 답변 스트리밍
        const { system, prompt } = buildAnswerPrompt(question, ctx);
        const result = streamObject({
          model: google(STREAM_MODEL),
          schema: answerSchema,
          system,
          prompt,
          temperature: 0.3,
        });

        clearInterval(heartbeat); // 이제 object 이벤트가 연결을 유지
        for await (const partial of result.partialObjectStream) {
          send({ type: "object", object: partial });
        }
        const final = await result.object; // 검증 실패 시 throw
        send({ type: "done", object: final });
      } catch (e) {
        console.error("RAG 스트리밍 오류:", e);
        send({ type: "error", message: toFriendlyError(e) });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      // 프록시(Nginx 등) 버퍼링 방지로 즉시 flush
      "x-accel-buffering": "no",
    },
  });
}
