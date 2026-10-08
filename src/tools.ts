// MCP 도구 등록. 도구 설명은 짧게, 결과는 사람이 읽을 글 + structuredContent 둘 다.

import os from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { NaiApiError, anlasOf } from "./api/client.js";
import { SAMPLERS } from "./api/request.js";
import { accountStateOf, costPerImage } from "./cost/cost.js";
import { DEFAULT_STEPS, type GenerateContext, UserFacingError, runGenerate } from "./generate.js";
import { MODELS, resolveModel } from "./models.js";
import { SIZE_PRESETS, parseSize } from "./sizes.js";
import { dataDir } from "./store/files.js";
import { PRESET_KINDS } from "./store/presets.js";
import type { UpdateChecker } from "./update.js";
import { GITHUB_REPO, VERSION } from "./version.js";

export interface ToolContext extends GenerateContext {
  updates: UpdateChecker;
}

const positionSchema = z
  .union([
    z.string().describe("칸 이름 A1~E5 (A~E 왼→오른쪽, 1~5 위→아래, C3 = 가운데)"),
    z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  ])
  .describe("캐릭터 위치. 안 주면 AI가 정함");

const characterSchema = z.object({
  prompt: z.string().min(1).describe("이 캐릭터만의 태그 (예: 1girl, silver hair, red eyes, maid)"),
  negative: z.string().optional().describe("이 캐릭터에서 빼고 싶은 태그"),
  position: positionSchema.optional(),
});

function text(t: string): CallToolResult["content"][number] {
  return { type: "text", text: t };
}

function errorResult(e: unknown, ctx: ToolContext): CallToolResult {
  let msg: string;
  if (e instanceof UserFacingError) msg = e.message;
  else if (e instanceof NaiApiError) {
    msg = e.message;
    if (e.detail) msg += `\n서버 메시지: ${e.detail}`;
    if (e.maybeCharged) msg += "\n⚠️ 요청이 NovelAI에 전달되었을 수 있어 Anlas가 차감되었을 수도 있습니다. nai_account로 잔액을 확인해 주세요.";
  } else msg = `예상하지 못한 오류: ${(e as Error)?.message ?? String(e)}`;
  const notice = ctx.updates.notice();
  return { isError: true, content: [text(notice ? `${msg}\n\n${notice}` : msg)] };
}

function withNotice(lines: string[], ctx: ToolContext): string {
  const n = ctx.updates.notice();
  return n ? [...lines, "", n].join("\n") : lines.join("\n");
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  const { config } = ctx;

  // ───────────────────────── nai_generate
  server.registerTool(
    "nai_generate",
    {
      title: "NovelAI 그림 생성",
      description: [
        "NovelAI로 그림을 뽑아서 사용자 PC에 저장하고 작은 미리보기를 돌려준다.",
        "prompt는 영어 Danbooru 태그(쉼표 구분)로 쓴다. 가중치는 NovelAI 문법 `1.2::tag::`, `{tag}`(강조), `[tag]`(약화). 아티스트는 `artist:이름`. 품질 태그·기본 네거티브는 자동으로 붙으니 넣지 않는다.",
        "V5 모델은 따옴표 안 글자를 그림에 글씨로 그린다.",
        `여러 장은 한 장씩 순서대로 뽑는다 (최대 ${config.maxCount}장).`,
        "돈(Anlas)이 드는 요청이면 그림 대신 예상 비용과 confirm_id가 돌아온다. 그때는 사용자에게 비용을 보여 주고 동의를 받은 뒤에만 같은 인자 + confirm_id로 다시 호출한다. 사용자 동의 없이 confirm_id를 쓰지 않는다.",
      ].join("\n"),
      inputSchema: {
        prompt: z.string().min(1).describe("영어 Danbooru 태그. 예: 1girl, solo, silver hair, maid, cafe, smile"),
        negative: z.string().optional().describe("추가로 빼고 싶은 태그 (기본 네거티브는 자동)"),
        model: z
          .string()
          .optional()
          .describe(`모델: ${MODELS.map((m) => m.key).join(", ")} (기본 ${config.defaultModel.key})`),
        size: z
          .string()
          .optional()
          .describe(`크기 이름(${Object.keys(SIZE_PRESETS).join(", ")}) 또는 832x1216 같은 형식. 기본 portrait`),
        steps: z.number().int().min(1).max(50).optional().describe(`기본 ${DEFAULT_STEPS}. Opus 무료는 28 이하`),
        scale: z.number().min(0).max(10).optional().describe("프롬프트를 따르는 정도 (기본 5)"),
        sampler: z.enum(SAMPLERS).optional(),
        seed: z.number().int().min(0).max(4_294_967_295).optional().describe("같은 그림을 다시 뽑을 때. 여러 장이면 seed, seed+1, …"),
        count: z.number().int().min(1).max(8).optional().describe("몇 장 (기본 1)"),
        characters: z
          .array(characterSchema)
          .optional()
          .describe("캐릭터별 태그·위치 (여러 명을 따로 묘사할 때). 공통 태그는 prompt에"),
        presets: z.array(z.string()).optional().describe("nai_preset으로 저장한 프리셋 이름들. 적은 순서대로 프롬프트 앞에 붙음"),
        quality: z.enum(["standard", "light", "off"]).optional().describe("품질 태그 (light는 V5만)"),
        uc_preset: z.enum(["heavy", "light", "human_focus", "furry_focus", "none"]).optional().describe("기본 네거티브 묶음 (기본 heavy)"),
        variety_plus: z.boolean().optional().describe("구도를 더 다양하게 (NovelAI Variety+)"),
        confirm_id: z.string().optional().describe("비용 확인 뒤 사용자가 동의했을 때만 넣는 번호"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      ctx.updates.poke();
      try {
        const r = await ctx.serial.run(() => runGenerate(args, ctx));
        // 어떤 앱은 structuredContent만 보여 줘서, 사람이 읽을 글을 message에도 같이 넣는다
        if (r.status === "blocked") {
          const msg = withNotice([`⛔ 생성하지 않았습니다. ${r.message}`], ctx);
          return { content: [text(msg)], structuredContent: { status: "blocked", message: msg } };
        }
        if (r.status === "needs_confirmation") {
          const msg = withNotice([r.message, `confirm_id: ${r.confirmId}`], ctx);
          return {
            content: [text(msg)],
            structuredContent: {
              status: "needs_confirmation",
              message: msg,
              confirm_id: r.confirmId,
              estimated_anlas: r.estimate.total,
              per_image: r.estimate.perImage,
              count: r.estimate.count,
              reason: r.estimate.reason,
            },
          };
        }
        const lines: string[] = [];
        if (r.images.length === 0 && r.error) {
          lines.push(`❌ 생성 실패: ${r.error.message}${r.error.detail ? `\n서버 메시지: ${r.error.detail}` : ""}`);
          if (r.error.maybeCharged) {
            lines.push("⚠️ 요청이 NovelAI에 전달되었을 수 있어 Anlas가 차감되었을 수도 있습니다.");
          }
          if (r.spent !== null) lines.push(`잔액 확인: ${r.spent} 차감 → 잔액 ${r.anlasAfter}`);
          lines.push(...r.notes);
          const msg = withNotice(lines, ctx);
          return {
            isError: true,
            content: [text(msg)],
            structuredContent: { status: "failed", message: msg, error: r.error.kind, anlas_spent: r.spent, anlas_left: r.anlasAfter },
          };
        }
        lines.push(`✅ ${r.images.length}장 생성 (${r.model.label})`);
        r.images.forEach((im, i) => lines.push(`${i + 1}. ${im.path}  (seed ${im.seed}, ${im.width}x${im.height})`));
        if (r.spent !== null) lines.push(`Anlas: ${r.spent} 사용 → 잔액 ${r.anlasAfter}`);
        else lines.push(r.estimate.free ? "Anlas: 무료 조건" : `Anlas: 약 ${r.estimate.perImage * r.images.length} 사용 (잔액 확인 실패)`);
        if (r.error) {
          lines.push(`⚠️ ${r.images.length + 1}번째 장에서 중단되었습니다: ${r.error.message}${r.error.detail ? ` (${r.error.detail})` : ""}`);
        }
        lines.push(...r.notes);
        const msg = withNotice(lines, ctx);
        const content: CallToolResult["content"] = [text(msg)];
        for (const im of r.images) {
          if (im.preview) content.push({ type: "image", data: im.preview.data.toString("base64"), mimeType: im.preview.mimeType });
        }
        return {
          content,
          structuredContent: {
            status: r.error ? "partial" : "done",
            message: msg,
            model: r.model.key,
            images: r.images.map((im) => ({ path: im.path, seed: im.seed, width: im.width, height: im.height })),
            anlas_spent: r.spent,
            anlas_left: r.anlasAfter,
            final_prompt: r.finalPrompt,
            final_negative: r.finalNegative,
          },
          isError: r.images.length === 0 && !!r.error,
        };
      } catch (e) {
        return errorResult(e, ctx);
      }
    },
  );

  // ───────────────────────── nai_account
  server.registerTool(
    "nai_account",
    {
      title: "NovelAI 계정·잔액",
      description:
        "NovelAI 연결 확인. 구독 등급, Anlas 잔액, Opus V5 무료 할당량, 지금 비용 설정, 자주 쓰는 크기의 예상 비용을 보여 준다. 설치 직후 '연결 확인해 줘'에 쓴다.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      ctx.updates.poke();
      try {
        if (!ctx.client.hasToken) throw new UserFacingError(
          "NovelAI 토큰이 아직 설정되어 있지 않습니다. NovelAI 사이트 → User Settings → Account → Get Persistent API Token에서 pst-로 시작하는 토큰을 발급해 확장 프로그램 설정에 입력해 주세요. 채팅창에는 붙여넣지 마세요.",
        );
        const sub = await ctx.client.getSubscription();
        const a = accountStateOf(sub);
        const m = config.defaultModel;
        const lines = [
          "✅ NovelAI 연결됨",
          `구독: ${a.tierName}${a.active ? "" : " (활성 구독 없음)"}${a.opus ? " — Opus 무료 생성 가능" : ""}`,
          `Anlas: ${anlasOf(sub)}`,
        ];
        if (a.v5Allowance) {
          const v = a.v5Allowance;
          lines.push(
            `V5 무료 할당량: ${v.percent}% (약 ${v.approxImages}장)${v.empty ? " — 비어 있음, V5는 지금 유료" : ""}, 하루 약 ${v.refillPercentPerDay}% 회복`,
          );
        }
        lines.push(
          `기본 모델: ${m.label} / 비용 모드: ${ctx.guard.mode}${ctx.guard.mode === "allow" ? ` (요청당 ${ctx.guard.allowMax}까지 자동)` : ""}`,
          `이번 세션에 쓴 Anlas: 약 ${ctx.guard.sessionSpent}${ctx.guard.sessionLimit > 0 ? ` / 상한 ${ctx.guard.sessionLimit}` : ""}`,
          `저장 폴더: ${config.outputDir}`,
          "",
          "유료일 때 장당 예상 Anlas (V4.5 / V5):",
          ...[
            ["세로 832x1216", 832, 1216, DEFAULT_STEPS],
            ["세로 832x1216", 832, 1216, 28],
            ["작은 세로 512x768", 512, 768, DEFAULT_STEPS],
            ["큰 세로 1024x1536", 1024, 1536, 28],
          ].map(([label, w, h, s]) => {
            const v45 = costPerImage(resolveModel("v4.5-full")!, w as number, h as number, s as number);
            const v5 = costPerImage(resolveModel("v5-full")!, w as number, h as number, s as number);
            return `- ${label} · ${s}스텝: ${v45} / ${v5}`;
          }),
          "(비공식 추정치입니다. 실제 차감은 생성할 때마다 잔액 차이로 확인합니다.)",
        );
        const msg = withNotice(lines, ctx);
        return {
          content: [text(msg)],
          structuredContent: {
            message: msg,
            tier: a.tierName,
            active: a.active,
            opus: a.opus,
            anlas: anlasOf(sub),
            v5_allowance: a.v5Allowance,
            cost_mode: ctx.guard.mode,
            session_spent: ctx.guard.sessionSpent,
            session_limit: ctx.guard.sessionLimit,
            output_dir: config.outputDir,
          },
        };
      } catch (e) {
        return errorResult(e, ctx);
      }
    },
  );

  // ───────────────────────── nai_preset
  server.registerTool(
    "nai_preset",
    {
      title: "NovelAI 프리셋",
      description: [
        "자주 쓰는 태그 묶음을 이름으로 저장·조회·삭제한다 (화풍/아티스트, 캐릭터, 의상, 장면, 크기 등).",
        "저장한 프리셋은 nai_generate의 presets에 이름으로 넣어 쓴다. 프리셋의 prompt는 영어 태그로 저장한다.",
        "action: list(목록) | get(하나 보기) | save(저장·덮어쓰기) | delete(삭제)",
      ].join("\n"),
      inputSchema: {
        action: z.enum(["list", "get", "save", "delete"]),
        name: z.string().optional().describe("프리셋 이름 (한국어 가능). list 말고는 필수"),
        kind: z.enum(PRESET_KINDS).optional().describe("save할 때 종류 (기본 other)"),
        prompt: z.string().optional().describe("프롬프트 앞에 붙일 영어 태그"),
        negative: z.string().optional().describe("네거티브에 더할 태그"),
        model: z.string().optional(),
        size: z.string().optional(),
        steps: z.number().int().min(1).max(50).optional(),
        scale: z.number().min(0).max(10).optional(),
        sampler: z.enum(SAMPLERS).optional(),
        characters: z.array(characterSchema).optional(),
        note: z.string().optional().describe("메모 (사람이 읽는 설명)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        if (args.action === "list") {
          const all = await ctx.presets.list();
          if (all.length === 0) {
            return { content: [text("저장된 프리셋이 아직 없습니다.")], structuredContent: { presets: [] } };
          }
          const lines = all.map(
            (p) => `- [${p.kind}] ${p.name}${p.prompt ? `: ${p.prompt.slice(0, 80)}${p.prompt.length > 80 ? "…" : ""}` : ""}${p.note ? ` (${p.note})` : ""}`,
          );
          return {
            content: [text(lines.join("\n"))],
            structuredContent: { message: lines.join("\n"), presets: all.map((p) => ({ name: p.name, kind: p.kind })) },
          };
        }
        if (!args.name) throw new UserFacingError("프리셋 이름(name)을 지정해 주세요.");
        if (args.action === "get") {
          const p = await ctx.presets.get(args.name);
          if (!p) throw new UserFacingError(`"${args.name}" 프리셋이 없습니다.`);
          return { content: [text(JSON.stringify(p, null, 2))], structuredContent: { preset: p } };
        }
        if (args.action === "delete") {
          const ok = await ctx.presets.delete(args.name);
          return { content: [text(ok ? `"${args.name}" 프리셋을 삭제했습니다.` : `"${args.name}" 프리셋이 없습니다.`)] };
        }
        // save
        if (args.model && !resolveModel(args.model)) {
          throw new UserFacingError(`알 수 없는 모델입니다: "${args.model}". 사용할 수 있는 모델: ${MODELS.map((m) => m.key).join(", ")}`);
        }
        if (args.size) {
          try {
            parseSize(args.size);
          } catch (e) {
            throw new UserFacingError((e as Error).message);
          }
        }
        const hasContent = [args.prompt, args.negative, args.model, args.size, args.steps, args.scale, args.sampler, args.characters].some(
          (v) => v !== undefined && v !== "",
        );
        if (!hasContent) throw new UserFacingError("저장할 내용이 없습니다. prompt나 size 같은 값을 하나 이상 지정해 주세요.");
        const r = await ctx.presets.save(args.name, {
          kind: args.kind ?? "other",
          prompt: args.prompt,
          negative: args.negative,
          model: args.model,
          size: args.size,
          steps: args.steps,
          scale: args.scale,
          sampler: args.sampler,
          characters: args.characters,
          note: args.note,
        });
        const saved = `"${r.name}" 프리셋을 ${r.created ? "저장했습니다" : "덮어썼습니다"}.`;
        return { content: [text(saved)], structuredContent: { message: saved, name: r.name, created: r.created } };
      } catch (e) {
        return errorResult(e, ctx);
      }
    },
  );

  // ───────────────────────── nai_about
  server.registerTool(
    "nai_about",
    {
      title: "nai-vibe-mcp 정보·진단",
      description: "버전, 설정 요약, 업데이트 확인, 문제 신고용 진단 정보(토큰 제외)를 보여 준다.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      await ctx.updates.check(true);
      const lines = [
        `nai-vibe-mcp v${VERSION} (비공식 도구 — NovelAI/Anlatan과 관계없음)`,
        ctx.updates.notice() ?? (ctx.updates.latest ? "최신 버전입니다." : GITHUB_REPO ? "업데이트 확인 실패 또는 꺼짐" : "업데이트 확인: 아직 배포 전"),
        "",
        "진단 정보 (문제를 신고할 때 그대로 붙여 넣어 주세요):",
        "```",
        `version: ${VERSION}`,
        `node: ${process.version} / ${os.platform()} ${os.arch()}`,
        `token: ${config.token ? "설정됨" : "없음"}`,
        `default_model: ${config.defaultModel.key}`,
        `cost_mode: ${config.costMode}, allow_max: ${config.allowMax}, session_limit: ${config.sessionLimit}, max_count: ${config.maxCount}`,
        `session_spent: ${ctx.guard.sessionSpent}`,
        `nsfw_guard: ${config.nsfwGuard}`,
        `update_check: ${config.updateCheck}`,
        `api_base: ${config.apiBase === "https://image.novelai.net" ? "기본" : "변경됨"}`,
        ...(config.warnings.length ? [`warnings: ${config.warnings.join(" / ")}`] : []),
        "```",
        `저장 폴더: ${config.outputDir}`,
        `프리셋·기록: ${dataDir(config.outputDir)}`,
      ];
      return { content: [text(lines.join("\n"))] };
    },
  );
}
