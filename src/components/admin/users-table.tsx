"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate, safeJson } from "@/lib/utils";
import { toast } from "sonner";
import { Check, ShieldOff, Shield, Ban, Loader2 } from "lucide-react";
import type { Profile } from "@/types";

export function UsersTable({
  users,
  currentUserId,
}: {
  users: Profile[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patch(
    id: string,
    body: { is_approved?: boolean; role?: "user" | "admin" }
  ) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await safeJson(res);
      if (!res.ok) throw new Error(json.error);
      toast.success("변경 완료");
      router.refresh();
    } catch (e: any) {
      toast.error("변경 실패", { description: String(e?.message ?? e) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead>이메일</TableHead>
            <TableHead>권한</TableHead>
            <TableHead>승인</TableHead>
            <TableHead>가입일</TableHead>
            <TableHead className="text-right">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            const busy = busyId === u.id;
            return (
              <TableRow key={u.id}>
                <TableCell className="font-medium">
                  {u.full_name ?? "-"}
                  {isSelf && (
                    <span className="ml-1 text-xs text-muted-foreground">(나)</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">{u.email}</TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : "outline"}>
                    {u.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {u.is_approved ? (
                    <Badge variant="success">승인됨</Badge>
                  ) : (
                    <Badge variant="warning">대기</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm">{formatDate(u.created_at)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {busy && (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin self-center" />
                    )}
                    {!u.is_approved ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => patch(u.id, { is_approved: true })}
                      >
                        <Check className="h-4 w-4" /> 승인
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || isSelf}
                        onClick={() => patch(u.id, { is_approved: false })}
                      >
                        <Ban className="h-4 w-4" /> 승인취소
                      </Button>
                    )}
                    {u.role === "user" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => patch(u.id, { role: "admin" })}
                      >
                        <Shield className="h-4 w-4" /> 관리자 지정
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || isSelf}
                        onClick={() => patch(u.id, { role: "user" })}
                      >
                        <ShieldOff className="h-4 w-4" /> 관리자 해제
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
