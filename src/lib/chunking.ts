/**
 * 단순하지만 견고한 문자 기반 청킹.
 * 문단 경계를 우선 존중하고, 청크 사이 overlap 으로 문맥을 보존한다.
 */
export function chunkText(
  text: string,
  chunkSize = 1200,
  overlap = 200
): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];

  // 문단 단위로 먼저 분할
  const paragraphs = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > chunkSize) {
      if (current) chunks.push(current.trim());
      if (para.length > chunkSize) {
        // 한 문단이 너무 길면 슬라이딩 윈도우로 잘게 자름
        for (let i = 0; i < para.length; i += chunkSize - overlap) {
          chunks.push(para.slice(i, i + chunkSize).trim());
        }
        current = "";
      } else {
        current = para;
      }
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.filter((c) => c.length > 0);
}
