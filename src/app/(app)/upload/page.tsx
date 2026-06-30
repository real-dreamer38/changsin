import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "@/components/upload/upload-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function UploadPage() {
  await requireUser();
  const supabase = await createClient();

  const { data: docs } = await supabase
    .from("documents")
    .select("id, file_name, file_type, status, created_at, uploader_email")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">자료 업로드</h1>
        <p className="text-muted-foreground">
          txt · pdf · png · jpg 파일을 업로드하면 자동으로 텍스트 추출 후
          벡터화됩니다. 동일 파일(SHA-256)은 중복 차단됩니다.
        </p>
      </div>

      <UploadForm />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">최근 업로드</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!docs || docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              아직 업로드된 자료가 없습니다.
            </p>
          ) : (
            docs.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between border-b py-2 last:border-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.uploader_email} · {formatDate(d.created_at)}
                  </p>
                </div>
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
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
