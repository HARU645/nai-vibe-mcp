// 설정은 전부 환경변수로 받는다. Claude 데스크톱(.mcpb)은 확장 설정 창의 값을 이 환경변수로 넘겨 준다.
// 빈 문자열은 "설정 안 함"으로 본다 (.mcpb는 비워 둔 칸을 ""로 넘긴다).

import os from "node:os";
import path from "node:path";
import { DEFAULT_API_BASE } from "./api/client.js";
import type { CostMode } from "./cost/guard.js";
import { type ModelInfo, resolveModel, MODELS } from "./models.js";

export interface Config {
  token: string | undefined;
  outputDir: string;
  defaultModel: ModelInfo;
  costMode: CostMode;
  allowMax: number;
  sessionLimit: number;
  maxCount: number;
  /** Full 모델에서 웹처럼 UC 앞에 `nsfw`를 붙일지 (기본 켜짐) */
  nsfwGuard: boolean;
  updateCheck: boolean;
  apiBase: string;
  timeoutMs: number;
  /** 설정값이 이상해서 기본값으로 바꾼 것들 (nai_about에 보여 줌) */
  warnings: string[];
}

function env(name: string, e: NodeJS.ProcessEnv, warnings?: string[]): string | undefined {
  const v = e[name];
  if (v === undefined) return undefined;
  const t = v.trim();
  if (t === "") return undefined;
  // .mcpb가 치환 못 한 자리표시자(${user_config.x}, ${HOME} 등)는 설정 안 한 걸로 본다
  if (t.includes("${")) {
    if (!/^\$\{user_config\.[^}]+\}$/.test(t)) warnings?.push(`${name} 값에 치환되지 않은 \${…}가 있어 무시했습니다`);
    return undefined;
  }
  return t;
}

function num(name: string, e: NodeJS.ProcessEnv, def: number, min: number, max: number, warnings: string[]): number {
  const raw = env(name, e);
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    warnings.push(`${name}=${raw} 값이 올바르지 않아 기본값(${def})을 사용했습니다 (${min}~${max})`);
    return def;
  }
  return Math.floor(n);
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function defaultOutputDir(): string {
  return path.join(os.homedir(), "Pictures", "nai-vibe");
}

export function loadConfig(e: NodeJS.ProcessEnv = process.env): Config {
  const warnings: string[] = [];
  const token = env("NAI_TOKEN", e) ?? env("NOVELAI_API_KEY", e) ?? env("NAI_API_KEY", e);

  const modelRaw = env("NAI_DEFAULT_MODEL", e);
  let defaultModel = resolveModel(modelRaw ?? "v4.5-full") ?? MODELS[2]!;
  if (modelRaw && !resolveModel(modelRaw)) {
    warnings.push(`알 수 없는 NAI_DEFAULT_MODEL 값(${modelRaw})이라 기본 모델(${defaultModel.key})을 사용했습니다`);
  }

  const modeRaw = (env("NAI_COST_MODE", e) ?? "confirm").toLowerCase();
  let costMode: CostMode = "confirm";
  if (modeRaw === "confirm" || modeRaw === "free_only" || modeRaw === "allow") costMode = modeRaw;
  else warnings.push(`알 수 없는 NAI_COST_MODE 값(${modeRaw})이라 confirm을 사용했습니다`);

  return {
    token,
    outputDir: path.resolve(expandHome(env("NAI_OUTPUT_DIR", e, warnings) ?? defaultOutputDir())),
    defaultModel,
    costMode,
    allowMax: num("NAI_ALLOW_MAX", e, 30, 0, 10_000, warnings),
    sessionLimit: num("NAI_SESSION_LIMIT", e, 1000, 0, 1_000_000, warnings),
    maxCount: num("NAI_MAX_COUNT", e, 4, 1, 8, warnings),
    nsfwGuard: !/^(0|false|off|no)$/i.test(env("NAI_NSFW_GUARD", e) ?? "true"),
    updateCheck: !/^(0|false|off|no)$/i.test(env("NAI_UPDATE_CHECK", e) ?? "true"),
    apiBase: env("NAI_API_BASE", e) ?? DEFAULT_API_BASE,
    timeoutMs: num("NAI_TIMEOUT_MS", e, 180_000, 10_000, 600_000, warnings),
    warnings,
  };
}
