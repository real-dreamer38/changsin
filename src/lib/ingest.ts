import { extractTextFromImage, extractTextFromPdfWithGemini } from "./gemini";
import { chunkText } from "./chunking";
import { embedBatch } from "./embeddings";
import { createAdminClient } from "./supabase/admin";

export type FileKind = "txt" | "pdf" | "png" | "jpg" | "docx";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function detectKind(fileName: string, mimeType: string): FileKind | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "txt" || mimeType === "text/plain") return "txt";
  if (ext === "pdf" || mimeType === "application/pdf") return "pdf";
  if (ext === "png" || mimeType === "image/png") return "png";
  if (["jpg", "jpeg"].includes(ext ?? "") || mimeType === "image/jpeg")
    return "jpg";
  if (ext === "docx" || mimeType === DOCX_MIME) return "docx";
  return null;
}

/** 파일 종류별 텍스트 추출 */
export async function extractText(
  buffer: Buffer,
  kind: FileKind,
  mimeType: string
): Promise<string> {
  switch (kind) {
    case "txt":
      return buffer.toString("utf-8");
    case "pdf": {
      // pdf-parse 는 CJS 모듈. 동적 import 로 번들 이슈 회피.
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(buffer);
      const text = (data.text ?? "").trim();
      if (text.length > 0) return text;
      // 텍스트 레이어가 없는 스캔본 PDF → Gemini 멀티모달 폴백
      return extractTextFromPdfWithGemini(buffer);
    }
    case "docx": {
      // mammoth 는 CJS 모듈. 동적 import 로 번들 이슈 회피.
      const mammoth = (await import("mammoth")).default ?? (await import("mammoth"));
      const { value } = await mammoth.extractRawText({ buffer });
      return value;
    }
    case "png":
    case "jpg": {
      const base64 = buffer.toString("base64");
      return extractTextFromImage(base64, mimeType);
    }
  }
}

/**
 * 추출된 텍스트를 청킹 → 임베딩 → document_chunks 에 저장.
 * documents 행은 호출 측에서 미리 생성(status='processing')되어 있어야 함.
 */
export async function embedAndStore(
  documentId: string,
  fullText: string
): Promise<number> {
  const supabase = createAdminClient();
  const chunks = chunkText(fullText);

  if (chunks.length === 0) {
    return 0;
  }

  // 임베딩: 내부에서 5~10개씩 배치 + 배치 간 딜레이 + 429 지수 백오프 처리
  const embeddings = await embedBatch(chunks);

  const rows = chunks.map((content, i) => ({
    document_id: documentId,
    chunk_index: i,
    content,
    embedding: embeddings[i],
  }));

  // DB 저장도 한 번에 몰아넣지 않고 배치 단위로 insert
  const DB_BATCH = 100;
  for (let i = 0; i < rows.length; i += DB_BATCH) {
    const { error } = await supabase
      .from("document_chunks")
      .insert(rows.slice(i, i + DB_BATCH));
    if (error) throw new Error(`청크 저장 실패: ${error.message}`);
  }

  return rows.length;
}
