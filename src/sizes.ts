// 해상도 이름. NovelAI 웹의 크기 이름과 같게 하고, 한국어 별명도 받는다.

export interface Size {
  width: number;
  height: number;
}

export const SIZE_PRESETS: Record<string, Size> = {
  portrait: { width: 832, height: 1216 },
  landscape: { width: 1216, height: 832 },
  square: { width: 1024, height: 1024 },
  small_portrait: { width: 512, height: 768 },
  small_landscape: { width: 768, height: 512 },
  small_square: { width: 640, height: 640 },
  large_portrait: { width: 1024, height: 1536 },
  large_landscape: { width: 1536, height: 1024 },
  large_square: { width: 1472, height: 1472 },
};

const SIZE_ALIASES: Record<string, string> = {
  세로: "portrait",
  가로: "landscape",
  정사각: "square",
  정사각형: "square",
  "작은 세로": "small_portrait",
  "작은 가로": "small_landscape",
  "작은 정사각": "small_square",
  "큰 세로": "large_portrait",
  "큰 가로": "large_landscape",
  "큰 정사각": "large_square",
  normal_portrait: "portrait",
  normal_landscape: "landscape",
  normal_square: "square",
};

export const MIN_SIDE = 64;
export const MAX_SIDE = 1600;

/** "portrait", "세로", "832x1216" → 크기. 잘못된 값이면 이유를 담은 Error */
export function parseSize(input: string): Size {
  const raw = input.trim().toLowerCase();
  const name = SIZE_ALIASES[raw] ?? SIZE_ALIASES[input.trim()] ?? raw.replace(/[\s-]+/g, "_");
  const preset = SIZE_PRESETS[name];
  if (preset) return { ...preset };
  const m = /^(\d{2,4})\s*[x×*]\s*(\d{2,4})$/.exec(raw);
  if (!m) {
    throw new Error(
      `알 수 없는 크기입니다: "${input}". ${Object.keys(SIZE_PRESETS).join(", ")} 중 하나나 832x1216 같은 형식으로 지정해 주세요.`,
    );
  }
  return validateSize({ width: Number(m[1]), height: Number(m[2]) });
}

export function validateSize(s: Size): Size {
  for (const [label, v] of [
    ["가로", s.width],
    ["세로", s.height],
  ] as const) {
    if (v < MIN_SIDE || v > MAX_SIDE) throw new Error(`${label} ${v}px은 사용할 수 없습니다. ${MIN_SIDE}~${MAX_SIDE} 사이여야 합니다.`);
    if (v % 64 !== 0) {
      const near = Math.round(v / 64) * 64;
      throw new Error(`${label} ${v}px은 64의 배수가 아닙니다. ${near}px을 사용해 보세요.`);
    }
  }
  return s;
}
