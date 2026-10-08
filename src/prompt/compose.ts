// 최종 프롬프트·UC 조립. NovelAI 서버는 품질 태그와 UC 프리셋을 붙여 주지 않아서
// 웹 클라이언트처럼 우리가 붙여서 보낸다 (docs/api-notes.md 4장).

import {
  type ModelInfo,
  type QualityPreset,
  type UcPreset,
  QUALITY_HINT,
  UC_HINT,
  resolveQuality,
  resolveUcPreset,
} from "../models.js";
import { containsText, convertWeightSyntax, tidyPrompt } from "./syntax.js";

const TEXT_QUOTE_PAIRS: Array<[string, string]> = [
  ["「", "」"],
  ["“", "”"],
  ['"', '"'],
];

/** 프롬프트를 `Text:` 줄 앞(태그)과 그 뒤(글씨 블록)로 나눈다 */
export function splitTextBlock(prompt: string): { head: string; text: string } {
  const lines = prompt.split("\n");
  const idx = lines.findIndex((l) => l.trimStart().startsWith("Text:"));
  if (idx < 0) return { head: prompt, text: "" };
  return { head: lines.slice(0, idx).join("\n"), text: lines.slice(idx).join("\n").trim() };
}

/** 따옴표로 감싼 글자들을 순서대로 뽑는다. 짝이 안 맞는 따옴표는 무시 */
export function extractQuoted(prompt: string): string[] {
  const chars = Array.from(prompt);
  const pieces: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const pair = TEXT_QUOTE_PAIRS.find(([open]) => open === chars[i]);
    if (pair) {
      const close = pair[1];
      let j = i + 1;
      while (j < chars.length && chars[j] !== close) j++;
      if (j < chars.length) {
        const piece = chars.slice(i + 1, j).join("").trim();
        if (piece) pieces.push(piece);
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return pieces;
}

/**
 * 따옴표 안 글자(그림에 그릴 글씨)는 쉼표 정리·가중치 변환에서 빼고 원래대로 둔다.
 * 따옴표 구간을 자리표시자로 바꿔 fn을 돌린 뒤 되돌린다.
 */
function protectQuotes(text: string, fn: (masked: string) => string): string {
  const saved: string[] = [];
  let masked = "";
  const chars = Array.from(text);
  let i = 0;
  while (i < chars.length) {
    const pair = TEXT_QUOTE_PAIRS.find(([open]) => open === chars[i]);
    if (pair) {
      let j = i + 1;
      while (j < chars.length && chars[j] !== pair[1]) j++;
      if (j < chars.length) {
        saved.push(chars.slice(i, j + 1).join(""));
        masked += `\u0000${saved.length - 1}\u0000`;
        i = j + 1;
        continue;
      }
    }
    masked += chars[i];
    i++;
  }
  if (saved.length === 0) return fn(text);
  return fn(masked).replace(/\u0000(\d+)\u0000/g, (_m, n: string) => saved[Number(n)] ?? "");
}

function appendBeforeTextBlock(prompt: string, tags: string): string {
  const { head, text } = splitTextBlock(prompt);
  const trimmed = head.trimEnd().replace(/,+$/, "").trimEnd();
  const joined = trimmed ? `${trimmed}, ${tags}` : tags;
  return text ? `${joined}\n${text}` : joined;
}

export interface ComposedPrompt {
  text: string;
  qualityApplied: QualityPreset;
  tagHintQt: number;
}

/** 사용자 프롬프트 → 문법 변환 → 품질 태그 → (V5) Text 블록 */
export function composePrompt(model: ModelInfo, prompt: string, quality: QualityPreset): ComposedPrompt {
  // 사용자가 직접 쓴 `Text:` 블록은 글씨라서 손대지 않고, 앞쪽 태그만 정리한다
  const split = splitTextBlock(prompt);
  const head = protectQuotes(split.head, (masked) => tidyPrompt(convertWeightSyntax(masked)));
  let text = split.text ? (head ? `${head}\n${split.text}` : split.text) : head;
  const q = resolveQuality(model, quality);
  if (q.text) {
    const { head } = splitTextBlock(text);
    if (!containsText(head, q.text)) text = appendBeforeTextBlock(text, q.text);
  }
  if (model.autoText && !text.split("\n").some((l) => l.trimStart().startsWith("Text:"))) {
    const pieces = extractQuoted(text);
    if (pieces.length > 0) text = `${text.trimEnd()}\nText: ${pieces.join("\n\n")}`;
  }
  return { text, qualityApplied: q.preset, tagHintQt: QUALITY_HINT[q.preset] };
}

export interface ComposedNegative {
  text: string;
  ucApplied: UcPreset;
  tagHintUc: number;
}

/** UC 프리셋을 사용자 UC 앞에 붙이고, Full 모델이면 웹처럼 `nsfw` 가드를 붙인다 */
export function composeNegative(
  model: ModelInfo,
  negative: string,
  finalPrompt: string,
  preset: UcPreset,
): ComposedNegative {
  const user = tidyPrompt(convertWeightSyntax(negative));
  const uc = resolveUcPreset(model, preset);
  let text = user;
  if (uc.text) {
    if (containsText(user, uc.text)) text = user;
    else text = user ? `${uc.text}, ${user}` : uc.text;
    if (model.nsfwGuard && !containsText(finalPrompt, "nsfw") && !containsText(text, "nsfw")) {
      text = `nsfw, ${text}`;
    }
  }
  return { text, ucApplied: uc.preset, tagHintUc: UC_HINT[uc.preset] };
}

/** 캐릭터 프롬프트는 품질 태그 없이 문법만 정리 */
export function composeCharacterText(text: string | undefined): string {
  return tidyPrompt(convertWeightSyntax(text ?? ""));
}
