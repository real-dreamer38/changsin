import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** 특정 세션의 대화 내역 불러오기 (RLS 로 본인 것만) */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { data: session } = await supabase
    .from("chat_sessions")
    .select("id, title, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "세션을 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: messages, error } = await supabase
    .from("chat_messages")
    .select("id, session_id, role, content, answer, error, created_at")
    .eq("session_id", id)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ session, messages: messages ?? [] });
}

/** 세션 삭제 (메시지는 ON DELETE CASCADE) */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { error } = await supabase.from("chat_sessions").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
