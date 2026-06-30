"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatSidebar } from "./chat-sidebar";
import { ChatInterface, type Turn } from "./chat-interface";
import { toast } from "sonner";
import { safeJson } from "@/lib/utils";
import type { ChatSession, ChatMessageRow } from "@/types";

/** DB 메시지 배열 → 채팅 UI 의 Turn[] 으로 재구성 (user→assistant 페어링) */
function messagesToTurns(messages: ChatMessageRow[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      turns.push({ id: m.id, question: m.content ?? "" });
    } else {
      const last = turns[turns.length - 1];
      if (last && !last.answer && !last.error) {
        last.answer = m.answer ?? undefined;
        last.error = m.error ?? undefined;
      } else {
        turns.push({
          id: m.id,
          question: "",
          answer: m.answer ?? undefined,
          error: m.error ?? undefined,
        });
      }
    }
  }
  return turns;
}

export function ChatWorkspace() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  // ChatInterface 의 초기 상태 + 재마운트 키
  const [initialSessionId, setInitialSessionId] = useState<string | null>(null);
  const [initialHistory, setInitialHistory] = useState<Turn[]>([]);
  const [mountKey, setMountKey] = useState(0);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/sessions");
      const json = await safeJson(res);
      if (res.ok) setSessions(json.sessions ?? []);
    } catch {
      /* 목록 로딩 실패는 조용히 무시 */
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function selectSession(id: string) {
    if (id === activeId) return;
    try {
      const res = await fetch(`/api/chat/sessions/${id}`);
      const json = await safeJson(res);
      if (!res.ok) throw new Error(json.error ?? "대화를 불러오지 못했습니다.");
      setInitialSessionId(id);
      setInitialHistory(messagesToTurns(json.messages ?? []));
      setActiveId(id);
      setMountKey((k) => k + 1);
    } catch (e: any) {
      toast.error("불러오기 실패", { description: String(e?.message ?? e) });
    }
  }

  function newChat() {
    setInitialSessionId(null);
    setInitialHistory([]);
    setActiveId(null);
    setMountKey((k) => k + 1);
  }

  // 새 대화에서 첫 메시지로 세션이 생성됐을 때 (인터페이스는 그대로 유지)
  function handleSessionCreated(id: string, title: string) {
    setActiveId(id);
    setSessions((prev) =>
      prev.some((s) => s.id === id)
        ? prev
        : [{ id, title, updated_at: new Date().toISOString() }, ...prev]
    );
  }

  async function deleteSession(id: string) {
    try {
      await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
    } catch {
      /* 무시 */
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) newChat();
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      <ChatSidebar
        sessions={sessions}
        activeId={activeId}
        loading={loadingSessions}
        onSelect={selectSession}
        onNew={newChat}
        onDelete={deleteSession}
      />
      <div className="min-w-0 flex-1">
        <ChatInterface
          key={mountKey}
          initialSessionId={initialSessionId}
          initialHistory={initialHistory}
          onSessionCreated={handleSessionCreated}
          onPersisted={loadSessions}
        />
      </div>
    </div>
  );
}
