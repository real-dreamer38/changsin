"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { PresentationSlide } from "@/components/chat/presentation-slide";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  Upload,
  ClipboardList,
  CheckSquare,
  Presentation,
} from "lucide-react";
import type { MeetingAnalysis } from "@/types";

export function MeetingAnalyzer() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MeetingAnalysis | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onPickFile(file: File) {
    if (!/\.txt$/i.test(file.name) && file.type !== "text/plain") {
      toast.error("텍스트(.txt) 파일만 업로드할 수 있습니다.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      toast.success(`'${file.name}' 내용을 불러왔습니다.`);
    };
    reader.onerror = () => toast.error("파일을 읽지 못했습니다.");
    reader.readAsText(file, "utf-8");
  }

  async function analyze() {
    const content = text.trim();
    if (content.length < 10) {
      toast.error("분석할 회의 내용을 입력하거나 .txt 파일을 올려주세요.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "분석에 실패했습니다.");
      setResult(json as MeetingAnalysis);
    } catch (e: any) {
      toast.error("오류", { description: String(e?.message ?? e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 입력 영역 */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">회의 내용 입력</label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => fileRef.current?.click()}
                disabled={loading}
              >
                <Upload className="h-4 w-4" />
                .txt 업로드
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) onPickFile(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="클로바노트 등에서 변환한 회의 내용 텍스트를 여기에 붙여넣으세요."
            className="min-h-[260px] resize-y font-mono text-sm leading-relaxed"
            disabled={loading}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {text.trim().length.toLocaleString()}자
            </p>
            <Button onClick={analyze} disabled={loading} className="gap-2">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              회의 분석 및 제안서 생성
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border bg-card px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          회의 내용을 분석하고 있습니다...
        </div>
      )}

      {/* 결과 영역 */}
      {result && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* a. 회의 요약 + 후속 작업 (보고서) */}
          <div className="space-y-5">
            <section className="rounded-lg border bg-card p-6">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                <ClipboardList className="h-5 w-5" />
                회의 요약
              </h2>
              <div className="prose prose-slate max-w-none prose-headings:font-bold prose-h1:text-lg prose-h2:text-base prose-p:leading-relaxed prose-li:my-0.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {result.summary}
                </ReactMarkdown>
              </div>
            </section>

            <section className="rounded-lg border bg-card p-6">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                <CheckSquare className="h-5 w-5" />
                후속 작업 (Action Items)
              </h2>
              {result.action_items.length > 0 ? (
                <ul className="space-y-2">
                  {result.action_items.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-800">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-800 text-xs font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  도출된 후속 작업이 없습니다.
                </p>
              )}
            </section>
          </div>

          {/* b. 제안서 초안 슬라이드 (requires_presentation === true 일 때만) */}
          <div className="space-y-3">
            {result.requires_presentation && result.presentation ? (
              <>
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <Presentation className="h-5 w-5" />
                  제안서 초안 (자동 생성)
                </h2>
                <PresentationSlide presentation={result.presentation} />
                <p className="text-xs text-muted-foreground">
                  AI가 이 회의는 후속 제안서/기획 문서 작성이 필요하다고 판단했습니다.
                  우측 상단 버튼으로 PDF·이미지로 내려받을 수 있습니다.
                </p>
              </>
            ) : (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                <Presentation className="mb-2 h-8 w-8" />
                이 회의는 별도의 제안서 작성이 필요하지 않은 것으로 분석되었습니다.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
