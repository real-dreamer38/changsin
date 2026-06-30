import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** 관리자 자료 삭제: DB(documents+chunks CASCADE) + Storage 모두 제거 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 관리자 권한 검증
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_approved")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" || !profile.is_approved) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const admin = createAdminClient();

  // 1) storage_path 조회
  const { data: doc, error: fetchErr } = await admin
    .from("documents")
    .select("storage_path")
    .eq("id", id)
    .single();
  if (fetchErr || !doc) {
    return NextResponse.json({ error: "자료를 찾을 수 없습니다." }, { status: 404 });
  }

  // 2) Storage 객체 삭제
  const { error: storageErr } = await admin.storage
    .from("documents")
    .remove([doc.storage_path]);
  if (storageErr) {
    // 스토리지 삭제 실패해도 DB 정리는 진행하되 경고
    console.error("스토리지 삭제 경고:", storageErr.message);
  }

  // 3) DB 삭제 (document_chunks 는 ON DELETE CASCADE)
  const { error: delErr } = await admin.from("documents").delete().eq("id", id);
  if (delErr) {
    return NextResponse.json(
      { error: `DB 삭제 실패: ${delErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
