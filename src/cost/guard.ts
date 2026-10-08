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
  | { action: "run" }
  | { action: "confirm"; confirmId: string; message: string }
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

  check(requestHash: string, est: CostEstimate, confirmId: string | undefined, anlas: number | null): GuardDecision {
    this.prune();
    if (est.total === 0) return { action: "run" };

    if (anlas !== null && anlas < est.total) {
      return {
        action: "blocked",
        message: `Anlas가 모자라. 예상 ${est.total} Anlas가 필요한데 지금 ${anlas} Anlas 있어.`,
      };
    }

    if (this.opts.mode === "free_only") {
      return {
        action: "blocked",
        message: `비용 모드가 free_only라서 유료 생성은 막아 뒀어 (예상 ${est.total} Anlas — ${est.reason}). 크기·스텝을 줄이거나 확장 설정에서 비용 모드를 바꿔 줘.`,
      };
    }

    const limit = this.opts.sessionLimit;
    if (limit > 0 && this.spent + est.total > limit) {
      return {
        action: "blocked",
        message: `이번 세션 Anlas 상한(${limit})을 넘어. 지금까지 약 ${this.spent} 썼고 이번 요청은 ${est.total}이야. 더 쓰려면 확장 설정에서 세션 상한을 올리거나 앱을 다시 켜 줘.`,
      };
    }

    if (confirmId) {
      const p = this.pending.get(confirmId);
      if (p && p.hash === requestHash && est.total <= p.total) {
        this.pending.delete(confirmId);
        return { action: "run" };
      }
      // 번호가 틀렸거나, 요청이 바뀌었거나, 비용이 올랐으면 새로 확인받는다
    }

    if (this.opts.mode === "allow" && est.total <= this.opts.allowMax) return { action: "run" };

    const id = randomBytes(6).toString("hex");
    this.pending.set(id, { hash: requestHash, total: est.total, expires: this.now() + this.ttl });
    return {
      action: "confirm",
      confirmId: id,
      message: this.confirmMessage(est, anlas),
    };
  }

  private confirmMessage(est: CostEstimate, anlas: number | null): string {
    const lines = [
      `💰 이 요청은 Anlas가 들어: 장당 약 ${est.perImage} × ${est.count}장 = 약 ${est.total} Anlas`,
      `이유: ${est.reason}`,
    ];
    if (anlas !== null) lines.push(`지금 잔액: ${anlas} Anlas → 생성 후 약 ${anlas - est.total}`);
    if (this.opts.sessionLimit > 0) lines.push(`이번 세션에 쓴 양: 약 ${this.spent} / 상한 ${this.opts.sessionLimit}`);
    lines.push("아직 아무것도 생성하지 않았어. 사용자에게 진행할지 물어보고, 동의하면 같은 인자에 confirm_id를 넣어 다시 호출해.");
    return lines.join("\n");
  }

  /** 실제로 쓴 양(잔액 차이)을 기록한다. 잔액을 못 읽었으면 예상치를 넣는다 */
  record(spent: number): void {
    if (Number.isFinite(spent) && spent > 0) this.spent += spent;
  }

  private prune(): void {
    const t = this.now();
    for (const [id, p] of this.pending) if (p.expires < t) this.pending.delete(id);
  }
}
