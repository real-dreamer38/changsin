"use client";

import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function SignOutButton({
  variant = "outline",
}: {
  variant?: "outline" | "ghost";
}) {
  return (
    <form action="/auth/signout" method="post">
      <Button type="submit" variant={variant} size="sm" className="gap-2">
        <LogOut className="h-4 w-4" />
        로그아웃
      </Button>
    </form>
  );
}
