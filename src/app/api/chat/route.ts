import { NextResponse } from "next/server";
import { streamObject } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { google, STREAM_MODEL } from "@/lib/ai";
import { retrieveContext, buildAnswerPrompt } from "@/lib/rag";
import type { ChatResponse } from "@/types";

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
  const requestedSessionId =
    typeof body?.sessionId === "string" ? body.sessionId : null;
  if (!question) {
    return NextResponse.json({ error: "질문을 입력하세요." }, { status: 400 });
  }

  // 채팅 기록 저장은 RLS 우회 이슈/스트림 중 쿠키쓰기 회피를 위해 admin 클라이언트로 처리(소유권 수동 검증)
  const admin = createAdminClient();
  const userId = user.id;

  /** 세션 확보: 기존 세션 검증 또는 신규 생성. 실패해도 채팅은 진행(best-effort). */
  async function ensureSession(): Promise<{ id: string; title: string } | null> {
    try {
      if (requestedSessionId) {
        const { data } = await admin
          .from("chat_sessions")
          .select("id, title, user_id")
          .eq("id", requestedSessionId)
          .maybeSingle();
        if (data && data.user_id === userId) {
          return { id: data.id, title: data.title };
        }
      }
      const title = question.slice(0, 60);
      const { data, error } = await admin
        .from("chat_sessions")
        .insert({ user_id: userId, title })
        .select("id, title")
        .single();
      if (error || !data) {
        console.error("세션 생성 실패:", error?.message);
        return null;
      }
      return data;
    } catch (e) {
      console.error("세션 확보 오류:", e);
      return null;
    }
  }

  const encoder = new TextEncoder();

  // NDJSON 스트림: 응답을 '즉시' 반환해 연결을 열고, 내부에서 검색→생성→저장을 진행.
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      send({ type: "status", message: "자료를 분석 중입니다..." });
      const heartbeat = setInterval(() => {
        send({ type: "status", message: "자료를 분석 중입니다..." });
      }, 5000);

      let sessionId: string | null = null;

      try {
        // 0) 세션 확보 + 사용자 메시지 저장
        const session = await ensureSession();
        if (session) {
          sessionId = session.id;
          send({ type: "session", id: session.id, title: session.title });
          await admin
            .from("chat_messages")
            .insert({ session_id: session.id, role: "user", content: question })
            .then(({ error }) => {
              if (error) console.error("사용자 메시지 저장 실패:", error.message);
            });
        }

        // 1) RAG 컨텍스트 검색 (하이브리드: FTS + 벡터)
        const ctx = await retrieveContext(question);

        // 2) 구조화 답변 스트리밍
        const { system, prompt } = buildAnswerPrompt(question, ctx);
        const result = streamObject({
          model: google(STREAM_MODEL),
          schema: answerSchema,
          system,
          prompt,
          temperature: 0.3,
        });

        clearInterval(heartbeat);
        for await (const partial of result.partialObjectStream) {
          send({ type: "object", object: partial });
        }
        const final = await result.object;

        // 3) 최종 ChatResponse 구성(메타 포함)
        const answer: ChatResponse = {
          presentation: final.presentation,
          script: final.script,
          external_references:
            final.external_references && final.external_references.length > 0
              ? final.external_references
              : ctx.usedWeb && ctx.webReferences.length > 0
                ? ctx.webReferences
                : null,
          used_internal: ctx.usedInternal,
          used_web: ctx.usedWeb,
          source_files: ctx.sourceFiles,
        };

        // 4) assistant 메시지 저장
        if (sessionId) {
          await admin
            .from("chat_messages")
            .insert({ session_id: sessionId, role: "assistant", answer })
            .then(({ error }) => {
              if (error) console.error("답변 저장 실패:", error.message);
            });
        }

        send({ type: "done", answer });
      } catch (e) {
        console.error("RAG 스트리밍 오류:", e);
        const message = toFriendlyError(e);
        if (sessionId) {
          await admin
            .from("chat_messages")
            .insert({ session_id: sessionId, role: "assistant", error: message })
            .then(() => {})
            .then(undefined, () => {});
        }
        send({ type: "error", message });
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
      "x-accel-buffering": "no",
    },
  });
}
