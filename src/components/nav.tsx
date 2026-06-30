"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Upload,
  ShieldCheck,
  Bot,
  ClipboardList,
} from "lucide-react";
import type { Profile } from "@/types";

const links = [
  { href: "/chat", label: "AI 채팅", icon: MessageSquare },
  { href: "/meetings", label: "회의 분석", icon: ClipboardList },
  { href: "/upload", label: "자료 업로드", icon: Upload },
];

export function Nav({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const isAdmin = profile.role === "admin";

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/chat" className="flex items-center gap-2 font-semibold">
            <Bot className="h-5 w-5" />
            창신 AI
          </Link>
          <nav className="flex items-center gap-1">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  pathname.startsWith(href)
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
            {isAdmin && (
              <Link
                href="/admin"
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  pathname.startsWith("/admin")
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ShieldCheck className="h-4 w-4" />
                관리자
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden text-muted-foreground sm:inline">
              {profile.full_name ?? profile.email}
            </span>
            {isAdmin && <Badge variant="secondary">Admin</Badge>}
          </div>
          <SignOutButton variant="ghost" />
        </div>
      </div>
    </header>
  );
}
