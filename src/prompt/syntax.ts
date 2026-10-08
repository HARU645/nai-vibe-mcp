// 프롬프트 문법 정리. NAI는 `1.2::tag::`, `{tag}`(×1.05), `[tag]`(÷1.05)를 쓴다.
// ComfyUI/A1111식 `(tag:1.2)`가 들어오면 NAI식으로 바꾼다.

const WEIGHTED_PAREN = /(?<!\\)\(([^()]+?):\s*(-?\d+(?:\.\d+)?)\s*(?<!\\)\)/g;

/** `(tag:1.2)` → `1.2::tag::`. 가중치 없는 괄호는 태그 이름일 수 있어서(`ych (character)`) 그대로 둔다 */
export function convertWeightSyntax(prompt: string): string {
  let out = prompt;
  // 중첩된 경우를 위해 바뀌는 게 없을 때까지 반복
  for (let i = 0; i < 5; i++) {
    const next = out.replace(WEIGHTED_PAREN, (_m, body: string, weight: string) => {
      const w = Number(weight);
      const text = body.trim();
      if (!Number.isFinite(w) || text === "") return _m;
      return `${trimNumber(w)}::${text}::`;
    });
    if (next === out) break;
    out = next;
  }
  // ComfyUI에서 쓰던 이스케이프 `\(` `\)`는 NAI에선 그냥 괄호
  return out.replace(/\\([()])/g, "$1");
}

function trimNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** 공백·쉼표 정리: 줄바꿈은 살리고(`Text:` 블록 때문에), 연속 쉼표·앞뒤 쉼표를 지운다 */
export function tidyPrompt(prompt: string): string {
  return prompt
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+/g, " ")
        .replace(/\s*,\s*/g, ", ")
        .replace(/(,\s*){2,}/g, ", ")
        .replace(/^\s*,\s*/, "")
        .replace(/\s*,\s*$/, "")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 프롬프트 조각들을 쉼표로 잇는다 (빈 조각은 건너뜀) */
export function joinTags(...parts: Array<string | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim().replace(/^,+|,+$/g, "").trim())
    .filter((p) => p.length > 0)
    .join(", ");
}

/** 대소문자 무시하고 태그 문자열이 이미 들어 있는지 */
export function containsText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
