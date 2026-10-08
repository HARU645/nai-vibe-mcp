// Anlas 비용 추정 (docs/api-notes.md 8장). NovelAI는 비용 조회 API가 없어서 웹 클라이언트 공식을 쓴다.
// 공식이 바뀌면 COST_RULES 표만 고친다.

import type { ModelFamily, ModelInfo } from "../models.js";
import { anlasOf, type Subscription } from "../api/client.js";

export interface CostRule {
  /**
   * 픽셀 비용에 곱하는 값. 2026-10-08 비구독 계정 실측 (docs/api-notes.md 8장):
   * V4.5 Full·Curated = 1.0 (512²·10스텝 → 3, 832x1216·28스텝 → 20), V5 Full·Curated = 1.5 (→ 5, 30)
   */
  factor: number;
  minPerImage: number;
  maxPerImage: number;
}

export const COST_RULES: Record<ModelFamily, CostRule> = {
  v5: { factor: 1.5, minPerImage: 2, maxPerImage: 140 },
  "v4.5": { factor: 1.0, minPerImage: 2, maxPerImage: 140 },
};

const PIXEL_COEFFICIENT = 2.951823174884865e-6;
const PIXEL_STEP_COEFFICIENT = 5.753298233447344e-7;
const MIN_BILLED_PIXELS = 65_536;

export const OPUS_FREE_PIXELS = 1024 * 1024;
export const OPUS_FREE_STEPS = 28;

/** 한 장 값 (Opus 할인 전) */
export function costPerImage(model: ModelInfo, width: number, height: number, steps: number, strength = 1): number {
  const rule = COST_RULES[model.family];
  const pixels = Math.max(MIN_BILLED_PIXELS, Math.floor(width) * Math.floor(height));
  const base = Math.ceil(PIXEL_COEFFICIENT * pixels + PIXEL_STEP_COEFFICIENT * pixels * Math.max(1, Math.floor(steps)));
  let per = base * rule.factor;
  const s = Math.min(1, Math.max(0, strength));
  if (s < 1) per *= s;
  return Math.max(rule.minPerImage, Math.ceil(per));
}

export interface V5Allowance {
  /** 남은 % (보너스로 100을 넘을 수 있음) */
  percent: number;
  empty: boolean;
  /** 웹이 쓰는 환산: 1% ≈ 17.3장 */
  approxImages: number;
  refillPercentPerDay: number;
}

export interface AccountState {
  tierName: string;
  active: boolean;
  opus: boolean;
  anlas: number;
  v5Allowance: V5Allowance | null;
}

const TIER_NAMES = ["Paper(무료)", "Tablet", "Scroll", "Opus"];
const IMAGES_PER_PERCENT = 17.3;

export function accountStateOf(sub: Subscription): AccountState {
  const tier = typeof sub.tier === "number" ? sub.tier : 0;
  const active = !!sub.active;
  const opus = active && (tier >= 3 || sub.perks?.unlimitedImageGeneration === true);
  let v5: V5Allowance | null = null;
  if (opus && sub.usage) {
    const raw = Number(sub.usage.percent ?? 0);
    const negative = !!sub.usage.isNegative;
    const percent = negative ? 0 : Math.max(0, raw);
    const next = Number(sub.usage.timeUntilNextPercent ?? 0);
    v5 = {
      percent,
      empty: negative || raw <= 0,
      approxImages: Math.round(IMAGES_PER_PERCENT * percent),
      refillPercentPerDay: next > 0 ? Math.round((86_400 / next) * 10) / 10 : 0,
    };
  }
  return {
    tierName: TIER_NAMES[tier] ?? `등급 ${tier}`,
    active,
    opus,
    anlas: anlasOf(sub),
    v5Allowance: v5,
  };
}

export interface CostEstimate {
  perImage: number;
  count: number;
  /** 예상 총 차감 Anlas (무료면 0) */
  total: number;
  free: boolean;
  /** 사람이 읽는 이유 */
  reason: string;
}

/**
 * 계정 상태를 모르면(조회 실패) 유료로 친다 — 안전한 쪽으로.
 * 여러 장은 항상 한 장씩 보내므로 Opus 무료 판정도 장마다 따로 적용된다.
 */
export function estimateCost(
  model: ModelInfo,
  width: number,
  height: number,
  steps: number,
  count: number,
  account: AccountState | null,
): CostEstimate {
  const perImage = costPerImage(model, width, height, steps);
  const withinOpus = width * height <= OPUS_FREE_PIXELS && steps <= OPUS_FREE_STEPS;
  const paid = (reason: string): CostEstimate => ({ perImage, count, total: perImage * count, free: false, reason });

  if (!account) return paid("계정 정보를 못 읽어서 유료로 계산했어");
  if (!account.opus) return paid("Opus 구독이 아니라서 모든 생성이 유료야");
  if (!withinOpus) {
    return paid(`Opus 무료 조건(1024x1024 이하 픽셀, ${OPUS_FREE_STEPS}스텝 이하)을 넘어서 유료야`);
  }
  if (!model.opusUnlimited) {
    const a = account.v5Allowance;
    if (!a || a.empty) return paid("V5 무료 할당량이 비어 있어서 유료야");
    // 남은 할당량이 장 수보다 적으면 중간부터 유료가 될 수 있다 → 보수적으로 알림
    if (a.approxImages < count) {
      return paid(`V5 할당량이 약 ${a.approxImages}장 남아서 일부는 유료가 될 수 있어`);
    }
    return { perImage, count, total: 0, free: true, reason: `Opus V5 할당량 안 (약 ${a.approxImages}장 남음)` };
  }
  return { perImage, count, total: 0, free: true, reason: "Opus 무료 조건 안" };
}
