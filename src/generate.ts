// nai_generate의 본체: 프리셋 합치기 → 프롬프트 조립 → 비용 판단 → 한 장씩 생성 → 저장·기록.

import { randomInt } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { NaiApiError, type NaiClient, anlasOf } from "./api/client.js";
import {
  type CharacterInput,
  type NoiseSchedule,
  type Sampler,
  SAMPLERS,
  buildGenerateBody,
  parsePosition,
} from "./api/request.js";
import type { Config } from "./config.js";
import { type AccountState, type CostEstimate, accountStateOf, estimateCost } from "./cost/cost.js";
import { type CostGuard, hashRequest } from "./cost/guard.js";
import { MODELS, type ModelInfo, type QualityPreset, type UcPreset, resolveModel } from "./models.js";
import { makePreview, type Preview } from "./preview.js";
import { composeCharacterText, composeNegative, composePrompt } from "./prompt/compose.js";
import { joinTags } from "./prompt/syntax.js";
import { parseSize, type Size } from "./sizes.js";
import { localDateParts, writeNewFile } from "./store/files.js";
import type { HistoryStore } from "./store/history.js";
import type { SerialQueue } from "./serial.js";
import type { Preset, PresetCharacter, PresetStore } from "./store/presets.js";

export interface GenerateArgs {
  prompt: string;
  negative?: string;
  model?: string;
  size?: string;
  steps?: number;
  scale?: number;
  sampler?: string;
  seed?: number;
  count?: number;
  characters?: PresetCharacter[];
  presets?: string[];
  quality?: QualityPreset;
  uc_preset?: UcPreset;
  variety_plus?: boolean;
  confirm_id?: string;
}

export interface GeneratedImage {
  path: string;
  seed: number;
  width: number;
  height: number;
  preview?: Preview;
}

export type GenerateOutcome =
  | {
      status: "done";
      images: GeneratedImage[];
      model: ModelInfo;
      estimate: CostEstimate;
      anlasBefore: number | null;
      anlasAfter: number | null;
      spent: number | null;
      error?: NaiApiError;
      finalPrompt: string;
      finalNegative: string;
      notes: string[];
    }
  | { status: "needs_confirmation"; confirmId: string; message: string; estimate: CostEstimate; model: ModelInfo }
  | { status: "blocked"; message: string; estimate?: CostEstimate };

export interface GenerateContext {
  config: Config;
  /** 생성은 한 번에 하나씩 (잔액 전후 비교·세션 상한이 정확하려면) */
  serial: SerialQueue;
  client: NaiClient;
  guard: CostGuard;
  presets: PresetStore;
  history: HistoryStore;
}

export const DEFAULT_STEPS = 23;
export const DEFAULT_SCALE = 5;
export const DEFAULT_SAMPLER: Sampler = "k_euler_ancestral";
const NOISE: NoiseSchedule = "karras";

/** 사용자에게 보여 줄 수 있는 오류 (도구 결과에 그대로 실음) */
export class UserFacingError extends Error {}

function pickLast<T>(presets: Preset[], get: (p: Preset) => T | undefined): T | undefined {
  for (let i = presets.length - 1; i >= 0; i--) {
    const v = get(presets[i]!);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/** 저장 폴더에 못 쓰면(권한·디스크) 임시 폴더에라도 저장한다. 돈 내고 받은 그림을 버리지 않으려고 */
async function saveImage(dirs: string[], base: string, png: Buffer, notes: string[]): Promise<string> {
  let lastError: unknown;
  for (const [i, dir] of dirs.entries()) {
    try {
      const file = await writeNewFile(dir, base, ".png", png);
      if (i > 0) notes.push(`저장 폴더에 쓰지 못해 임시 폴더에 저장했습니다: ${file} (저장 폴더 설정을 확인해 주세요)`);
      return file;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export async function runGenerate(args: GenerateArgs, ctx: GenerateContext): Promise<GenerateOutcome> {
  const { config, client, guard } = ctx;
  if (!client.hasToken) {
    throw new UserFacingError(
      "NovelAI 토큰이 아직 설정되어 있지 않습니다. NovelAI 사이트 → User Settings → Account → Get Persistent API Token에서 pst-로 시작하는 토큰을 발급해 확장 프로그램 설정에 입력해 주세요. 채팅창에는 붙여넣지 마세요.",
    );
  }

  // 1. 프리셋 불러오기 (적힌 순서대로)
  const presetNames = args.presets ?? [];
  const loaded: Preset[] = [];
  for (const name of presetNames) {
    const p = await ctx.presets.get(name);
    if (!p) {
      const all = (await ctx.presets.list()).map((x) => x.name);
      throw new UserFacingError(
        `"${name}" 프리셋이 없습니다. ${all.length ? `저장된 프리셋: ${all.join(", ")}` : "저장된 프리셋이 아직 없습니다."}`,
      );
    }
    loaded.push(p);
  }

  // 2. 값 정하기: 직접 준 값 > 뒤쪽 프리셋 > 앞쪽 프리셋 > 기본값
  const modelName = args.model ?? pickLast(loaded, (p) => p.model);
  const model = modelName ? resolveModel(modelName) : config.defaultModel;
  if (!model) {
    throw new UserFacingError(`알 수 없는 모델입니다: "${modelName}". 사용할 수 있는 모델: ${MODELS.map((m) => m.key).join(", ")}`);
  }
  let size: Size;
  try {
    size = parseSize(args.size ?? pickLast(loaded, (p) => p.size) ?? "portrait");
  } catch (e) {
    throw new UserFacingError((e as Error).message);
  }
  const steps = args.steps ?? pickLast(loaded, (p) => p.steps) ?? DEFAULT_STEPS;
  const scale = args.scale ?? pickLast(loaded, (p) => p.scale) ?? DEFAULT_SCALE;
  const samplerRaw = args.sampler ?? pickLast(loaded, (p) => p.sampler) ?? DEFAULT_SAMPLER;
  if (!(SAMPLERS as readonly string[]).includes(samplerRaw)) {
    throw new UserFacingError(`사용할 수 없는 샘플러입니다: "${samplerRaw}". 사용할 수 있는 샘플러: ${SAMPLERS.join(", ")}`);
  }
  const sampler = samplerRaw as Sampler;
  const count = args.count ?? 1;
  if (count > config.maxCount) {
    throw new UserFacingError(`한 번에 ${config.maxCount}장까지만 생성할 수 있습니다 (설정: 한 번에 뽑는 최대 장 수).`);
  }

  const userPrompt = joinTags(...loaded.map((p) => p.prompt), args.prompt);
  const userNegative = joinTags(args.negative, ...loaded.map((p) => p.negative));
  const rawChars: PresetCharacter[] = [...loaded.flatMap((p) => p.characters ?? []), ...(args.characters ?? [])];
  if (rawChars.length > model.maxCharacters) {
    throw new UserFacingError(`${model.label}에서는 캐릭터를 ${model.maxCharacters}명까지만 따로 지정할 수 있습니다.`);
  }
  const characters: CharacterInput[] = rawChars.map((c) => {
    const center = parsePosition(c.position);
    if (c.position !== undefined && !center) {
      throw new UserFacingError(`알 수 없는 캐릭터 위치입니다: "${String(c.position)}". A1~E5 칸 이름이나 {x, y}(0~1) 형식으로 지정해 주세요.`);
    }
    return { prompt: composeCharacterText(c.prompt), negative: composeCharacterText(c.negative), center };
  });

  const quality = args.quality ?? "standard";
  const ucPreset = args.uc_preset ?? "heavy";
  const composed = composePrompt(model, userPrompt, quality);
  const negative = composeNegative(model, userNegative, composed.text, ucPreset, config.nsfwGuard);
  if (!composed.text.trim()) throw new UserFacingError("프롬프트가 비어 있습니다.");

  const notes: string[] = [];
  if (model.family !== "v5" && characters.some((c) => c.center)) {
    notes.push("V4.5는 캐릭터 위치를 5x5 칸(A1~E5)의 중심에 맞춰 보냈습니다.");
  }
  if (model.family === "v5" && characters.length === 1 && characters[0]!.center) {
    notes.push("V5는 캐릭터가 1명이면 위치를 무시하고 가운데에 두는 경향이 있습니다 (NovelAI 쪽 동작).");
  }

  // 3. 계정 상태 → 비용 판단
  let account: AccountState | null = null;
  let anlasBefore: number | null = null;
  try {
    const sub = await client.getSubscription();
    account = accountStateOf(sub);
    anlasBefore = anlasOf(sub);
  } catch (e) {
    if (e instanceof NaiApiError && (e.kind === "unauthorized" || e.kind === "no_token")) throw e;
    notes.push("계정 정보를 읽지 못해 비용을 유료 기준으로 계산했습니다.");
  }
  const rawEstimate = estimateCost(model, size.width, size.height, steps, count, account);

  // 확인 번호는 "실제로 보낼 요청"에 묶는다 (프리셋이 중간에 바뀌거나 기본값을 명시해도 정확하게)
  const resolvedRequest = {
    model: model.id,
    width: size.width,
    height: size.height,
    steps,
    scale,
    sampler,
    count,
    seed: args.seed ?? null,
    prompt: composed.text,
    negative: negative.text,
    characters,
    qt: composed.tagHintQt,
    uc: negative.tagHintUc,
    varietyPlus: !!args.variety_plus,
  };
  const summary = `${model.label}, ${size.width}x${size.height}, ${steps}스텝, ${count}장`;
  const decision = guard.check(hashRequest(resolvedRequest), rawEstimate, args.confirm_id, anlasBefore, summary);
  if (decision.action === "blocked") return { status: "blocked", message: decision.message, estimate: rawEstimate };
  if (decision.action === "confirm") {
    return {
      status: "needs_confirmation",
      confirmId: decision.confirmId,
      message: decision.message,
      estimate: decision.estimate,
      model,
    };
  }
  const estimate = decision.estimate;

  // 4. 한 장씩 생성. 무슨 일이 있어도 아래 5번(잔액 확인·기록)까지는 간다
  const images: GeneratedImage[] = [];
  let failure: NaiApiError | undefined;
  const baseSeed = args.seed;
  const { date } = localDateParts();
  const saveDirs = [path.join(config.outputDir, date), path.join(os.tmpdir(), "nai-vibe-fallback", date)];

  try {
    for (let i = 0; i < count; i++) {
      const seed = baseSeed !== undefined ? (baseSeed + i) % 4_294_967_296 : randomInt(0, 4_294_967_295);
      const body = buildGenerateBody({
        model,
        prompt: composed.text,
        negative: negative.text,
        width: size.width,
        height: size.height,
        steps,
        scale,
        sampler,
        noiseSchedule: NOISE,
        cfgRescale: 0,
        seed,
        varietyPlus: !!args.variety_plus,
        characters,
        tagHintQt: composed.tagHintQt,
        tagHintUc: negative.tagHintUc,
      });
      let pngs: Buffer[];
      try {
        pngs = await client.generate(body);
      } catch (e) {
        if (e instanceof NaiApiError) {
          failure = e;
          break;
        }
        throw e;
      }
      const png = pngs[0]!;
      const { time } = localDateParts();
      const file = await saveImage(saveDirs, `nai_${time}_${seed}`, png, notes);
      let preview: Preview | undefined;
      try {
        preview = makePreview(png);
      } catch {
        notes.push(`${path.basename(file)} 미리보기를 만들지 못했습니다 (원본은 저장되었습니다).`);
      }
      images.push({ path: file, seed, width: size.width, height: size.height, preview });
      await ctx.history
        .addImage({
          id: `${date}-${time}-${seed}`,
          time: new Date().toISOString(),
          file,
          model: model.key,
          prompt: userPrompt,
          negative: userNegative,
          finalPrompt: composed.text,
          finalNegative: negative.text,
          presets: presetNames,
          width: size.width,
          height: size.height,
          steps,
          scale,
          sampler,
          seed,
          quality: composed.qualityApplied,
          ucPreset: negative.ucApplied,
          varietyPlus: !!args.variety_plus,
          characters,
          estimatedAnlas: estimate.free ? 0 : estimate.perImage,
        })
        .catch(() => notes.push("생성 기록을 저장하지 못했습니다."));
    }
  } catch (e) {
    // 그림을 받은 뒤 저장 등에서 터진 경우: 과금됐을 수 있다
    failure =
      e instanceof NaiApiError
        ? e
        : new NaiApiError(
            "bad_response",
            `그림을 받은 뒤 처리하는 중 오류가 발생했습니다: ${(e as Error)?.message ?? String(e)}`,
            undefined,
            undefined,
            true,
          );
  }

  // 5. 실제로 쓴 Anlas 확인
  let anlasAfter: number | null = null;
  if (images.length > 0 || failure?.maybeCharged || estimate.total > 0) {
    try {
      anlasAfter = anlasOf(await client.getSubscription());
    } catch {
      /* 못 읽으면 예상치로 기록 */
    }
  }
  const spent = anlasBefore !== null && anlasAfter !== null ? anlasBefore - anlasAfter : null;
  const expected = estimate.free ? 0 : estimate.perImage * images.length;
  if (spent !== null) {
    // 잔액 차이를 알면 그게 진짜. 무료 예상(expected 0)인데 빠졌으면 가드가 이후 무료 예상도 확인받게 바뀐다
    guard.record(spent, estimate.free);
  } else {
    // 잔액을 못 읽었으면 예상치로. 실패한 요청도 과금됐을 수 있으면 한 장 더 친다
    guard.record(estimate.free ? 0 : estimate.perImage * (images.length + (failure?.maybeCharged ? 1 : 0)));
  }
  await ctx.history
    .addLedger({
      time: new Date().toISOString(),
      model: model.key,
      width: size.width,
      height: size.height,
      steps,
      count,
      generated: images.length,
      estimated: expected,
      anlasBefore,
      anlasAfter,
      actual: spent,
      opus: account?.opus ?? null,
      note: failure ? `${failure.kind}${failure.status ? ` ${failure.status}` : ""}` : undefined,
    })
    .catch(() => undefined);

  if (failure?.maybeCharged && spent !== null && spent > expected) {
    notes.push(`실패한 요청에서도 Anlas가 차감되었습니다 (이번 요청에서 총 ${spent} 차감).`);
  } else if (!failure && spent !== null && spent !== expected) {
    notes.push(`예상(${expected})과 실제 차감(${spent})이 다릅니다. 비용 공식 보정을 위해 기록해 두었습니다.`);
  }

  return {
    status: "done",
    images,
    model,
    estimate,
    anlasBefore,
    anlasAfter,
    spent,
    error: failure,
    finalPrompt: composed.text,
    finalNegative: negative.text,
    notes,
  };
}
