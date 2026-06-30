import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "@/components/sign-out-button";
import { Clock } from "lucide-react";

export default async function PendingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_approved")
    .eq("id", user.id)
    .single();

  if (profile?.is_approved) redirect("/chat");

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <Clock className="h-6 w-6 text-amber-600" />
          </div>
          <CardTitle>승인 대기 중</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{user.email}</span>{" "}
            계정으로 가입이 완료되었습니다.
            <br />
            관리자 승인 후 사내 자료 및 AI 채팅을 이용할 수 있습니다.
          </p>
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
