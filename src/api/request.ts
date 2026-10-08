// /ai/generate-image 요청 본문 만들기 (docs/api-notes.md 3장).

import type { ModelInfo } from "../models.js";

export const SAMPLERS = [
  "k_euler_ancestral",
  "k_euler",
  "k_dpmpp_2s_ancestral",
  "k_dpmpp_2m",
  "k_dpmpp_sde",
  "k_dpmpp_2m_sde",
] as const;
export type Sampler = (typeof SAMPLERS)[number];

export const NOISE_SCHEDULES = ["karras", "exponential", "polyexponential"] as const;
export type NoiseSchedule = (typeof NOISE_SCHEDULES)[number];

export interface CharacterInput {
  prompt: string;
  negative: string;
  /** 0~1 좌표. 없으면 AI가 정함 */
  center?: { x: number; y: number };
}

export interface GenerateParams {
  model: ModelInfo;
  prompt: string;
  negative: string;
  width: number;
  height: number;
  steps: number;
  scale: number;
  sampler: Sampler;
  noiseSchedule: NoiseSchedule;
  cfgRescale: number;
  seed: number;
  varietyPlus: boolean;
  characters: CharacterInput[];
  tagHintQt: number;
  tagHintUc: number;
}

const GRID = [0.1, 0.3, 0.5, 0.7, 0.9];

function snapToGrid(v: number): number {
  let best = GRID[0]!;
  for (const g of GRID) if (Math.abs(g - v) < Math.abs(best - v)) best = g;
  return best;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** NAI 웹이 쓰는 Variety+ 컷오프: 그림이 클수록 CFG를 오래 끈다 */
export function varietyPlusSigma(width: number, height: number): number {
  const w = Math.floor(Math.max(1, width) / 8);
  const h = Math.floor(Math.max(1, height) / 8);
  return 19 * Math.sqrt((w * h) / (128 * 128));
}

export function buildGenerateBody(p: GenerateParams): Record<string, unknown> {
  const chars = p.characters.slice(0, p.model.maxCharacters).map((c) => {
    const center = c.center
      ? p.model.freePosition
        ? { x: clamp01(c.center.x), y: clamp01(c.center.y) }
        : { x: snapToGrid(c.center.x), y: snapToGrid(c.center.y) }
      : undefined;
    return { ...c, center };
  });
  const useCoords = chars.some((c) => c.center !== undefined);
  const centerOf = (c: (typeof chars)[number]) => c.center ?? { x: 0.5, y: 0.5 };

  const parameters: Record<string, unknown> = {
    params_version: p.model.paramsVersion,
    width: p.width,
    height: p.height,
    scale: p.scale,
    sampler: p.sampler,
    steps: p.steps,
    n_samples: 1,
    seed: p.seed,
    noise_schedule: p.noiseSchedule,
    cfg_rescale: p.cfgRescale,
    skip_cfg_above_sigma: p.varietyPlus ? varietyPlusSigma(p.width, p.height) : null,
    tag_hint_qt: p.tagHintQt,
    tag_hint_uc_preset: p.tagHintUc,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    legacy: false,
    legacy_v3_extend: false,
    legacy_uc: false,
    prefer_brownian: true,
    deliberate_euler_ancestral_bug: false,
    add_original_image: false,
    negative_prompt: p.negative,
    use_coords: useCoords,
    v4_prompt: {
      caption: {
        base_caption: p.prompt,
        char_captions: chars.map((c) => ({ char_caption: c.prompt, centers: [centerOf(c)] })),
      },
      use_coords: useCoords,
      use_order: true,
      legacy_uc: false,
    },
    v4_negative_prompt: {
      caption: {
        base_caption: p.negative,
        char_captions: chars.map((c) => ({ char_caption: c.negative, centers: [centerOf(c)] })),
      },
      use_coords: false,
      use_order: false,
      legacy_uc: false,
    },
    characterPrompts: chars.map((c) => ({
      prompt: c.prompt,
      uc: c.negative,
      center: centerOf(c),
      enabled: true,
    })),
  };

  return {
    input: p.prompt,
    model: p.model.id,
    action: "generate",
    parameters,
  };
}

/** "C3" 같은 칸 이름(A~E 열, 1~5 행)이나 {x,y}를 0~1 좌표로 */
export function parsePosition(pos: string | { x: number; y: number } | undefined): { x: number; y: number } | undefined {
  if (pos === undefined) return undefined;
  if (typeof pos === "object") return { x: clamp01(pos.x), y: clamp01(pos.y) };
  const m = /^\s*([A-Ea-e])\s*([1-5])\s*$/.exec(pos);
  if (!m) return undefined;
  const col = m[1]!.toUpperCase().charCodeAt(0) - 65;
  const row = Number(m[2]) - 1;
  return { x: GRID[col]!, y: GRID[row]! };
}
