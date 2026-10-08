// MCP 클라이언트 → 우리 서버 → 가짜 NovelAI 서버까지 끝에서 끝까지.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { costPerImage } from "../src/cost/cost.js";
import { resolveModel } from "../src/models.js";
import { createServer } from "../src/server.js";
import { TEST_TOKEN, startFakeNai } from "./fake-nai.js";

type Fake = Awaited<ReturnType<typeof startFakeNai>>;

let fake: Fake;
let outDir: string;

const chargeByFormula = (body: any) =>
  costPerImage(resolveModel(body.model)!, body.parameters.width, body.parameters.height, body.parameters.steps);

async function connect(env: Record<string, string> = {}) {
  const config = loadConfig({
    NAI_TOKEN: TEST_TOKEN,
    NAI_OUTPUT_DIR: outDir,
    NAI_API_BASE: fake.url,
    NAI_UPDATE_CHECK: "false",
    ...env,
  });
  const { server, ctx } = createServer(config, { retryDelaysMs: [10, 10] });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(ct);
  return { client, ctx };
}

function textOf(r: any): string {
  return r.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
}

async function allFilesText(dir: string): Promise<string> {
  let out = "";
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out += await allFilesText(p);
    else out += (await fs.readFile(p)).toString("latin1");
  }
  return out;
}

beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), "nai-vibe-test-"));
  fake = await startFakeNai({ charge: chargeByFormula });
});

afterEach(async () => {
  await fake.close();
  await fs.rm(outDir, { recursive: true, force: true });
});

describe("서버", () => {
  it("도구 4개가 보인다", async () => {
    const { client } = await connect();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["nai_about", "nai_account", "nai_generate", "nai_preset"]);
  });

  it("토큰이 없으면 친절하게 알려 준다", async () => {
    const { client } = await connect({ NAI_TOKEN: "" });
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Persistent API Token");
    expect(fake.state.requests.length).toBe(0);
  });

  it("토큰이 틀리면 401 안내", async () => {
    const { client } = await connect({ NAI_TOKEN: "pst-wrong" });
    const r: any = await client.callTool({ name: "nai_account", arguments: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("401");
  });

  it("nai_account: 잔액·등급", async () => {
    fake.state.anlas = 9876;
    const { client } = await connect();
    const r: any = await client.callTool({ name: "nai_account", arguments: {} });
    expect(textOf(r)).toContain("9876");
    expect(r.structuredContent.opus).toBe(false);
  });
});

describe("생성 + 비용 가드", () => {
  it("비구독: 먼저 확인을 받고, confirm_id로 다시 부르면 생성한다", async () => {
    fake.state.anlas = 1000;
    const { client } = await connect();
    const args = { prompt: "1girl, solo, smile", size: "portrait", steps: 23 };
    const r1: any = await client.callTool({ name: "nai_generate", arguments: args });
    expect(r1.structuredContent.status).toBe("needs_confirmation");
    expect(r1.structuredContent.estimated_anlas).toBe(17);
    expect(fake.generateBodies().length).toBe(0);

    const r2: any = await client.callTool({
      name: "nai_generate",
      arguments: { ...args, confirm_id: r1.structuredContent.confirm_id },
    });
    expect(r2.structuredContent.status).toBe("done");
    expect(r2.structuredContent.anlas_spent).toBe(17);
    expect(r2.structuredContent.anlas_left).toBe(983);
    const file = r2.structuredContent.images[0].path as string;
    expect(file.startsWith(outDir)).toBe(true);
    expect((await fs.stat(file)).size).toBeGreaterThan(50);
    expect(r2.content.some((c: any) => c.type === "image" && c.mimeType === "image/jpeg")).toBe(true);

    // 보낸 본문 확인
    const body = fake.generateBodies()[0];
    expect(body.model).toBe("nai-diffusion-4-5-full");
    expect(body.parameters.n_samples).toBe(1);
    expect(body.input).toBe("1girl, solo, smile, very aesthetic, masterpiece, no text");
    expect(body.parameters.negative_prompt.startsWith("nsfw, lowres")).toBe(true);
    // 브라우저 흉내 헤더 안 보냄
    const req = fake.state.requests.find((x) => x.path === "/ai/generate-image")!;
    expect(req.headers.origin).toBeUndefined();
    expect(req.headers.referer).toBeUndefined();

    // 같은 번호는 다시 못 쓴다
    const r3: any = await client.callTool({
      name: "nai_generate",
      arguments: { ...args, confirm_id: r1.structuredContent.confirm_id },
    });
    expect(r3.structuredContent.status).toBe("needs_confirmation");
    expect(fake.generateBodies().length).toBe(1);

    // 비용 기록
    const ledger = await fs.readFile(path.join(outDir, ".nai-vibe", "ledger.jsonl"), "utf8");
    expect(JSON.parse(ledger.trim().split("\n").pop()!)).toMatchObject({ estimated: 17, actual: 17 });
  });

  it("nsfw 가드 설정을 끄면 UC에 nsfw가 안 들어간다", async () => {
    const { client } = await connect({ NAI_NSFW_GUARD: "false", NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "100" });
    await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(fake.generateBodies()[0].parameters.negative_prompt.startsWith("lowres")).toBe(true);
  });

  it("confirm_id를 다른 요청에 쓰면 실행 안 한다", async () => {
    const { client } = await connect();
    const r1: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    const r2: any = await client.callTool({
      name: "nai_generate",
      arguments: { prompt: "1girl, extra", confirm_id: r1.structuredContent.confirm_id },
    });
    expect(r2.structuredContent.status).toBe("needs_confirmation");
    expect(fake.generateBodies().length).toBe(0);
  });

  it("Opus + V4.5 + 조건 안: 묻지 않고 바로, 무료", async () => {
    fake.state.tier = 3;
    fake.state.active = true;
    fake.state.charge = () => 0;
    const { client } = await connect();
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl", count: 3 } });
    expect(r.structuredContent.status).toBe("done");
    expect(r.structuredContent.images.length).toBe(3);
    expect(fake.state.maxConcurrent).toBe(1);
    const seeds = fake.generateBodies().map((b) => b.parameters.seed);
    expect(new Set(seeds).size).toBe(3);
  });

  it("seed를 주면 seed, seed+1…", async () => {
    fake.state.tier = 3;
    fake.state.active = true;
    const { client } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "1000" });
    await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl", count: 2, seed: 100 } });
    expect(fake.generateBodies().map((b) => b.parameters.seed)).toEqual([100, 101]);
  });

  it("free_only: 유료는 막는다", async () => {
    const { client } = await connect({ NAI_COST_MODE: "free_only" });
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(r.structuredContent.status).toBe("blocked");
    expect(fake.generateBodies().length).toBe(0);
  });

  it("allow: 상한 안이면 바로", async () => {
    const { client } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "30" });
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(r.structuredContent.status).toBe("done");
  });

  it("최대 장 수를 넘으면 거절", async () => {
    const { client } = await connect({ NAI_MAX_COUNT: "2" });
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl", count: 3 } });
    expect(r.isError).toBe(true);
    expect(fake.state.requests.length).toBe(0);
  });

  it("잔액이 모자라면 막는다", async () => {
    fake.state.anlas = 10;
    const { client } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "100" });
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(r.structuredContent.status).toBe("blocked");
    expect(textOf(r)).toContain("모자라");
  });
});

describe("오류", () => {
  it("429는 기다렸다 다시 보낸다 (과금 없음)", async () => {
    fake.state.failures = [429];
    const { client } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "100" });
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(r.structuredContent.status).toBe("done");
    expect(fake.generateBodies().length).toBe(2);
  });

  it("500은 다시 보내지 않고, 과금됐을 수 있다고 알린다", async () => {
    fake.state.failures = [500];
    fake.state.chargeOnFailure = true;
    const { client } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "100" });
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(r.isError).toBe(true);
    expect(fake.generateBodies().length).toBe(1);
    expect(textOf(r)).toContain("500");
    // 잔액 차이를 기록해 둔다
    const ledger = await fs.readFile(path.join(outDir, ".nai-vibe", "ledger.jsonl"), "utf8");
    expect(JSON.parse(ledger.trim())).toMatchObject({ generated: 0, actual: 17 });
  });

  it("여러 장 중간에 실패하면 된 것까지 돌려준다", async () => {
    fake.state.tier = 3;
    fake.state.active = true;
    fake.state.failures = [0, 400];
    const { client } = await connect();
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl", count: 3 } });
    expect(r.structuredContent.status).toBe("partial");
    expect(r.structuredContent.images.length).toBe(1);
    expect(textOf(r)).toContain("2번째에서 멈췄어");
  });

  it("토큰이 결과·저장 파일 어디에도 안 남는다", async () => {
    fake.state.failures = [500];
    const { client } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "100" });
    const r1: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    const r2: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    const r3: any = await client.callTool({ name: "nai_about", arguments: {} });
    const secret = TEST_TOKEN.slice(4);
    for (const r of [r1, r2, r3]) expect(JSON.stringify(r)).not.toContain(secret);
    expect(await allFilesText(outDir)).not.toContain(secret);
  });
});

describe("프리셋", () => {
  it("저장하고 생성에 쓴다", async () => {
    fake.state.tier = 3;
    fake.state.active = true;
    const { client } = await connect();
    const s: any = await client.callTool({
      name: "nai_preset",
      arguments: { action: "save", name: "파스텔 화풍", kind: "style", prompt: "artist:foo, pastel colors", negative: "dark" },
    });
    expect(textOf(s)).toContain("저장");
    await client.callTool({
      name: "nai_preset",
      arguments: { action: "save", name: "은발 메이드", kind: "character", prompt: "1girl, silver hair, maid", size: "square" },
    });
    const list: any = await client.callTool({ name: "nai_preset", arguments: { action: "list" } });
    expect(textOf(list)).toContain("파스텔 화풍");

    const r: any = await client.callTool({
      name: "nai_generate",
      arguments: { prompt: "cafe, smile", presets: ["파스텔 화풍", "은발 메이드"] },
    });
    expect(r.structuredContent.status).toBe("done");
    const body = fake.generateBodies()[0];
    expect(body.input.startsWith("artist:foo, pastel colors, 1girl, silver hair, maid, cafe, smile")).toBe(true);
    expect(body.parameters.width).toBe(1024);
    expect(body.parameters.negative_prompt.endsWith(", dark")).toBe(true);

    const missing: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "x", presets: ["없는거"] } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain("파스텔 화풍");

    const del: any = await client.callTool({ name: "nai_preset", arguments: { action: "delete", name: "파스텔 화풍" } });
    expect(textOf(del)).toContain("지웠어");
  });

  it("잘못된 크기·모델은 저장 안 한다", async () => {
    const { client } = await connect();
    const r: any = await client.callTool({ name: "nai_preset", arguments: { action: "save", name: "x", size: "800x600" } });
    expect(r.isError).toBe(true);
    const r2: any = await client.callTool({ name: "nai_preset", arguments: { action: "save", name: "x", model: "v9" } });
    expect(r2.isError).toBe(true);
  });
});

describe("캐릭터", () => {
  it("V5: 캐릭터별 프롬프트·위치", async () => {
    fake.state.tier = 3;
    fake.state.active = true;
    fake.state.usage = { percent: 80, isNegative: false, timeUntilNextPercent: 7888 };
    const { client } = await connect();
    const r: any = await client.callTool({
      name: "nai_generate",
      arguments: {
        prompt: "2girls, park",
        model: "v5",
        characters: [
          { prompt: "girl, red hair", position: "B3" },
          { prompt: "girl, blue hair", position: { x: 0.8, y: 0.5 } },
        ],
      },
    });
    expect(r.structuredContent.status).toBe("done");
    const p = fake.generateBodies()[0].parameters;
    expect(p.params_version).toBe(4);
    expect(p.use_coords).toBe(true);
    expect(p.v4_prompt.caption.char_captions.map((c: any) => c.centers[0])).toEqual([
      { x: 0.3, y: 0.5 },
      { x: 0.8, y: 0.5 },
    ]);
  });

  it("V5 할당량이 비었으면 확인을 받는다", async () => {
    fake.state.tier = 3;
    fake.state.active = true;
    fake.state.usage = { percent: 0, isNegative: true, timeUntilNextPercent: 7888 };
    const { client } = await connect();
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl", model: "v5" } });
    expect(r.structuredContent.status).toBe("needs_confirmation");
    expect(textOf(r)).toContain("V5 무료 할당량이 비어");
  });
});

describe("리뷰에서 나온 경우들", () => {
  it("무료로 예상했는데 돈이 빠지면, 다음부터 무료 예상도 확인받는다", async () => {
    fake.state.tier = 3;
    fake.state.active = true; // Opus라서 무료로 예상하지만 서버는 돈을 뺌
    const { client } = await connect();
    const r1: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(r1.structuredContent.status).toBe("done");
    expect(r1.structuredContent.anlas_spent).toBe(17);
    const r2: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(r2.structuredContent.status).toBe("needs_confirmation");
    expect(r2.structuredContent.estimated_anlas).toBe(17);
    expect(fake.generateBodies().length).toBe(1);
  });

  it("세션 상한에 닿으면 무료 예상도 막는다", async () => {
    fake.state.tier = 3;
    fake.state.active = true;
    const { client } = await connect({ NAI_SESSION_LIMIT: "20" });
    await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } }); // 17 빠짐
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(r.structuredContent.status).toBe("blocked");
    expect(fake.generateBodies().length).toBe(1);
  });

  it("본문 받다가 끊기면: 과금 가능성 알림 + 사용량 기록", async () => {
    fake.state.nextBody = "drop";
    const { client, ctx } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "100" });
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("빠졌을 수도");
    expect(ctx.guard.sessionSpent).toBe(17);
    const ledger = await fs.readFile(path.join(outDir, ".nai-vibe", "ledger.jsonl"), "utf8");
    expect(JSON.parse(ledger.trim())).toMatchObject({ generated: 0, actual: 17 });
  });

  it("헤더만 오고 멈추면 타임아웃으로 끝나고 다음 요청이 막히지 않는다", async () => {
    fake.state.nextBody = "stall";
    const { client } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "100", NAI_TIMEOUT_MS: "10000" });
    const t0 = Date.now();
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("답하지 않았어");
    const r2: any = await client.callTool({ name: "nai_account", arguments: {} });
    expect(r2.isError).toBeFalsy();
  }, 30_000);

  it("저장 폴더에 못 쓰면 임시 폴더에라도 저장한다", async () => {
    const blocker = path.join(outDir, "not-a-dir");
    await fs.writeFile(blocker, "x"); // 파일이라 그 아래에 폴더를 못 만든다
    const { client } = await connect({ NAI_OUTPUT_DIR: blocker, NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "100" });
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(r.structuredContent.status).toBe("done");
    const file = r.structuredContent.images[0].path as string;
    expect(file).toContain("nai-vibe-fallback");
    expect(textOf(r)).toContain("임시 폴더");
    await fs.rm(file, { force: true });
  });

  it("동시에 여러 번 불러도 하나씩 돌고 세션 상한을 지킨다", async () => {
    const { client, ctx } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "100", NAI_SESSION_LIMIT: "60" });
    const rs: any[] = await Promise.all(
      [0, 1, 2, 3, 4].map(() => client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } })),
    );
    expect(rs.filter((r) => r.structuredContent?.status === "done").length).toBe(3);
    expect(fake.generateBodies().length).toBe(3);
    expect(ctx.guard.sessionSpent).toBe(51);
    expect(fake.state.maxConcurrent).toBe(1);
  });

  it("확인 뒤 프리셋이 바뀌면 그 번호로는 실행 안 한다", async () => {
    const { client } = await connect();
    await client.callTool({ name: "nai_preset", arguments: { action: "save", name: "s", prompt: "artist:a" } });
    const r1: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl", presets: ["s"] } });
    await client.callTool({ name: "nai_preset", arguments: { action: "save", name: "s", prompt: "artist:b", size: "large_portrait" } });
    const r2: any = await client.callTool({
      name: "nai_generate",
      arguments: { prompt: "1girl", presets: ["s"], confirm_id: r1.structuredContent.confirm_id },
    });
    expect(r2.structuredContent.status).toBe("needs_confirmation");
    expect(fake.generateBodies().length).toBe(0);
  });

  it("기본값을 명시해서 다시 불러도 같은 요청으로 본다", async () => {
    const { client } = await connect();
    const r1: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl" } });
    expect(textOf(r1)).toContain("832x1216");
    const r2: any = await client.callTool({
      name: "nai_generate",
      arguments: { prompt: "1girl", size: "portrait", count: 1, steps: 23, model: "v4.5-full", confirm_id: r1.structuredContent.confirm_id },
    });
    expect(r2.structuredContent.status).toBe("done");
  });

  it("__proto__ 같은 이름은 프리셋으로 못 쓴다", async () => {
    const { client } = await connect();
    const r: any = await client.callTool({ name: "nai_preset", arguments: { action: "save", name: "__proto__", prompt: "x" } });
    expect(r.isError).toBe(true);
  });

  it("손으로 고친 이상한 프리셋 값은 생성 전에 걸러낸다", async () => {
    await fs.mkdir(path.join(outDir, ".nai-vibe"), { recursive: true });
    await fs.writeFile(
      path.join(outDir, ".nai-vibe", "presets.json"),
      JSON.stringify({ schema: 1, presets: { bad: { kind: "other", steps: "28", created: "x", updated: "x" } } }),
    );
    const { client } = await connect();
    const r: any = await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl", presets: ["bad"] } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("steps");
    expect(fake.state.requests.length).toBe(0);
  });
});
