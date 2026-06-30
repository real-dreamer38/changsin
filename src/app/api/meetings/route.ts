import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { genAI, GENERATION_MODEL, MEETING_SCHEMA } from "@/lib/gemini";
import type { MeetingAnalysis } from "@/types";

export const maxDuration = 60; // Vercel 무료(Hobby) 티어 최대치

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
  const text = (body?.text ?? "").toString().trim();
  if (text.length < 10) {
    return NextResponse.json(
      { error: "분석할 회의 내용을 충분히 입력하세요." },
      { status: 400 }
    );
  }

  try {
    const model = genAI.getGenerativeModel({
      model: GENERATION_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: MEETING_SCHEMA,
        temperature: 0.3,
      },
      systemInstruction: `당신은 회의록을 분석해 핵심을 정리하고 후속 작업을 도출하는 전문 비서입니다.
규칙:
- summary 는 읽기 좋은 마크다운(소제목/불릿)으로, 회의의 배경·핵심 논의·결론을 정리하세요.
- action_items 는 실행 가능한 후속 작업으로, 가능하면 "(담당자/기한)"을 괄호로 덧붙이세요.
- 이 회의가 '제안서'나 '기획 문서' 작성으로 이어져야 하는 성격이면 requires_presentation 을 true 로 판단하세요.
- requires_presentation 이 true 일 때만 presentation(제목/포인트/도식 설명)을 제안서 초안 형태로 작성하세요. false 면 presentation 은 비워 두세요.
- 반드시 지정된 JSON 스키마로만 응답하세요.`,
    });

    const prompt = `# 회의록 (클로바노트 등에서 변환한 텍스트)
${text}

위 회의 내용을 분석하여 지정된 JSON 스키마로 응답하세요.`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text();

    let parsed: MeetingAnalysis;
    try {
      parsed = JSON.parse(raw) as MeetingAnalysis;
    } catch {
      return NextResponse.json(
        { error: "AI 응답 형식 처리에 실패했습니다. 다시 시도해 주세요." },
        { status: 502 }
      );
    }

    // 정규화: 제안서가 필요 없으면 presentation 제거
    if (!parsed.requires_presentation || !parsed.presentation?.title) {
      parsed.requires_presentation = false;
      parsed.presentation = null;
    }

    return NextResponse.json(parsed);
  } catch (e: any) {
    console.error("회의 분석 오류:", e);
    return NextResponse.json(
      { error: `회의 분석 실패: ${e?.message ?? e}` },
      { status: 500 }
    );
  }
}
