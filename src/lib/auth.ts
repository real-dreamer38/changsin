import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Profile } from "@/types";

/** 현재 로그인 사용자 + 프로필. 미인증이면 /login 으로 리다이렉트 */
export async function requireUser(): Promise<{
  userId: string;
  email: string | null;
  profile: Profile;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");
  if (!profile.is_approved) redirect("/pending");

  return { userId: user.id, email: user.email ?? null, profile };
}

/** 관리자 전용. 관리자가 아니면 /chat 으로 */
export async function requireAdmin() {
  const ctx = await requireUser();
  if (ctx.profile.role !== "admin") redirect("/chat");
  return ctx;
}
