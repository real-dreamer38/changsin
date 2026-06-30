"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, Trash2, Loader2 } from "lucide-react";
import type { ChatSession } from "@/types";

export function ChatSidebar({
  sessions,
  activeId,
  loading,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col rounded-lg border bg-card md:flex">
      <div className="p-3">
        <Button onClick={onNew} className="w-full justify-start gap-2">
          <Plus className="h-4 w-4" />새 대화
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
          대화 기록
        </p>

        {loading && sessions.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
          </div>
        ) : sessions.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            아직 저장된 대화가 없습니다.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <li key={s.id}>
                <div
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors",
                    activeId === s.id
                      ? "bg-secondary text-secondary-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  <button
                    onClick={() => onSelect(s.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={s.title}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{s.title}</span>
                  </button>
                  <button
                    onClick={() => onDelete(s.id)}
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    title="삭제"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
