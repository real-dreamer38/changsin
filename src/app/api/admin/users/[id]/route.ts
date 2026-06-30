import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60; // Vercel 무료(Hobby) 티어 최대치

/** 관리자: 사용자 승인 상태 / 권한 변경 */
export async function PATCH(
  request: Request,
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
  const { data: me } = await supabase
    .from("profiles")
    .select("role, is_approved")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin" || !me.is_approved) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const patch: { is_approved?: boolean; role?: "user" | "admin" } = {};
  if (typeof body.is_approved === "boolean") patch.is_approved = body.is_approved;
  if (body.role === "user" || body.role === "admin") patch.role = body.role;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "변경할 값이 없습니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update(patch).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
