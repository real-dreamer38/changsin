"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileDown, ImageDown, Loader2 } from "lucide-react";
import type { AiAnswer } from "@/types";

type Presentation = AiAnswer["presentation"];

/**
 * '프레젠테이션 슬라이드 한 장' 카드.
 * 우측 상단 [PDF 다운로드] / [이미지 다운로드] 버튼으로 이 DOM 영역만 캡처.
 * 채팅(스트리밍)·회의 분석 등 여러 곳에서 재사용한다.
 */
export function PresentationSlide({
  presentation,
}: {
  presentation: Presentation;
}) {
  const slideRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<"pdf" | "png" | null>(null);

  // 스트리밍 중에는 일부 필드가 비어 있을 수 있어 방어적으로 처리
  const title = presentation?.title ?? "";
  const points = presentation?.points ?? [];
  const diagramText = presentation?.diagram_text ?? "";

  async function capture(): Promise<HTMLCanvasElement> {
    const html2canvas = (await import("html2canvas")).default;
    const node = slideRef.current!;
    return html2canvas(node, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });
  }

  async function downloadPng() {
    setExporting("png");
    try {
      const canvas = await capture();
      const link = document.createElement("a");
      link.download = `${title || "slide"}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setExporting(null);
    }
  }

  async function downloadPdf() {
    setExporting("pdf");
    try {
      const canvas = await capture();
      const imgData = canvas.toDataURL("image/png");
      const { jsPDF } = await import("jspdf");
      // 가로 방향 A4, 슬라이드 비율에 맞춰 배치
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "px",
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(`${title || "slide"}.pdf`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="relative">
      {/* 다운로드 버튼 (캡처 영역 밖) */}
      <div className="absolute right-3 top-3 z-10 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={downloadPdf}
          disabled={exporting !== null}
        >
          {exporting === "pdf" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <FileDown />
          )}
          PDF
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={downloadPng}
          disabled={exporting !== null}
        >
          {exporting === "png" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <ImageDown />
          )}
          이미지
        </Button>
      </div>

      {/* === 캡처 대상 슬라이드 === */}
      <div
        ref={slideRef}
        className="slide-capture aspect-[16/9] w-full overflow-hidden rounded-xl border bg-white p-8 shadow-sm"
      >
        <div className="flex h-full flex-col">
          <div className="border-b-4 border-slate-800 pb-3">
            <h2 className="text-2xl font-bold leading-tight text-slate-900">
              {title}
            </h2>
          </div>

          <ul className="mt-5 flex-1 space-y-3 overflow-hidden">
            {points.map((p, i) => (
              <li key={i} className="flex gap-3 text-slate-800">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span className="text-base leading-relaxed">{p}</span>
              </li>
            ))}
          </ul>

          {diagramText && (
            <div className="mt-4 rounded-lg bg-slate-100 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                흐름 / 도식
              </p>
              <p className="mt-1 text-sm text-slate-700">{diagramText}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
