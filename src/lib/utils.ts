import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 지정 ms 만큼 대기 (rate limit 백오프/딜레이용) */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch 응답을 안전하게 JSON 으로 읽는다.
 * - content-type 이 application/json 이면 정상 파싱해 반환(에러 상태 코드여도 본문은 그대로 반환 → 호출측이 res.ok 로 분기).
 * - JSON 이 아니면(예: Vercel 타임아웃 504/HTML 에러 페이지) 깔끔한 한국어 에러를 throw 해
 *   "Unexpected token ... is not valid JSON" 같은 파싱 폭발을 원천 차단한다.
 */
export async function safeJson<T = any>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return (await res.json()) as T;
    } catch {
      // content-type 은 json 인데 본문이 비었거나 깨진 경우 → 아래 공통 에러로 처리
    }
  }

  // JSON 이 아님(HTML/빈 응답/게이트웨이 타임아웃 등). 디버깅용으로만 본문 일부를 로깅.
  let raw = "";
  try {
    raw = (await res.text()).slice(0, 300);
  } catch {
    /* 본문조차 읽지 못하면 무시 */
  }
  console.error(`[safeJson] 비정상 응답 status=${res.status} ct='${contentType}':`, raw);

  throw new Error(
    "서버 응답 지연 또는 오류가 발생했습니다. (파일이 너무 크거나 API 한도 초과일 수 있습니다)"
  );
}

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}
