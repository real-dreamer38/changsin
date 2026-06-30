export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilySearchResponse {
  answer?: string;
  results: TavilyResult[];
}

/**
 * Tavily 웹 딥서치. 사내 자료가 부족할 때 호출.
 * search_depth: 'advanced' 로 더 깊은 검색.
 */
export async function tavilySearch(
  query: string,
  maxResults = 5
): Promise<TavilySearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY 가 설정되지 않았습니다.");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      include_answer: true,
      max_results: maxResults,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Tavily 검색 실패 (${res.status}): ${txt}`);
  }

  return (await res.json()) as TavilySearchResponse;
}
