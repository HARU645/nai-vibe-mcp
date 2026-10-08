// 태그 확인: Claude가 떠올린 태그가 NovelAI 자동완성에 있는지 확인한다 (무료).
// 실측(2026-10-08): 자동완성은 일반 태그·캐릭터·작품은 다 보여 주지만, 현대 작가 태그(artist:wlop 등)는
// 모델이 알아도 보여 주지 않는다 (옛날 화가 일부만 나옴). 그래서 artist: 태그가 안 나오면 "없음"이 아니라
// "unlisted(확인 불가)"로 두고, 작가 태그는 비교 시트에서 기준 칸과 비교해 확인한다.

import { NaiApiError, type NaiClient, type TagSuggestion } from "./api/client.js";

export type TagStatus =
  /** 같은 태그가 있음 */
  | "found"
  /** `artist:이름`으로 물었는데 같은 이름의 일반 태그만 있음 (작가가 아니라 일반 태그) */
  | "general_only"
  /** `artist:이름`이 자동완성에 없음. NovelAI가 작가 태그를 숨겨서 있는지 없는지 알 수 없음 */
  | "unlisted"
  | "not_found"
  /** 이 태그만 검색하다 오류 */
  | "error";

export interface TagCheck {
  query: string;
  status: TagStatus;
  found: boolean;
  match?: TagSuggestion;
  /** 비슷한 후보 (최대 5개, 많이 쓰인 순) */
  suggestions: TagSuggestion[];
  error?: string;
}

/** 비교용 정규화: 대소문자·밑줄·이스케이프·공백 차이를 없앤다. `artist:` 접두어는 남긴다 */
export function normalizeTag(tag: string): string {
  return tag
    .normalize("NFC")
    .toLowerCase()
    .replace(/\\([()])/g, "$1")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^artist\s*:\s*/, "artist:");
}

const isArtist = (normalized: string) => normalized.startsWith("artist:");
const plainName = (normalized: string) => normalized.replace(/^artist:/, "");

/** 가중치 문법이나 괄호 강조를 벗겨서 태그 이름만 남긴다: `1.2::artist:foo::`, `{artist:foo}` → `artist:foo` */
export function bareTag(text: string): string {
  return text
    .trim()
    .replace(/^-?\d+(?:\.\d+)?::/, "")
    .replace(/::$/, "")
    .replace(/^[{[]+|[}\]]+$/g, "")
    .trim();
}

/** "0.6::artist:a::, 0.4::artist:b::" 같은 조합도 태그 하나씩으로 나눈다 */
export function splitQueries(raw: string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    for (const piece of r.split(",")) {
      const t = bareTag(piece);
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** 검색에 보낼 모양: 이스케이프를 풀고 밑줄을 공백으로 (NovelAI 태그는 공백 표기) */
function searchForm(tag: string): string {
  return tag.replace(/\\([()])/g, "$1").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

export function judge(list: TagSuggestion[], query: string): Omit<TagCheck, "query"> {
  const want = normalizeTag(query);
  // `artist:foo`와 `foo`는 다른 태그로 둔다
  const uniq = new Map<string, TagSuggestion>();
  for (const t of list) {
    const k = normalizeTag(t.tag);
    const prev = uniq.get(k);
    if (!prev || t.count > prev.count) uniq.set(k, t);
  }
  const suggestions = [...uniq.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  const exact = uniq.get(want);
  if (exact) return { status: "found", found: true, match: exact, suggestions };
  if (isArtist(want)) {
    // 아티스트로 물었는데 같은 이름의 일반 태그만 있으면 "있음"으로 치지 않는다 (artist:sketch 같은 지어낸 이름 걸러내기)
    const general = uniq.get(plainName(want));
    if (general) return { status: "general_only", found: false, match: general, suggestions };
    return { status: "unlisted", found: false, suggestions };
  }
  // 접두어 없이 물었으면 같은 이름의 아티스트 태그도 맞는 걸로 (올바른 표기를 알려 주려고)
  const asArtist = uniq.get(`artist:${want}`);
  if (asArtist) return { status: "found", found: true, match: asArtist, suggestions };
  return { status: "not_found", found: false, suggestions };
}

export async function checkTags(client: NaiClient, modelId: string, queries: string[]): Promise<TagCheck[]> {
  const out: TagCheck[] = [];
  let firstError: NaiApiError | undefined;
  for (const query of splitQueries(queries)) {
    try {
      const search = searchForm(query);
      let list = await client.suggestTags(modelId, search);
      let r = judge(list, query);
      // `artist:`를 붙여 검색해서 못 찾았으면 이름만으로 한 번 더 (검색이 접두어를 다르게 다룰 수 있어서)
      if (r.status === "unlisted" && /^artist\s*:/i.test(search)) {
        const plain = search.replace(/^artist\s*:\s*/i, "");
        if (plain) {
          list = [...list, ...(await client.suggestTags(modelId, plain))];
          r = judge(list, query);
        }
      }
      out.push({ query, ...r });
    } catch (e) {
      // 토큰 문제는 바로 멈추고, 그 밖의 오류는 그 태그만 실패로 두고 계속
      if (e instanceof NaiApiError && (e.kind === "unauthorized" || e.kind === "no_token")) throw e;
      if (e instanceof NaiApiError && !firstError) firstError = e;
      out.push({ query, status: "error", found: false, suggestions: [], error: (e as Error)?.message ?? String(e) });
    }
  }
  // 전부 실패했으면 검색 자체를 못 쓰는 것
  if (out.length > 0 && out.every((t) => t.status === "error")) {
    throw firstError ?? new NaiApiError("bad_response", out[0]!.error ?? "태그 검색 실패");
  }
  return out;
}
