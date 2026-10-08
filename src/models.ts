// 모델 표. 모델마다 다른 값은 전부 여기에만 둔다 (docs/api-notes.md 2·4장).
// 품질 태그·UC 문자열은 NovelAI 웹 클라이언트가 보내기 전에 붙이는 것과 같아야 한다.

export type ModelFamily = "v5" | "v4.5";
export type QualityPreset = "standard" | "light" | "off";
export type UcPreset = "heavy" | "light" | "human_focus" | "furry_focus" | "none";

export interface ModelInfo {
  key: string;
  id: string;
  label: string;
  family: ModelFamily;
  /** parameters.params_version — V5는 4가 아니면 캐릭터 위치를 버린다 */
  paramsVersion: 3 | 4;
  maxCharacters: number;
  /** V5는 캐릭터 좌표 자유, V4.5는 5x5 칸에 맞춤 */
  freePosition: boolean;
  /** Opus면 조건 안에서 무조건 무료(V4.5). V5는 회복형 할당량에서 차감 */
  opusUnlimited: boolean;
  /** 따옴표 글자를 `Text:` 블록으로 모아 그려 주는 기능 (V5) */
  autoText: boolean;
  /** UC 프리셋이 켜져 있으면 웹이 UC 맨 앞에 `nsfw`를 붙이는 모델 (Full) */
  nsfwGuard: boolean;
  quality: { standard: string; light?: string };
  uc: Partial<Record<Exclude<UcPreset, "none">, string>>;
}

const V5_HEAVY =
  "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page";
const V5_LIGHT =
  "lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::";
const V5_HUMAN_FOCUS = `${V5_HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`;
const FURRY_FOCUS =
  "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic";
const V45_FULL_LIGHT =
  "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page";
const V45_CUR_HEAVY =
  "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page";
const V45_CUR_LIGHT =
  "blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page";
const V45_CUR_HUMAN_FOCUS =
  "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page";

const V5_QUALITY = "very aesthetic, masterpiece, no text";
const V5_QUALITY_LIGHT = "very aesthetic, amazing quality, no text";

export const MODELS: readonly ModelInfo[] = [
  {
    key: "v5-full",
    id: "nai-diffusion-5-full",
    label: "NovelAI Diffusion V5 Full",
    family: "v5",
    paramsVersion: 4,
    maxCharacters: 22,
    freePosition: true,
    opusUnlimited: false,
    autoText: true,
    nsfwGuard: true,
    quality: { standard: V5_QUALITY, light: V5_QUALITY_LIGHT },
    uc: { heavy: V5_HEAVY, light: V5_LIGHT, human_focus: V5_HUMAN_FOCUS, furry_focus: FURRY_FOCUS },
  },
  {
    key: "v5-curated",
    id: "nai-diffusion-5-curated",
    label: "NovelAI Diffusion V5 Curated",
    family: "v5",
    paramsVersion: 4,
    maxCharacters: 22,
    freePosition: true,
    opusUnlimited: false,
    autoText: true,
    nsfwGuard: false,
    quality: { standard: V5_QUALITY, light: V5_QUALITY_LIGHT },
    uc: { heavy: V5_HEAVY, light: V5_LIGHT, human_focus: V5_HUMAN_FOCUS, furry_focus: FURRY_FOCUS },
  },
  {
    key: "v4.5-full",
    id: "nai-diffusion-4-5-full",
    label: "NovelAI Diffusion V4.5 Full",
    family: "v4.5",
    paramsVersion: 3,
    maxCharacters: 6,
    freePosition: false,
    opusUnlimited: true,
    autoText: false,
    nsfwGuard: true,
    // 공식 문서는 앞에 `location, `이 더 붙어 있지만 지금 웹 클라이언트는 V5와 같은 걸 보낸다 (api-notes 4-1)
    quality: { standard: V5_QUALITY },
    uc: { heavy: V5_HEAVY, light: V45_FULL_LIGHT, human_focus: V5_HUMAN_FOCUS, furry_focus: FURRY_FOCUS },
  },
  {
    key: "v4.5-curated",
    id: "nai-diffusion-4-5-curated",
    label: "NovelAI Diffusion V4.5 Curated",
    family: "v4.5",
    paramsVersion: 3,
    maxCharacters: 6,
    freePosition: false,
    opusUnlimited: true,
    autoText: false,
    nsfwGuard: false,
    quality: { standard: "location, masterpiece, no text, -0.8::feet::, rating:general" },
    uc: { heavy: V45_CUR_HEAVY, light: V45_CUR_LIGHT, human_focus: V45_CUR_HUMAN_FOCUS },
  },
];

const ALIASES: Record<string, string> = {
  v5: "v5-full",
  "5": "v5-full",
  "v5full": "v5-full",
  "v5curated": "v5-curated",
  "v4.5": "v4.5-full",
  v45: "v4.5-full",
  "4.5": "v4.5-full",
  "v4.5full": "v4.5-full",
  "v45full": "v4.5-full",
  "v4.5curated": "v4.5-curated",
  "v45curated": "v4.5-curated",
  "v45-full": "v4.5-full",
  "v45-curated": "v4.5-curated",
};

export const MODEL_KEYS = MODELS.map((m) => m.key);

/** "v5", "V4.5 curated", "nai-diffusion-5-full" 같은 이름을 모델로. 모르면 undefined */
export function resolveModel(input: string | undefined): ModelInfo | undefined {
  if (!input) return undefined;
  const raw = input.trim().toLowerCase();
  const byId = MODELS.find((m) => m.id === raw || m.key === raw);
  if (byId) return byId;
  const compact = raw.replace(/[\s_]+/g, "").replace(/^nai/, "").replace(/^diffusion/, "");
  const key = ALIASES[compact] ?? ALIASES[raw];
  return key ? MODELS.find((m) => m.key === key) : undefined;
}

/** NovelAI의 tag_hint 번호 (api-notes 4-2) */
export const QUALITY_HINT: Record<QualityPreset, number> = { off: 0, standard: 1, light: 3 };
export const UC_HINT: Record<UcPreset, number> = {
  none: 0,
  heavy: 2,
  light: 3,
  human_focus: 4,
  furry_focus: 5,
};

/** 모델에 없는 프리셋은 웹처럼 heavy로 대신한다. 실제로 쓴 프리셋을 돌려준다 */
export function resolveUcPreset(model: ModelInfo, preset: UcPreset): { preset: UcPreset; text: string } {
  if (preset === "none") return { preset, text: "" };
  const text = model.uc[preset];
  if (text) return { preset, text };
  return { preset: "heavy", text: model.uc.heavy ?? "" };
}

/** V5가 아닌 모델에서 light를 고르면 standard로 대신한다 */
export function resolveQuality(model: ModelInfo, preset: QualityPreset): { preset: QualityPreset; text: string } {
  if (preset === "off") return { preset, text: "" };
  if (preset === "light" && model.quality.light) return { preset, text: model.quality.light };
  return { preset: "standard", text: model.quality.standard };
}
