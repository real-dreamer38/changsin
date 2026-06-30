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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatBytes, safeJson } from "@/lib/utils";
import { toast } from "sonner";
import { Trash2, Eye, Loader2 } from "lucide-react";
import type { DocumentRow } from "@/types";

export function DocumentsTable({ docs }: { docs: DocumentRow[] }) {
  const router = useRouter();
  const [viewing, setViewing] = useState<DocumentRow | null>(null);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/documents/${deleting.id}`, {
        method: "DELETE",
      });
      const json = await safeJson(res);
      if (!res.ok) throw new Error(json.error);
      toast.success("삭제 완료", {
        description: `${deleting.file_name} (DB·Storage·벡터 모두 삭제)`,
      });
      setDeleting(null);
      router.refresh();
    } catch (e: any) {
      toast.error("삭제 실패", { description: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>파일명</TableHead>
              <TableHead>형식</TableHead>
              <TableHead>크기</TableHead>
              <TableHead>업로더</TableHead>
              <TableHead>업로드 일자</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  업로드된 자료가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              docs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="max-w-[220px] truncate font-medium">
                    {d.file_name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="uppercase">
                      {d.file_type}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatBytes(d.file_size)}</TableCell>
                  <TableCell className="text-sm">{d.uploader_email ?? "-"}</TableCell>
                  <TableCell className="text-sm">{formatDate(d.created_at)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        d.status === "ready"
                          ? "success"
                          : d.status === "error"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {d.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setViewing(d)}
                        title="내용 열람"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleting(d)}
                        title="삭제"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 내용 열람 */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="truncate">{viewing?.file_name}</DialogTitle>
            <DialogDescription>
              {viewing?.uploader_email} ·{" "}
              {viewing && formatDate(viewing.created_at)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">
            {viewing?.extracted_text || "추출된 텍스트가 없습니다."}
          </div>
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && !busy && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>자료를 삭제하시겠습니까?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">
                {deleting?.file_name}
              </span>
              <br />
              DB 레코드, Storage 원본, pgvector 임베딩이 모두 영구 삭제됩니다.
              이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={busy}
            >
              취소
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
