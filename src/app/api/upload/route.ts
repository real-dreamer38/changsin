import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256Buffer } from "@/lib/hash";
import {
  detectKind,
  extractText,
  embedAndStore,
  type FileKind,
} from "@/lib/ingest";

export const maxDuration = 60; // Vercel 무료(Hobby) 티어 최대치

const STORAGE_BUCKET = "documents";

const MIME_BY_KIND: Record<FileKind, string> = {
  txt: "text/plain",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * 원본 파일은 브라우저에서 Supabase Storage 로 '직접 업로드'된 상태로 들어온다.
 * 이 라우트는 파일 바이트를 직접 받지 않고(=Vercel 4.5MB 페이로드 제한 회피),
 * 경로/메타데이터(JSON)만 받아 서버에서 텍스트 추출 + pgvector 임베딩만 처리한다.
 */
export async function POST(request: Request) {
  // 1) 인증 + 승인 확인
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_approved, email")
    .eq("id", user.id)
    .single();
  if (!profile?.is_approved) {
    return NextResponse.json({ error: "승인된 사용자가 아닙니다." }, { status: 403 });
  }

  // 2) JSON 메타데이터 파싱 (파일 원본 X)
  let body: {
    storagePath?: string;
    hash?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }
  const { storagePath, hash, fileName, fileSize, mimeType } = body;
  if (!storagePath || !hash || !fileName) {
    return NextResponse.json(
      { error: "필수 정보(storagePath, hash, fileName)가 없습니다." },
      { status: 400 }
    );
  }

  // 3) 경로 위변조 방지 — 반드시 본인 폴더(uid/...) 의 객체만 허용
  if (!storagePath.startsWith(`${user.id}/`)) {
    return NextResponse.json(
      { error: "허용되지 않은 스토리지 경로입니다." },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  const kind = detectKind(fileName, mimeType ?? "");
  if (!kind) {
    // 업로드된 객체 정리
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: "지원하지 않는 형식입니다. (txt, pdf, docx, png, jpg)" },
      { status: 400 }
    );
  }

  // 4) 중복 체크 (해시)
  const { data: existing } = await admin
    .from("documents")
    .select("id, file_name")
    .eq("file_hash", hash)
    .maybeSingle();
  if (existing) {
    // 방금 브라우저가 올린 객체는 정리 (기존 문서 보존)
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json(
      {
        error: "duplicate",
        message: `이미 업로드된 자료입니다: ${existing.file_name}`,
      },
      { status: 409 }
    );
  }

  // 5) Storage 에서 원본 다운로드 (서버 처리용)
  const { data: blob, error: dlError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(storagePath);
  if (dlError || !blob) {
    return NextResponse.json(
      { error: `원본 파일을 찾을 수 없습니다: ${dlError?.message ?? "다운로드 실패"}` },
      { status: 400 }
    );
  }
  const buffer = Buffer.from(await blob.arrayBuffer());

  // 6) 서버측 해시 재계산 (위변조 방지) + 클라이언트 해시 대조
  const serverHash = await sha256Buffer(buffer);
  if (serverHash !== hash) {
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: "파일 해시가 일치하지 않습니다." },
      { status: 400 }
    );
  }

  // 7) documents 행 생성 (processing)
  const { data: doc, error: insertError } = await admin
    .from("documents")
    .insert({
      uploader_id: user.id,
      uploader_email: profile.email ?? user.email,
      file_name: fileName,
      file_type: kind,
      file_size: typeof fileSize === "number" ? fileSize : buffer.length,
      file_hash: hash,
      storage_path: storagePath,
      status: "processing",
    })
    .select("id")
    .single();
  if (insertError || !doc) {
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: `문서 등록 실패: ${insertError?.message}` },
      { status: 500 }
    );
  }

  // 8) 텍스트 추출 → 청킹 → 임베딩 → 저장
  try {
    const text = await extractText(buffer, kind, mimeType || MIME_BY_KIND[kind]);
    if (!text || text.trim().length === 0) {
      throw new Error("추출된 텍스트가 없습니다.");
    }
    const chunkCount = await embedAndStore(doc.id, text);

    await admin
      .from("documents")
      .update({ extracted_text: text, status: "ready" })
      .eq("id", doc.id);

    return NextResponse.json({
      ok: true,
      documentId: doc.id,
      fileName,
      chunks: chunkCount,
      textPreview: text.slice(0, 200),
    });
  } catch (e: any) {
    await admin
      .from("documents")
      .update({ status: "error", error_message: String(e?.message ?? e) })
      .eq("id", doc.id);
    return NextResponse.json(
      { error: `처리 실패: ${e?.message ?? e}`, documentId: doc.id },
      { status: 500 }
    );
  }
}
