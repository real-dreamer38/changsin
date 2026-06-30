"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sha256File } from "@/lib/hash";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/utils";
import { toast } from "sonner";
import {
  UploadCloud,
  File as FileIcon,
  FolderUp,
  Loader2,
  CheckCircle2,
  XCircle,
  X,
} from "lucide-react";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ACCEPT = `.txt,.pdf,.docx,.png,.jpg,.jpeg,${DOCX_MIME}`;
const MAX_SIZE = 50 * 1024 * 1024; // 50MB
const STORAGE_BUCKET = "documents";

/** 파일 확장자 정규화 — 서버 detectKind 와 동일 규칙 (jpeg→jpg) */
function fileExt(file: File): string {
  const e = file.name.split(".").pop()?.toLowerCase();
  if (e === "txt" || file.type === "text/plain") return "txt";
  if (e === "pdf" || file.type === "application/pdf") return "pdf";
  if (e === "docx" || file.type === DOCX_MIME) return "docx";
  if (e === "png" || file.type === "image/png") return "png";
  if (["jpg", "jpeg"].includes(e ?? "") || file.type === "image/jpeg")
    return "jpg";
  return e ?? "bin";
}

/** Storage 업로드 시 "이미 존재" 에러인지 판별 (해시 경로 → 동일 파일이므로 무시 가능) */
function isAlreadyExists(err: { message?: string; statusCode?: string }): boolean {
  const code = (err as any)?.statusCode;
  const msg = err?.message ?? "";
  return code === "409" || /exist|duplicate/i.test(msg);
}

/** 폴더 업로드 시 허용 확장자만 통과 (pdf, docx, txt, png, jpg) */
const ALLOWED_EXT = new Set(["txt", "pdf", "docx", "png", "jpg"]);
function isAllowedFile(file: File): boolean {
  return ALLOWED_EXT.has(fileExt(file));
}

/** 폴더 업로드 시 섞여 들어오는 무효 객체(폴더/0바이트/시스템 숨김 파일) 차단 */
const SYSTEM_FILE_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
function isValidUploadFile(file: File): boolean {
  // '폴더 자체' 객체나 0바이트 파일 제외 (드롭된 디렉터리는 size 0 으로 들어옴)
  if (!file || file.size === 0) return false;
  const name = (file.name || "").toLowerCase();
  if (!name) return false;
  // .DS_Store / Thumbs.db / desktop.ini 및 점(.)으로 시작하는 숨김 파일 제외
  if (SYSTEM_FILE_NAMES.has(name)) return false;
  if (name.startsWith(".")) return false;
  // MIME(file.type)이 비어있고 확장자도 지원 목록에 없으면 제외 (디렉터리/미상 객체 방어)
  if (!file.type && !ALLOWED_EXT.has(fileExt(file))) return false;
  return true;
}

// --- 드래그&드롭 폴더 트리 평탄화 (webkitGetAsEntry) ---
/* FileSystemDirectoryReader.readEntries 는 한 번에 일부만 반환하므로 빌 때까지 반복 */
function readAllEntries(reader: any): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const out: any[] = [];
    const read = () => {
      reader.readEntries((entries: any[]) => {
        if (!entries.length) resolve(out);
        else {
          out.push(...entries);
          read();
        }
      }, reject);
    };
    read();
  });
}

function entryToFile(entry: any): Promise<File | null> {
  return new Promise((resolve) =>
    entry.file(
      (f: File) => resolve(f),
      () => resolve(null)
    )
  );
}

/** 디렉터리 엔트리를 재귀적으로 평탄화해 원본 File 객체를 수집 (손상 없이 그대로) */
async function traverseEntry(entry: any, out: File[]): Promise<void> {
  if (!entry) return;
  if (entry.isFile) {
    const f = await entryToFile(entry);
    if (f) out.push(f);
  } else if (entry.isDirectory) {
    const entries = await readAllEntries(entry.createReader());
    for (const child of entries) {
      await traverseEntry(child, out); // 순차 재귀
    }
  }
}

/** DataTransfer 에서 (폴더 포함) 모든 File 을 평탄화 추출. 폴더 포함 여부도 반환 */
async function filesFromDataTransfer(
  dt: DataTransfer
): Promise<{ files: File[]; hadDirectory: boolean }> {
  const items = dt.items ? Array.from(dt.items) : [];
  const supportsEntry =
    items.length > 0 &&
    typeof (items[0] as any).webkitGetAsEntry === "function";

  if (!supportsEntry) {
    // 구형 브라우저 폴백: 평면 파일 목록만 사용
    return { files: Array.from(dt.files), hadDirectory: false };
  }

  // webkitGetAsEntry 는 drop 이벤트 직후 동기적으로 호출해 entry 를 먼저 확보해야 함
  const entries = items
    .map((it) => (it as any).webkitGetAsEntry?.())
    .filter(Boolean);
  const hadDirectory = entries.some((e: any) => e?.isDirectory);

  const out: File[] = [];
  for (const entry of entries) {
    await traverseEntry(entry, out);
  }
  return { files: out, hadDirectory };
}

type ItemStatus = "ready" | "hashing" | "duplicate" | "uploading" | "done" | "error";

interface QueueItem {
  file: File;
  hash?: string;
  status: ItemStatus;
  message?: string;
}

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  // 폴더 선택 속성(webkitdirectory/directory)은 React prop 으로 직접 못 넣어 ref 로 설정
  useEffect(() => {
    const el = folderInputRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, []);

  function update(index: number, patch: Partial<QueueItem>) {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it))
    );
  }

  /** 폴더 통째로 선택 시(버튼): 무효 파일 + 비지원 확장자 필터링 후 큐에 태움 */
  function addFolder(files: FileList) {
    const all = Array.from(files);
    const accepted = all.filter(isValidUploadFile).filter(isAllowedFile);
    const skipped = all.length - accepted.length;
    if (accepted.length === 0) {
      toast.error("폴더에 업로드 가능한 파일(pdf, docx, txt, png, jpg)이 없습니다.");
      return;
    }
    toast.success(
      `폴더에서 ${accepted.length}개 파일을 불러왔습니다.` +
        (skipped > 0 ? ` (폴더/시스템/비지원 ${skipped}개 제외)` : "")
    );
    addFiles(accepted);
  }

  async function addFiles(files: FileList | File[]) {
    // 방어적 2차 필터 (폴더 객체/0바이트/시스템 숨김/빈 MIME 제거)
    const arr = Array.from(files).filter(isValidUploadFile);
    if (arr.length === 0) return;

    // crypto.subtle 은 보안 컨텍스트(HTTPS/localhost)에서만 제공됨
    if (typeof crypto === "undefined" || !crypto.subtle) {
      toast.error(
        "해시 계산을 사용할 수 없습니다. HTTPS 또는 localhost 환경에서 열어주세요."
      );
      return;
    }

    const supabase = createClient();

    // 동시성 제어: Promise.all 로 한꺼번에 처리하지 않고 for...of 로 '한 번에 하나씩' 순차 계산
    for (const file of arr) {
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name}: 50MB 이하만 업로드 가능합니다.`);
        continue;
      }
      setItems((prev) => [...prev, { file, status: "hashing" }]);

      // 1) 해시 계산 — 실패 시에만 '해시 계산 실패' 로 표시
      let hash: string;
      try {
        hash = await sha256File(file);
      } catch (e) {
        console.error("해시 계산 실패:", file.name, e);
        setItems((prev) =>
          prev.map((it) =>
            it.file === file
              ? { ...it, status: "error", message: "해시 계산 실패" }
              : it
          )
        );
        continue;
      }

      // 2) 중복 사전 체크 — 네트워크 오류는 비치명적(서버가 최종 차단)이므로 통과시킴
      let existing: { id: string; file_name: string } | null = null;
      try {
        const { data } = await supabase
          .from("documents")
          .select("id, file_name")
          .eq("file_hash", hash)
          .maybeSingle();
        existing = data;
      } catch (e) {
        console.warn("중복 사전 확인 실패(무시):", e);
      }

      setItems((prev) =>
        prev.map((it) =>
          it.file === file
            ? {
                ...it,
                hash,
                status: existing ? "duplicate" : "ready",
                message: existing
                  ? `이미 존재: ${existing.file_name}`
                  : undefined,
              }
            : it
        )
      );
    }
  }

  async function uploadAll() {
    setBusy(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("세션이 만료되었습니다. 다시 로그인해 주세요.");
      setBusy(false);
      return;
    }

    const snapshot = items;
    for (let i = 0; i < snapshot.length; i++) {
      const it = snapshot[i];
      if (it.status !== "ready" || !it.hash) continue;
      update(i, { status: "uploading" });

      try {
        // 1) 원본 파일을 브라우저에서 Supabase Storage 로 '직접 업로드'.
        //    Vercel API 라우트(4.5MB 제한)를 우회 — 대용량(50MB) 안전.
        const ext = fileExt(it.file);
        const storagePath = `${user.id}/${it.hash}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, it.file, {
            contentType: it.file.type || "application/octet-stream",
            upsert: false,
          });
        // 경로가 해시(내용) 기반이므로 이미 존재하면 동일 파일 → 그대로 진행.
        if (uploadError && !isAlreadyExists(uploadError)) {
          update(i, {
            status: "error",
            message: `스토리지 업로드 실패: ${uploadError.message}`,
          });
          continue;
        }

        // 2) 경로/메타데이터만 API 로 전달 → 서버는 텍스트 추출 + 임베딩만 수행.
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storagePath,
            hash: it.hash,
            fileName: it.file.name,
            fileSize: it.file.size,
            mimeType: it.file.type,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          update(i, {
            status: json.error === "duplicate" ? "duplicate" : "error",
            message: json.message ?? json.error,
          });
        } else {
          update(i, {
            status: "done",
            message: `청크 ${json.chunks}개 임베딩 완료`,
          });
        }
      } catch (e: any) {
        update(i, { status: "error", message: String(e?.message ?? e) });
      }
    }
    setBusy(false);
    toast.success("업로드 처리 완료");
    router.refresh();
  }

  const hasReady = items.some((it) => it.status === "ready");

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          const dt = e.dataTransfer;
          if (!dt) return;
          // 폴더 드롭 시 트리를 평탄화해 원본 File 만 추출
          const { files, hadDirectory } = await filesFromDataTransfer(dt);
          let valid = files.filter(isValidUploadFile);
          // 폴더가 포함됐다면 지원 확장자만 통과 (단일 파일 드롭은 기존대로 서버 검증)
          if (hadDirectory) valid = valid.filter(isAllowedFile);
          const skipped = files.length - valid.length;
          if (valid.length === 0) {
            toast.error(
              "업로드 가능한 파일이 없습니다. (폴더/시스템 파일 등 제외)"
            );
            return;
          }
          if (hadDirectory) {
            toast.success(
              `폴더에서 ${valid.length}개 파일을 불러왔습니다.` +
                (skipped > 0 ? ` (제외 ${skipped}개)` : "")
            );
          }
          addFiles(valid);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
        }`}
      >
        <UploadCloud className="mb-3 h-10 w-10 text-muted-foreground" />
        <p className="font-medium">파일을 끌어다 놓거나 클릭하여 선택</p>
        <p className="mt-1 text-sm text-muted-foreground">
          지원 형식: txt, pdf, docx, png, jpg (최대 50MB)
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* 폴더 통째로 업로드 */}
      <div className="flex justify-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => folderInputRef.current?.click()}
          disabled={busy}
        >
          <FolderUp className="h-4 w-4" />
          폴더 통째로 업로드
        </Button>
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFolder(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            {items.map((it, i) => (
              <div
                key={`${it.file.name}-${i}`}
                className="flex items-center gap-3 rounded-md border p-3"
              >
                <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(it.file.size)}
                    {it.message ? ` · ${it.message}` : ""}
                  </p>
                </div>
                <StatusBadge status={it.status} />
                {(it.status === "ready" ||
                  it.status === "duplicate" ||
                  it.status === "error") &&
                  !busy && (
                    <button
                      onClick={() =>
                        setItems((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={uploadAll} disabled={!hasReady || busy}>
          {busy && <Loader2 className="animate-spin" />}
          업로드 및 벡터화 시작
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ItemStatus }) {
  switch (status) {
    case "hashing":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> 해시 계산
        </Badge>
      );
    case "ready":
      return <Badge variant="outline">대기</Badge>;
    case "duplicate":
      return (
        <Badge variant="warning" className="gap-1">
          중복 차단
        </Badge>
      );
    case "uploading":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> 처리 중
        </Badge>
      );
    case "done":
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="h-3 w-3" /> 완료
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> 오류
        </Badge>
      );
  }
}
