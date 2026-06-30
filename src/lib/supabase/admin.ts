import { createClient } from "@supabase/supabase-js";

/**
 * service_role 키를 사용하는 관리자 클라이언트.
 * RLS 를 우회하므로 반드시 서버에서만, 권한 검증 후에만 사용.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}
