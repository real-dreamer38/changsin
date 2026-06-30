"use client";

import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AnswerView } from "./answer-view";
import { Send, Loader2, Bot, User, Sparkles, Square, AlertTriangle } from "lucide-react";
import type { ChatResponse } from "@/types";

interface RagMeta {
  used_internal: boolean;
  used_web: boolean;
  source_files: string[];
  web_references: string[];
}

interface Turn {
  id: string;
  question: string;
  answer?: ChatResponse;
  error?: string;
}

// 부분 답변 객체(스트리밍 중)
type PartialAnswer = Partial<ChatResponse>;

const TIMEOUT_MESSAGE =
  "답변을 생성하는 데 시간이 너무 오래 걸려 연결이 끊겼습니다. 질문을 조금 더 구체적으로 작성해 주세요.";

export function ChatInterface() {
  const [history, setHistory] = useState<Turn[]>([]);
  const [liveQuestion, setLiveQuestion] = useState<string | null>(null);
  const [liveObject, setLiveObject] = useState<PartialAnswer | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("자료를 분석 중입니다...");
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  function nextId() {
    idCounter.current += 1;
    return `m${idCounter.current}`;
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, liveObject, loading]);

  /** 진행 중 답변을 history 에 확정(정상 답변 or 에러 말풍선) — 절대 초기화하지 않음 */
  function commitTurn(question: string, patch: Partial<Turn>) {
    setHistory((prev) => [...prev, { id: nextId(), question, ...patch }]);
    setLiveQuestion(null);
    setLiveObject(null);
    setLoading(false);
    abortRef.current = null;
  }

  async function send() {
    const question = input.trim();
    if (!question || loading) return;

    setInput("");
    setLiveQuestion(question);
    setLiveObject(null);
    setStatusMsg("자료를 분석 중입니다...");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    let meta: RagMeta | null = null;
    let lastObject: PartialAnswer | null = null;
    let finished = false; // done/error 이벤트를 받았는지

    function toChatResponse(obj: PartialAnswer): ChatResponse {
      return {
        presentation: obj.presentation as ChatResponse["presentation"],
        script: obj.script ?? "",
        external_references:
          obj.external_references && obj.external_references.length > 0
            ? obj.external_references
            : meta && meta.web_references.length > 0
              ? meta.web_references
              : null,
        used_internal: meta?.used_internal ?? false,
        used_web: meta?.used_web ?? false,
        source_files: meta?.source_files ?? [],
      };
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });

      // 스트림 시작 전의 명시적 에러(401/403/400 등 JSON)
      if (!res.ok || !res.body) {
        let msg = "요청을 처리할 수 없습니다.";
        try {
          const j = await res.json();
          msg = j?.error ?? msg;
        } catch {
          /* JSON 아니면 기본 메시지 */
        }
        commitTurn(question, { error: msg });
        return;
      }

      // NDJSON 스트림 파싱
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          let evt: any;
          try {
            evt = JSON.parse(line);
          } catch {
            continue; // 깨진 라인은 건너뜀
          }

          if (evt.type === "status") {
            if (!lastObject) setStatusMsg(evt.message ?? "분석 중...");
          } else if (evt.type === "meta") {
            meta = {
              used_internal: !!evt.used_internal,
              used_web: !!evt.used_web,
              source_files: evt.source_files ?? [],
              web_references: evt.web_references ?? [],
            };
          } else if (evt.type === "object") {
            lastObject = evt.object as PartialAnswer;
            setLiveObject(lastObject);
          } else if (evt.type === "done") {
            finished = true;
            const obj = (evt.object as PartialAnswer) ?? lastObject ?? {};
            commitTurn(question, { answer: toChatResponse(obj) });
            return;
          } else if (evt.type === "error") {
            finished = true;
            commitTurn(question, { error: evt.message ?? TIMEOUT_MESSAGE });
            return;
          }
        }
      }

      // 스트림이 done/error 없이 끊김 → Vercel 타임아웃 등으로 간주
      if (!finished) {
        commitTurn(question, { error: TIMEOUT_MESSAGE });
      }
    } catch (e: any) {
      // 사용자가 중단(Stop) 한 경우는 조용히 종료
      if (e?.name === "AbortError") {
        commitTurn(question, {
          error: "사용자가 답변 생성을 중단했습니다.",
        });
        return;
      }
      // 네트워크 끊김/타임아웃 → 초기화하지 말고 에러 말풍선
      commitTurn(question, { error: TIMEOUT_MESSAGE });
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

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
              사내 자료를 최우선 기준으로 검색하고, 부족하면 웹 딥서치로 보강해
              프레젠테이션 형태로 실시간 스트리밍 답변합니다.
            </p>
          </div>
        )}

        {/* 완료된 대화 기록 (정상 답변 또는 에러 말풍선) */}
        {history.map((t) => (
          <div key={t.id} className="space-y-4">
            <UserBubble text={t.question} />
            <AssistantRow>
              {t.error ? (
                <ErrorBubble message={t.error} />
              ) : t.answer ? (
                <AnswerView answer={t.answer} />
              ) : null}
            </AssistantRow>
          </div>
        ))}

        {/* 진행 중(스트리밍) 대화 */}
        {liveQuestion && (
          <div className="space-y-4">
            <UserBubble text={liveQuestion} />
            <AssistantRow>
              {liveObject ? (
                <AnswerView answer={liveObject} streaming />
              ) : (
                <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {statusMsg}
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
            disabled={loading}
          />
          {loading ? (
            <Button
              onClick={stop}
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

function ErrorBubble({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
