// NovelAI HTTP 호출은 전부 여기만 거친다 (API가 바뀌면 이 파일만 고치면 되게).
// - 한 계정에 한 번에 한 요청만 보낸다 (겹치면 429).
// - 요청이 서버에 닿은 뒤엔 자동 재시도하지 않는다. 429(거절됨, 과금 없음)만 예외.
// - 토큰은 어떤 메시지·로그에도 남기지 않는다.

import { unzipSync } from "fflate";

export const DEFAULT_API_BASE = "https://image.novelai.net";

export type NaiErrorKind =
  | "no_token"
  | "bad_request"
  | "unauthorized"
  | "payment_required"
  | "conflict"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network"
  | "bad_response";

export class NaiApiError extends Error {
  constructor(
    readonly kind: NaiErrorKind,
    message: string,
    readonly status?: number,
    readonly detail?: string,
    /** 요청이 서버에 닿았을 수 있어서 과금됐을 가능성이 있는지 */
    readonly maybeCharged = false,
  ) {
    super(message);
    this.name = "NaiApiError";
  }
}

export interface Subscription {
  tier: number;
  active: boolean;
  expiresAt?: number;
  trainingStepsLeft?: { fixedTrainingStepsLeft?: number; purchasedTrainingSteps?: number };
  perks?: { unlimitedImageGeneration?: boolean; [k: string]: unknown };
  usage?: { percent?: number; isNegative?: boolean; timeUntilNextPercent?: number };
  [k: string]: unknown;
}

export interface TagSuggestion {
  tag: string;
  /** NovelAI가 알려 주는 태그 수 (그 태그가 붙은 그림 수로 보임) */
  count: number;
  /** 0~1. NovelAI 웹에서 태그 옆 동그라미 진하기로 보여 주는 값으로 보임 */
  confidence: number;
}

export interface ClientOptions {
  token: string | undefined;
  base?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** 429 재시도 대기(ms). 테스트에서 줄이려고 둠 */
  retryDelaysMs?: number[];
  userAgent?: string;
}

const TOKEN_PATTERN = /pst-[A-Za-z0-9_\-]+/g;

/** 토큰처럼 생긴 문자열과 Bearer 값을 지운다 */
export function scrubSecrets(text: string, token?: string): string {
  let out = text;
  // 정확한 토큰부터 지워야 이상한 문자가 섞인 토큰도 꼬리가 안 남는다
  if (token && token.length >= 8) out = out.split(token).join("***");
  out = out.replace(TOKEN_PATTERN, "pst-***");
  return out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer ***");
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];

function isPng(b: Uint8Array): boolean {
  return PNG_SIG.every((v, i) => b[i] === v);
}

/** 응답(zip 안의 image_0.png…)에서 PNG들을 순서대로 꺼낸다. zip이 아니고 PNG면 그대로 */
export function extractImages(body: Uint8Array): Buffer[] {
  if (body[0] === 0x50 && body[1] === 0x4b) {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(body);
    } catch (e) {
      throw new NaiApiError("bad_response", "NovelAI 응답 zip을 풀지 못했습니다.", undefined, String(e), true);
    }
    const names = Object.keys(files)
      .filter((n) => /\.(png|webp)$/i.test(n))
      .sort((a, b) => indexOf(a) - indexOf(b) || a.localeCompare(b));
    const images = names.map((n) => Buffer.from(files[n]!));
    if (images.length === 0) {
      throw new NaiApiError("bad_response", "NovelAI 응답 zip 안에 그림이 없습니다.", undefined, Object.keys(files).join(", "), true);
    }
    return images;
  }
  if (isPng(body)) return [Buffer.from(body)];
  throw new NaiApiError("bad_response", "NovelAI 응답이 zip도 PNG도 아닙니다.", undefined, undefined, true);
}

function indexOf(name: string): number {
  const m = /(\d+)\.\w+$/.exec(name);
  return m ? Number(m[1]) : 0;
}

export class NaiClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelaysMs: number[];
  private readonly userAgent: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ClientOptions) {
    this.base = (opts.base ?? DEFAULT_API_BASE).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 180_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retryDelaysMs = opts.retryDelaysMs ?? [3_000, 8_000];
    this.userAgent = opts.userAgent ?? "nai-vibe-mcp";
  }

  get hasToken(): boolean {
    return !!this.opts.token;
  }

  /** 요청을 한 줄로 세워서 하나씩 보낸다 */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private headers(): Record<string, string> {
    if (!this.opts.token) {
      throw new NaiApiError(
        "no_token",
        "NovelAI 토큰이 설정되어 있지 않습니다. NovelAI 계정 설정 → Account → Get Persistent API Token에서 발급한 pst-로 시작하는 토큰을 확장 프로그램 설정에 입력해 주세요.",
      );
    }
    return {
      Authorization: `Bearer ${this.opts.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, application/zip, application/octet-stream, */*",
      "User-Agent": this.userAgent,
    };
  }

  /**
   * 요청을 보내고 read로 본문까지 읽는다. 타임아웃은 본문을 다 읽을 때까지 유지한다
   * (헤더만 오고 멈추면 큐 전체가 막히니까).
   */
  private async send<T>(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown },
    charged: boolean,
    read: (res: Response) => Promise<T>,
  ): Promise<T> {
    const headers = this.headers();
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      const timeoutError = () =>
        new NaiApiError("timeout", `NovelAI가 ${Math.round(this.timeoutMs / 1000)}초 안에 응답하지 않았습니다.`, undefined, undefined, charged);
      const networkError = (e: unknown) =>
        new NaiApiError(
          "network",
          "NovelAI와 연결이 끊겼습니다. 인터넷 연결을 확인해 주세요.",
          undefined,
          scrubSecrets(String((e as Error)?.message ?? e), this.opts.token),
          // 연결이 중간에 끊긴 경우엔 서버가 이미 받았을 수도 있다
          charged,
        );
      try {
        let res: Response;
        try {
          res = await this.fetchImpl(`${this.base}${path}`, {
            method: init.method,
            headers,
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
            signal: ctrl.signal,
          });
        } catch (e) {
          throw ctrl.signal.aborted || (e as { name?: string })?.name === "AbortError" ? timeoutError() : networkError(e);
        }
        if (res.status === 429 && attempt < this.retryDelaysMs.length) {
          await res.arrayBuffer().catch(() => undefined);
          clearTimeout(timer);
          await new Promise((r) => setTimeout(r, this.retryDelaysMs[attempt]));
          continue;
        }
        if (!res.ok) throw await this.toError(res, charged);
        try {
          return await read(res);
        } catch (e) {
          if (e instanceof NaiApiError) throw e;
          throw ctrl.signal.aborted ? timeoutError() : networkError(e);
        }
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private async toError(res: Response, charged: boolean): Promise<NaiApiError> {
    let detail = "";
    try {
      detail = scrubSecrets((await res.text()).slice(0, 500), this.opts.token);
    } catch {
      /* ignore */
    }
    const s = res.status;
    if (s === 400) return new NaiApiError("bad_request", "NovelAI가 요청을 거절했습니다 (400). 설정값을 확인해 주세요.", s, detail);
    if (s === 401) return new NaiApiError("unauthorized", "토큰이 올바르지 않습니다 (401). 토큰을 다시 확인해 주세요.", s, detail);
    if (s === 402)
      return new NaiApiError("payment_required", "Anlas가 부족하거나 이 기능에 구독이 필요합니다 (402).", s, detail);
    if (s === 409) return new NaiApiError("conflict", "NovelAI가 요청 충돌을 알렸습니다 (409).", s, detail);
    if (s === 429)
      return new NaiApiError("rate_limited", "NovelAI 요청이 너무 잦습니다 (429). 잠시 후 다시 시도해 주세요.", s, detail);
    if (s >= 500)
      return new NaiApiError("server_error", `NovelAI 서버 오류입니다 (${s}).`, s, detail, charged);
    return new NaiApiError("bad_request", `NovelAI에서 예상하지 못한 응답이 왔습니다 (${s}).`, s, detail);
  }

  getSubscription(): Promise<Subscription> {
    return this.enqueue(async () => {
      return this.send("/user/subscription", { method: "GET" }, false, async (res) => {
        const raw = await res.text();
        try {
          return JSON.parse(raw) as Subscription;
        } catch (e) {
          throw new NaiApiError("bad_response", "구독 정보를 읽지 못했습니다.", res.status, String(e));
        }
      });
    });
  }

  /**
   * 태그 자동완성 (NovelAI 웹 프롬프트 입력창이 쓰는 것). Anlas가 들지 않는다.
   * 응답 형식은 오픈소스 클라이언트(novelai-python) 기준: { tags: [{ tag, count, confidence }] }
   */
  suggestTags(model: string, prompt: string, lang: "en" | "jp" = "en"): Promise<TagSuggestion[]> {
    const q = new URLSearchParams({ model, prompt, lang });
    return this.enqueue(async () => {
      return this.send(`/ai/generate-image/suggest-tags?${q.toString()}`, { method: "GET" }, false, async (res) => {
        const raw = await res.text();
        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch (e) {
          throw new NaiApiError("bad_response", "태그 검색 결과를 읽지 못했습니다.", res.status, String(e));
        }
        // 형식이 바뀌었으면 "전부 없음"으로 보이지 않게 오류로 (그러면 진짜 있는 태그까지 빼 버린다)
        const shapeError = (why: string) =>
          new NaiApiError("bad_response", `태그 검색 응답 형식이 예상과 다릅니다 (${why}).`, res.status, raw.slice(0, 200));
        if (!data || typeof data !== "object" || Array.isArray(data)) throw shapeError("객체가 아님");
        const list = (data as { tags?: unknown }).tags;
        if (list === undefined || list === null) return [];
        if (!Array.isArray(list)) throw shapeError("tags가 배열이 아님");
        const valid = list.filter(
          (t): t is Record<string, unknown> => !!t && typeof t === "object" && typeof (t as { tag?: unknown }).tag === "string",
        );
        if (list.length > 0 && valid.length === 0) throw shapeError("tag 필드 없음");
        return valid
          .map((t) => ({
            tag: String(t.tag),
            count: typeof t.count === "number" && Number.isFinite(t.count) ? t.count : 0,
            confidence: typeof t.confidence === "number" && Number.isFinite(t.confidence) ? t.confidence : 0,
          }));
      });
    });
  }

  /** 그림 생성. 요청 하나 = 그림 한 장 (n_samples는 항상 1) */
  generate(body: Record<string, unknown>): Promise<Buffer[]> {
    return this.enqueue(async () => {
      return this.send("/ai/generate-image", { method: "POST", body }, true, async (res) =>
        extractImages(new Uint8Array(await res.arrayBuffer())),
      );
    });
  }
}

/** 구독 응답에서 쓰는 값만 뽑는다 */
export function anlasOf(sub: Subscription): number {
  const t = sub.trainingStepsLeft ?? {};
  return (t.fixedTrainingStepsLeft ?? 0) + (t.purchasedTrainingSteps ?? 0);
}
