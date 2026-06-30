import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocumentsTable } from "@/components/admin/documents-table";
import { UsersTable } from "@/components/admin/users-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FileText, Users, Database } from "lucide-react";
import type { DocumentRow, Profile } from "@/types";

export default async function AdminPage() {
  const { userId } = await requireAdmin();
  const admin = createAdminClient();

  const [{ data: docs }, { data: users }, { count: chunkCount }] =
    await Promise.all([
      admin
        .from("documents")
        .select("*")
        .order("created_at", { ascending: false }),
      admin.from("profiles").select("*").order("created_at", { ascending: false }),
      admin
        .from("document_chunks")
        .select("*", { count: "exact", head: true }),
    ]);

  const documents = (docs ?? []) as DocumentRow[];
  const profiles = (users ?? []) as Profile[];
  const pendingCount = profiles.filter((u) => !u.is_approved).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">관리자 대시보드</h1>
        <p className="text-muted-foreground">
          자료 관리, 사용자 승인 및 권한 관리를 수행합니다.
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          label="총 자료"
          value={documents.length}
        />
        <StatCard
          icon={<Database className="h-5 w-5" />}
          label="임베딩 청크"
          value={chunkCount ?? 0}
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="승인 대기"
          value={pendingCount}
          highlight={pendingCount > 0}
        />
      </div>

      {/* 사용자 관리 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">사용자 / 권한 관리</h2>
        <UsersTable users={profiles} currentUserId={userId} />
      </section>

      {/* 자료 관리 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">업로드 자료 관리</h2>
        <DocumentsTable docs={documents} />
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div
          className={`text-3xl font-bold ${highlight ? "text-amber-600" : ""}`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
