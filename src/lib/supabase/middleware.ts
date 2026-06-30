import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * 미들웨어에서 세션을 갱신하고, 인증/승인/권한 기반 라우팅을 처리한다.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isAuthPage =
    pathname.startsWith("/login") || pathname.startsWith("/signup");
  const isPublic =
    isAuthPage ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/pending");

  // 미인증 사용자가 보호 경로 접근 → 로그인
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // 인증 사용자 추가 검증
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_approved")
      .eq("id", user.id)
      .single();

    const isApproved = profile?.is_approved === true;
    const isAdmin = profile?.role === "admin" && isApproved;

    // 로그인/회원가입 페이지 → 메인으로
    if (isAuthPage) {
      const url = request.nextUrl.clone();
      url.pathname = isApproved ? "/chat" : "/pending";
      return NextResponse.redirect(url);
    }

    // 미승인 사용자는 /pending 으로 격리
    if (!isApproved && !pathname.startsWith("/pending")) {
      const url = request.nextUrl.clone();
      url.pathname = "/pending";
      return NextResponse.redirect(url);
    }

    // 승인됐는데 /pending 에 있으면 메인으로
    if (isApproved && pathname.startsWith("/pending")) {
      const url = request.nextUrl.clone();
      url.pathname = "/chat";
      return NextResponse.redirect(url);
    }

    // 관리자 페이지 보호
    if (pathname.startsWith("/admin") && !isAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = "/chat";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
