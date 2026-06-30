import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "창신 프로젝트 AI",
  description: "사내 자료 기반 RAG AI 어시스턴트",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-background antialiased">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
