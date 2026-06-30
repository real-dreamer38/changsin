"use client";

import { useRef, useState, useEffect } from "react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AnswerView } from "./answer-view";
import { toast } from "sonner";
import { Send, Loader2, Bot, User, Sparkles, Square } from "lucide-react";
import type { ChatResponse } from "@/types";

// 스트리밍 객체 스키마 (서버 /api/chat 의 answerSchema 와 동일 형태)
const answerSchema = z.object({
  presentation: z.object({
    title: z.string(),
    points: z.array(z.string()),
    diagram_text: z.string(),
  }),
  script: z.string(),
  external_references: z.array(z.string()).nullable(),
});

interface RagMeta {
  used_internal: boolean;
  used_web: boolean;
  source_files: string[];
  web_references: string[];
}

interface Turn {
  id: string;
  question: string;
  answer: ChatResponse;
}

export function ChatInterface() {
  const [history, setHistory] = useState<Turn[]>([]);
  const [liveQuestion, setLiveQuestion] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);
  const ragMetaRef = useRef<RagMeta | null>(null);
  const liveQuestionRef = useRef<string | null>(null);

  function nextId() {
    idCounter.current += 1;
    return `m${idCounter.current}`;
  }

  const { object, submit, isLoading, stop } = useObject({
    api: "/api/chat",
    schema: answerSchema,
    // 커스텀 fetch 로 RAG 근거 메타데이터(헤더)를 가로채 저장
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetch(input, init);
      if (!res.ok) {
        const msg = await res
          .clone()
          .json()
          .then((j) => j?.error)
          .catch(() => null);
        throw new Error(msg ?? `요청 실패 (${res.status})`);
      }
      const meta = res.headers.get("x-rag-meta");
      ragMetaRef.current = meta
        ? (JSON.parse(decodeURIComponent(meta)) as RagMeta)
        : null;
      return res;
    },
    onFinish: ({ object }) => {
      const q = liveQuestionRef.current;
      if (object && q) {
        const meta = ragMetaRef.current;
        const answer: ChatResponse = {
          presentation: object.presentation,
          script: object.script,
          external_references:
            object.external_references &&
            object.external_references.length > 0
              ? object.external_references
              : meta && meta.web_references.length > 0
                ? meta.web_references
                : null,
          used_internal: meta?.used_internal ?? false,
          used_web: meta?.used_web ?? false,
          source_files: meta?.source_files ?? [],
        };
        setHistory((prev) => [...prev, { id: nextId(), question: q, answer }]);
      }
      liveQuestionRef.current = null;
      setLiveQuestion(null);
    },
    onError: (err) => {
      toast.error("오류", { description: String(err?.message ?? err) });
      liveQuestionRef.current = null;
      setLiveQuestion(null);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, object, isLoading]);

  function send() {
    const question = input.trim();
    if (!question || isLoading) return;
    liveQuestionRef.current = question;
    ragMetaRef.current = null;
    setLiveQuestion(question);
    setInput("");
    submit({ question });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // 스트리밍 중 라이브 답변(부분 객체) + 근거 메타 결합
  const liveMeta = ragMetaRef.current;
  const liveAnswer = {
    presentation: object?.presentation as ChatResponse["presentation"] | undefined,
    script: object?.script ?? "",
    external_references: (object?.external_references ?? null) as
      | string[]
      | null,
    used_internal: liveMeta?.used_internal ?? false,
    used_web: liveMeta?.used_web ?? false,
    source_files: liveMeta?.source_files ?? [],
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* 메시지 영역 */}
      <div className="flex-1 space-y-6 overflow-y-auto pb-4">
        {history.length === 0 && !liveQuestion && (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            <Sparkles className="mb-3 h-10 w-10" />
            <p className="text-lg font-medium text-foreground">
              무엇이든 물어보세요
            </p>
            <p className="mt-1 max-w-md text-sm">
              사내 자료를 먼저 검색하고, 부족하면 웹 딥서치로 보강해
              프레젠테이션 형태로 실시간 스트리밍 답변합니다.
            </p>
          </div>
        )}

        {/* 완료된 대화 기록 */}
        {history.map((t) => (
          <div key={t.id} className="space-y-4">
            <UserBubble text={t.question} />
            <AssistantRow>
              <AnswerView answer={t.answer} />
            </AssistantRow>
          </div>
        ))}

        {/* 진행 중(스트리밍) 대화 */}
        {liveQuestion && (
          <div className="space-y-4">
            <UserBubble text={liveQuestion} />
            <AssistantRow>
              {object ? (
                <AnswerView answer={liveAnswer} streaming />
              ) : (
                <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  자료 검색 및 답변 생성 중...
                </div>
              )}
            </AssistantRow>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 입력 영역 */}
      <div className="border-t bg-background pt-4">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="질문을 입력하세요. (Shift+Enter 줄바꿈)"
            className="max-h-40 min-h-[52px] resize-none"
            disabled={isLoading}
          />
          {isLoading ? (
            <Button
              onClick={() => stop()}
              size="icon"
              variant="secondary"
              className="h-[52px] w-[52px] shrink-0"
              title="중단"
            >
              <Square className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              onClick={send}
              disabled={!input.trim()}
              size="icon"
              className="h-[52px] w-[52px] shrink-0"
            >
              <Send className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[80%] items-start gap-2">
        <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-primary-foreground">
          {text}
        </div>
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary">
          <User className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
