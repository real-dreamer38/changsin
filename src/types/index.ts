export type UserRole = "user" | "admin";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  is_approved: boolean;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  uploader_id: string | null;
  uploader_email: string | null;
  file_name: string;
  file_type: string;
  file_size: number | null;
  file_hash: string;
  storage_path: string;
  extracted_text: string | null;
  status: "processing" | "ready" | "error";
  error_message: string | null;
  created_at: string;
}

export interface MatchedChunk {
  id: string;
  document_id: string;
  content: string;
  file_name: string;
  similarity: number;
}

/** AI 답변 강제 JSON 스키마 (핵심 요구사항) */
export interface AiAnswer {
  presentation: {
    title: string;
    points: string[];
    diagram_text: string;
  };
  script: string;
  external_references: string[] | null;
}

export interface ChatResponse extends AiAnswer {
  /** 내부 자료 검색이 사용되었는지 */
  used_internal: boolean;
  /** 웹 딥서치가 사용되었는지 */
  used_web: boolean;
  /** 참고한 내부 자료 파일명 목록 */
  source_files: string[];
}

/** 회의록 분석 결과 (/meetings) */
export interface MeetingAnalysis {
  summary: string;
  action_items: string[];
  requires_presentation: boolean;
  presentation?: AiAnswer["presentation"] | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string; // user 메시지 텍스트
  answer?: ChatResponse; // assistant 일 때 구조화 답변
  error?: string;
}
