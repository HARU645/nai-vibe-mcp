// 비용 가드. Claude가 알아서 반복해서 뽑다가 Anlas를 태우는 사고를 막는 게 목적.
// - confirm 모드: 돈이 드는 요청은 먼저 예상치와 확인 번호(confirm_id)만 돌려준다.
//   같은 요청을 그 번호와 함께 다시 보내야 실행된다. 번호는 요청 내용에 묶여 있고 한 번만 쓸 수 있다.
// - 세션 누적 상한은 모든 모드에 적용되는 마지막 안전장치.

import { createHash, randomBytes } from "node:crypto";
import type { CostEstimate } from "./cost.js";

export type CostMode = "confirm" | "free_only" | "allow";

export interface GuardOptions {
  mode: CostMode;
  /** allow 모드에서 묻지 않고 쓰는 요청 하나의 상한 */
  allowMax: number;
  /** 서버가 켜져 있는 동안 쓸 수 있는 Anlas 상한. 0이면 없음 */
  sessionLimit: number;
  /** 확인 번호 유효 시간 */
  confirmTtlMs?: number;
  now?: () => number;
}

export type GuardDecision =
  | { action: "run"; estimate: CostEstimate }
  | { action: "confirm"; confirmId: string; message: string; estimate: CostEstimate }
  | { action: "blocked"; message: string };

interface Pending {
  hash: string;
  total: number;
  expires: number;
}

export function hashRequest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 32);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export class CostGuard {
  private spent = 0;
  /** 무료로 예상한 생성에서 실제로 Anlas가 빠진 적이 있으면 켜진다. 그 뒤로는 무료 예상도 확인받는다 */
  private freeMismatch = false;
  private readonly pending = new Map<string, Pending>();
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(private readonly opts: GuardOptions) {
    this.ttl = opts.confirmTtlMs ?? 15 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  get mode(): CostMode {
    return this.opts.mode;
  }
  get sessionSpent(): number {
    return this.spent;
  }
  get sessionLimit(): number {
    return this.opts.sessionLimit;
  }
  get allowMax(): number {
    return this.opts.allowMax;
  }

  check(
    requestHash: string,
    estIn: CostEstimate,
    confirmId: string | undefined,
    anlas: number | null,
    summary?: string,
  ): GuardDecision {
    this.prune();
    const limit = this.opts.sessionLimit;
    // 세션 상한은 무료 예상보다 먼저 본다 (무료 예상이 틀렸을 때도 멈추게)
    if (limit > 0 && this.spent >= limit) {
      return {
        action: "blocked",
        message: `이번 세션 Anlas 상한(${limit})에 도달했습니다 (지금까지 약 ${this.spent} 사용). 더 사용하려면 확장 프로그램 설정에서 세션 상한을 올리거나 앱을 다시 시작해 주세요.`,
      };
    }
    let est = estIn;
    if (est.total === 0 && this.freeMismatch) {
      est = {
        ...est,
        free: false,
        total: est.perImage * est.count,
        reason: "무료로 예상한 생성에서 실제로 Anlas가 차감된 적이 있어, 이번 세션에서는 무료 예상도 확인을 받음",
      };
    }
    if (est.total === 0) return { action: "run", estimate: est };

    if (anlas !== null && anlas < est.total) {
      return {
        action: "blocked",
        message: `Anlas가 부족합니다. 예상 ${est.total} Anlas가 필요하지만 현재 잔액은 ${anlas} Anlas입니다.`,
      };
    }

    if (this.opts.mode === "free_only") {
      return {
        action: "blocked",
        message: `비용 모드가 free_only여서 유료 생성은 실행하지 않습니다 (예상 ${est.total} Anlas — ${est.reason}). 크기·스텝을 줄이거나 확장 프로그램 설정에서 비용 모드를 바꿔 주세요.`,
      };
    }

    if (limit > 0 && this.spent + est.total > limit) {
      return {
        action: "blocked",
        message: `이번 세션 Anlas 상한(${limit})을 넘게 됩니다 (지금까지 약 ${this.spent} 사용, 이번 요청 약 ${est.total}). 더 사용하려면 확장 프로그램 설정에서 세션 상한을 올리거나 앱을 다시 시작해 주세요.`,
      };
    }

    if (confirmId) {
      const p = this.pending.get(confirmId);
      if (p && p.hash === requestHash && est.total <= p.total) {
        this.pending.delete(confirmId);
        return { action: "run", estimate: est };
      }
      // 번호가 틀렸거나, 요청이 바뀌었거나, 비용이 올랐으면 새로 확인받는다
    }

    if (this.opts.mode === "allow" && est.total <= this.opts.allowMax) return { action: "run", estimate: est };

    const id = randomBytes(6).toString("hex");
    this.pending.set(id, { hash: requestHash, total: est.total, expires: this.now() + this.ttl });
    return {
      action: "confirm",
      confirmId: id,
      message: this.confirmMessage(est, anlas, summary),
      estimate: est,
    };
  }

  private confirmMessage(est: CostEstimate, anlas: number | null, summary?: string): string {
    const lines = [
      `💰 이 요청에는 Anlas가 듭니다: 장당 약 ${est.perImage} × ${est.count}장 = 약 ${est.total} Anlas`,
      ...(summary ? [`요청: ${summary}`] : []),
      `이유: ${est.reason}`,
    ];
    if (anlas !== null) lines.push(`현재 잔액: ${anlas} Anlas → 생성 후 약 ${anlas - est.total}`);
    if (this.opts.sessionLimit > 0) lines.push(`이번 세션에 쓴 양: 약 ${this.spent} / 상한 ${this.opts.sessionLimit}`);
    lines.push("아직 아무것도 생성하지 않았습니다. 사용자에게 진행 여부를 확인하고, 동의를 받으면 같은 인자에 confirm_id를 넣어 다시 호출하세요.");
    return lines.join("\n");
  }

  /**
   * 실제로 쓴 양(잔액 차이)을 기록한다. 잔액을 못 읽었으면 예상치를 넣는다.
   * 무료로 예상(estimatedFree)했는데 실제로 빠졌으면 이후 무료 예상도 확인받게 한다.
   */
  record(spent: number, estimatedFree = false): void {
    if (Number.isFinite(spent) && spent > 0) {
      this.spent += spent;
      if (estimatedFree) this.freeMismatch = true;
    }
  }

  private prune(): void {
    const t = this.now();
    for (const [id, p] of this.pending) if (p.expires < t) this.pending.delete(id);
  }
}
