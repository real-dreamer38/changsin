"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PresentationSlide } from "./presentation-slide";
import { Badge } from "@/components/ui/badge";
import { Globe, FileText, BookMarked } from "lucide-react";
import type { ChatResponse } from "@/types";

/** 스트리밍 중에는 일부 필드가 비어있을 수 있어 부분 타입도 허용 */
type PartialAnswer = Partial<ChatResponse>;

export function AnswerView({
  answer,
  streaming = false,
}: {
  answer: PartialAnswer;
  streaming?: boolean;
}) {
  const presentation = answer.presentation;
  const hasSlide = !!presentation?.title;
  const sourceFiles = answer.source_files ?? [];

  return (
    <div className="space-y-5">
      {/* a. 프레젠테이션 슬라이드 (제목이 채워지기 시작하면 표시) */}
      {hasSlide && <PresentationSlide presentation={presentation!} />}

      {/* 사용된 근거 표시 */}
      {(answer.used_internal || answer.used_web || sourceFiles.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {answer.used_internal && (
            <Badge variant="secondary" className="gap-1">
              <FileText className="h-3 w-3" /> 사내자료
            </Badge>
          )}
          {answer.used_web && (
            <Badge variant="outline" className="gap-1">
              <Globe className="h-3 w-3" /> 웹 딥서치
            </Badge>
          )}
          {sourceFiles.map((f) => (
            <Badge key={f} variant="outline" className="gap-1 font-normal">
              <BookMarked className="h-3 w-3" /> {f}
            </Badge>
          ))}
        </div>
      )}

      {/* c. script 가독성 출력 (마크다운) — 스트리밍 중 실시간 렌더 */}
      {(answer.script || streaming) && (
        <div className="prose prose-slate max-w-none rounded-lg border bg-card p-6 prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-p:leading-relaxed prose-li:my-1">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {answer.script ?? ""}
          </ReactMarkdown>
          {streaming && (
            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-slate-400 align-middle" />
          )}
        </div>
      )}

      {/* d. 외부 내용 참고란 (회색 박스) */}
      {answer.external_references && answer.external_references.length > 0 && (
        <div className="rounded-lg border-l-4 border-slate-400 bg-slate-100 p-5">
          <div className="mb-2 flex items-center gap-2">
            <Globe className="h-4 w-4 text-slate-600" />
            <h3 className="text-sm font-bold text-slate-700">
              외부 내용 참고란
            </h3>
            <span className="text-xs text-slate-500">
              (웹 검색을 통해 보강된 내용입니다)
            </span>
          </div>
          <ul className="space-y-2">
            {answer.external_references.map((ref, i) => (
              <ExternalRef key={i} text={ref} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** "설명 — URL" 형태 문자열에서 URL 을 추출해 링크로 표시 */
function ExternalRef({ text }: { text: string }) {
  const urlMatch = text.match(/https?:\/\/[^\s)]+/);
  const url = urlMatch?.[0];
  const label = url ? text.replace(url, "").replace(/[—\-:]\s*$/, "").trim() : text;

  return (
    <li className="text-sm text-slate-700">
      <span>{label || url}</span>
      {url && (
        <>
          {" "}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-medium text-blue-600 underline"
          >
            {url}
          </a>
        </>
      )}
    </li>
  );
}
