import { requireUser } from "@/lib/auth";
import { MeetingAnalyzer } from "@/components/meetings/meeting-analyzer";

export default async function MeetingsPage() {
  await requireUser();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">회의 분석 &amp; 제안서 자동 생성</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          텍스트 회의록을 붙여넣거나 .txt 파일을 올리면, AI가 요약·후속 작업을
          정리하고 필요 시 제안서 초안 슬라이드까지 만들어 줍니다.
        </p>
      </div>
      <MeetingAnalyzer />
    </div>
  );
}
