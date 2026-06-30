import { NextResponse } from "next/server";
import { streamObject } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { google, STREAM_MODEL } from "@/lib/ai";
import { retrieveContext, buildAnswerPrompt } from "@/lib/rag";

export const maxDuration = 120;

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

  try {
    // 1) RAG 컨텍스트 검색 (벡터 + 필요 시 웹 딥서치)
    const ctx = await retrieveContext(question);
    const { system, prompt } = buildAnswerPrompt(question, ctx);

    // 2) 구조화 답변을 스트리밍 (presentation/script 가 실시간으로 채워짐)
    const result = streamObject({
      model: google(STREAM_MODEL),
      schema: answerSchema,
      system,
      prompt,
      temperature: 0.3,
    });

    // 3) 근거 메타데이터는 헤더로 전달 (클라이언트 badge 렌더용)
    const meta = encodeURIComponent(
      JSON.stringify({
        used_internal: ctx.usedInternal,
        used_web: ctx.usedWeb,
        source_files: ctx.sourceFiles,
        web_references: ctx.webReferences,
      })
    );

    return result.toTextStreamResponse({
      headers: { "x-rag-meta": meta },
    });
  } catch (e: any) {
    console.error("RAG 스트리밍 오류:", e);
    return NextResponse.json(
      { error: `답변 생성 실패: ${e?.message ?? e}` },
      { status: 500 }
    );
  }
}
