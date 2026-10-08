// 태그 확인: Claude가 떠올린 태그(특히 아티스트 태그)가 NovelAI에 실제로 있는지 자동완성으로 확인한다.
// Claude는 작가 이름 철자를 틀리거나 없는 이름을 지어낼 수 있어서, Anlas를 쓰기 전에 거르는 용도.

import type { NaiClient, TagSuggestion } from "./api/client.js";

export interface TagCheck {
  query: string;
  /** 정확히 같은 태그가 있는지 */
  found: boolean;
  match?: TagSuggestion;
  /** 비슷한 후보 (최대 5개, 많이 쓰인 순) */
  suggestions: TagSuggestion[];
}

/** 비교용 정규화: 대소문자·밑줄·이스케이프·`artist:` 접두어 차이를 없앤다 */
export function normalizeTag(tag: string): string {
  return tag
    .normalize("NFC")
    .toLowerCase()
    .replace(/\\([()])/g, "$1")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^artist\s*:\s*/, "");
}

/** 가중치 문법이나 중괄호를 벗겨서 태그 이름만 남긴다: `1.2::artist:foo::`, `{artist:foo}` → `artist:foo` */
export function bareTag(text: string): string {
  let t = text.trim();
  const w = /^-?\d+(?:\.\d+)?::(.+?)::$/.exec(t);
  if (w) t = w[1]!.trim();
  t = t.replace(/^[{[]+|[}\]]+$/g, "").trim();
  return t;
}

/** 검색에 보낼 모양: 이스케이프를 풀고 밑줄을 공백으로 (NovelAI 태그는 공백 표기) */
function searchForm(tag: string): string {
  return tag.replace(/\\([()])/g, "$1").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function pick(list: TagSuggestion[], query: string): { match?: TagSuggestion; suggestions: TagSuggestion[] } {
  const want = normalizeTag(query);
  const uniq = new Map<string, TagSuggestion>();
  for (const t of list) {
    const k = normalizeTag(t.tag);
    const prev = uniq.get(k);
    if (!prev || t.count > prev.count) uniq.set(k, t);
  }
  const match = uniq.get(want);
  const suggestions = [...uniq.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  return { match, suggestions };
}

export async function checkTags(client: NaiClient, modelId: string, queries: string[]): Promise<TagCheck[]> {
  const out: TagCheck[] = [];
  for (const raw of queries) {
    const query = bareTag(raw);
    if (!query) continue;
    const search = searchForm(query);
    let list = await client.suggestTags(modelId, search);
    let r = pick(list, query);
    // `artist:` 접두어를 붙인 채로 못 찾았으면 접두어 없이 한 번 더 (응답에 접두어가 없을 수도 있어서)
    if (!r.match && /^artist\s*:/i.test(search)) {
      const plain = search.replace(/^artist\s*:\s*/i, "");
      if (plain) {
        list = [...list, ...(await client.suggestTags(modelId, plain))];
        r = pick(list, query);
      }
    }
    out.push({ query, found: !!r.match, match: r.match, suggestions: r.suggestions });
  }
  return out;
}
