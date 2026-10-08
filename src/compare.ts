// 비교 시트: 같은 시드·같은 프롬프트에 칸마다 다른 태그(주로 아티스트·화풍 조합)만 바꿔 뽑고,
// 번호 붙은 한 장짜리 시트로 보여 준다. 비용은 시트 전체를 한 번에 확인받는다.

import os from "node:os";
import path from "node:path";
import type { NaiApiError } from "./api/client.js";
import { type CostEstimate, estimateCost } from "./cost/cost.js";
import { hashRequest } from "./cost/guard.js";
import {
  type CommonArgs,
  type GenerateContext,
  type GeneratedImage,
  type Job,
  UserFacingError,
  composeFor,
  randomSeed,
  readAccount,
  requestShape,
  requireToken,
  resolveCommon,
  runJobs,
  settle,
} from "./generate.js";
import type { ModelInfo } from "./models.js";
import { joinTags } from "./prompt/syntax.js";
import { type SheetImage, makeContactSheet } from "./sheet.js";
import { localDateParts, writeFileAtomic } from "./store/files.js";
import type { SheetRecord, SheetVariant } from "./store/sheets.js";

export const MIN_VARIANTS = 2;
export const MAX_VARIANTS = 12;

/** 공통 프롬프트를 안 주면 쓰는 무난한 장면 (화풍 차이가 잘 보이게 얼굴·머리·배경이 다 들어가는 구도) */
export const DEFAULT_COMPARE_PROMPT =
  "1girl, solo, upper body, looking at viewer, smile, long hair, white shirt, outdoors, flowers, blue sky";

export interface CompareVariant {
  prompt: string;
  label?: string;
}

export interface CompareArgs extends CommonArgs {
  variants: CompareVariant[];
  /** 모든 칸에 공통으로 들어갈 장면 태그 */
  prompt?: string;
  seed?: number;
  confirm_id?: string;
}

export type CompareOutcome =
  | {
      status: "done";
      sheetId: string;
      dir: string;
      sheetFile?: string;
      sheet?: SheetImage;
      seed: number;
      model: ModelInfo;
      width: number;
      height: number;
      steps: number;
      basePrompt: string;
      variants: Array<SheetVariant & { image?: GeneratedImage }>;
      estimate: CostEstimate;
      anlasAfter: number | null;
      spent: number | null;
      error?: NaiApiError;
      notes: string[];
    }
  | { status: "needs_confirmation"; confirmId: string; message: string; estimate: CostEstimate; model: ModelInfo }
  | { status: "blocked"; message: string; estimate?: CostEstimate };

export async function runCompare(args: CompareArgs, ctx: GenerateContext): Promise<CompareOutcome> {
  const { config, client, guard } = ctx;
  requireToken(client);

  const variants = args.variants.map((v, i) => ({
    n: i + 1,
    prompt: v.prompt.trim(),
    label: (v.label ?? "").trim() || v.prompt.trim(),
  }));
  if (variants.length < MIN_VARIANTS || variants.length > MAX_VARIANTS) {
    throw new UserFacingError(`비교 시트는 ${MIN_VARIANTS}~${MAX_VARIANTS}칸까지 만들 수 있습니다 (지금 ${variants.length}칸).`);
  }
  const empty = variants.find((v) => !v.prompt);
  if (empty) throw new UserFacingError(`${empty.n}번 칸의 태그(prompt)가 비어 있습니다.`);

  const notes: string[] = [];
  // 계정을 먼저 본다: 크기를 안 정했으면 Opus + V4.5(무료)는 보통 크기, 그 밖엔 비용을 줄이려고 작은 크기
  const { account, anlasBefore } = await readAccount(client, notes);
  const r = await resolveCommon(args, ctx, notes, (m) => (account?.opus && m.opusUnlimited ? "portrait" : "small_portrait"));

  const basePrompt = args.prompt?.trim() ? args.prompt.trim() : DEFAULT_COMPARE_PROMPT;
  // 칸 태그(아티스트)를 맨 앞에: NovelAI에선 앞쪽 태그가 더 세게 먹는다
  const composed = variants.map((v) => composeFor(r, joinTags(v.prompt, r.presetPrompt, basePrompt), config.nsfwGuard));

  const rawEstimate = estimateCost(r.model, r.size.width, r.size.height, r.steps, variants.length, account);
  const shape = requestShape(r, {
    kind: "compare",
    seed: args.seed ?? null,
    prompts: composed.map((c) => c.prompt.text),
    negatives: composed.map((c) => c.negative.text),
    qt: composed.map((c) => c.prompt.tagHintQt),
    uc: composed.map((c) => c.negative.tagHintUc),
  });
  const summary = `비교 시트 ${variants.length}칸 — ${r.model.label}, ${r.size.width}x${r.size.height}, ${r.steps}스텝`;
  const decision = guard.check(hashRequest(shape), rawEstimate, args.confirm_id, anlasBefore, summary);
  if (decision.action === "blocked") return { status: "blocked", message: decision.message, estimate: rawEstimate };
  if (decision.action === "confirm") {
    return { status: "needs_confirmation", confirmId: decision.confirmId, message: decision.message, estimate: decision.estimate, model: r.model };
  }
  const estimate = decision.estimate;

  // 모든 칸이 같은 시드 (그래야 태그 차이만 보인다)
  const seed = args.seed ?? randomSeed();
  const { date, time } = localDateParts();
  const sheetId = `${date}_${time}`;
  const folder = `compare_${time}`;
  const saveDirs = [path.join(config.outputDir, date, folder), path.join(os.tmpdir(), "nai-vibe-fallback", date, folder)];
  const jobs: Job[] = composed.map((c, i) => ({
    composed: c,
    seed,
    saveDirs,
    fileBase: `${String(i + 1).padStart(2, "0")}_${seed}`,
  }));
  const { done, failure } = await runJobs(jobs, r, ctx, estimate, notes);
  const { anlasAfter, spent } = await settle(ctx, r, account, anlasBefore, estimate, variants.length, done.length, failure, notes);

  const byIndex = new Map(done.map((d) => [d.index, d]));
  const outVariants = variants.map((v, i) => {
    const d = byIndex.get(i);
    return { ...v, file: d?.image.path, image: d?.image };
  });

  // 시트 이미지 + 번호 대응표. 실패해도 그림은 이미 저장돼 있으니 알림만
  let sheet: SheetImage | undefined;
  let sheetFile: string | undefined;
  const dir = done.length > 0 ? path.dirname(done[0]!.image.path) : saveDirs[0]!;
  if (done.length > 0) {
    try {
      sheet = makeContactSheet(done.map((d) => ({ png: d.png, number: d.index + 1 })));
      sheetFile = path.join(dir, "sheet.jpg");
      await writeFileAtomic(sheetFile, sheet.data);
      const legend = [
        `비교 시트 ${sheetId} — ${r.model.label}, ${r.size.width}x${r.size.height}, ${r.steps}스텝, 시드 ${seed}`,
        `공통 프롬프트: ${joinTags(r.presetPrompt, basePrompt)}`,
        "",
        ...outVariants.map((v) => `${v.n}. ${v.prompt}${v.label !== v.prompt ? `  (${v.label})` : ""}${v.file ? "" : "  — 생성 안 됨"}`),
        "",
      ].join("\r\n");
      await writeFileAtomic(path.join(dir, "sheet.txt"), legend);
    } catch (e) {
      notes.push(`비교 시트 이미지를 만들지 못했습니다 (개별 그림은 저장되었습니다): ${(e as Error)?.message ?? String(e)}`);
      sheet = undefined;
    }
  }

  const record: SheetRecord = {
    id: sheetId,
    time: new Date().toISOString(),
    dir,
    sheetFile,
    model: r.model.key,
    width: r.size.width,
    height: r.size.height,
    steps: r.steps,
    seed,
    basePrompt,
    presets: r.presetNames,
    variants: outVariants.map(({ n, label, prompt, file }) => ({ n, label, prompt, file })),
  };
  await ctx.sheets.add(record).catch(() => notes.push("비교 시트 기록을 저장하지 못했습니다."));

  return {
    status: "done",
    sheetId,
    dir,
    sheetFile,
    sheet,
    seed,
    model: r.model,
    width: r.size.width,
    height: r.size.height,
    steps: r.steps,
    basePrompt,
    variants: outVariants,
    estimate,
    anlasAfter,
    spent,
    error: failure,
    notes,
  };
}
