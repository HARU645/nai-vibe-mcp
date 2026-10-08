// 화풍 찾기: 태그 확인(nai_tags) → 비교 시트(nai_compare) → 시트 번호로 프리셋 저장.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { costPerImage } from "../src/cost/cost.js";
import { resolveModel } from "../src/models.js";
import { createServer } from "../src/server.js";
import { makeContactSheet, sheetColumns } from "../src/sheet.js";
import { bareTag, normalizeTag } from "../src/tags.js";
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

const suggestRequests = () => fake.state.requests.filter((r) => r.path.startsWith("/ai/generate-image/suggest-tags"));

beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), "nai-vibe-style-"));
  fake = await startFakeNai({ charge: chargeByFormula });
});

afterEach(async () => {
  await fake.close();
  await fs.rm(outDir, { recursive: true, force: true });
});

describe("태그 이름 다루기", () => {
  it("대소문자·밑줄·이스케이프·artist: 차이를 무시한다", () => {
    expect(normalizeTag("Artist:Ask_\\(Askzy\\)")).toBe("ask (askzy)");
    expect(normalizeTag("ask (askzy)")).toBe("ask (askzy)");
  });
  it("가중치·중괄호를 벗긴다", () => {
    expect(bareTag("1.2::artist:foo::")).toBe("artist:foo");
    expect(bareTag("{{artist:foo}}")).toBe("artist:foo");
    expect(bareTag(" artist:foo ")).toBe("artist:foo");
  });
});

describe("시트 이미지", () => {
  function png(w: number, h: number): Buffer {
    const p = new PNG({ width: w, height: h });
    p.data.fill(120);
    return PNG.sync.write(p);
  }
  it("칸 수에 맞춰 격자를 만든다", () => {
    expect([1, 2, 4, 5, 6, 9, 10, 12].map(sheetColumns)).toEqual([1, 2, 4, 3, 3, 3, 4, 4]);
    const s = makeContactSheet([1, 2, 3, 4, 5].map((n) => ({ png: png(64, 96), number: n })));
    // 3열 2행, 칸 256x384, 간격 8
    expect(s.width).toBe(8 + 3 * (256 + 8));
    expect(s.height).toBe(8 + 2 * (384 + 8));
    const img = jpeg.decode(s.data);
    // 첫 칸 번호 배지 안쪽에 흰 획이 있다 (숫자 1의 세로획 근처)
    let white = 0;
    for (let y = 8; y < 8 + 29; y++) {
      for (let x = 8; x < 8 + 23; x++) {
        const o = (y * img.width + x) * 4;
        if (img.data[o]! > 200 && img.data[o + 1]! > 200 && img.data[o + 2]! > 200) white++;
      }
    }
    expect(white).toBeGreaterThan(10);
  });
});

describe("nai_tags", () => {
  it("있는 태그와 없는 태그를 구분하고, Anlas를 쓰지 않는다", async () => {
    const { client } = await connect();
    const r: any = await client.callTool({
      name: "nai_tags",
      arguments: { tags: ["artist:wlop", "artist:WLOP_", "artist:nobody_xyz", "Ask_(askzy)"] },
    });
    expect(r.isError).toBeFalsy();
    const res = r.structuredContent.results;
    expect(res[0]).toMatchObject({ query: "artist:wlop", found: true, tag: "artist:wlop", count: 5123 });
    expect(res[1].found).toBe(true);
    expect(res[2].found).toBe(false);
    expect(res[3].found).toBe(true); // 접두어 없이 물어봐도 artist: 태그와 맞춰 본다
    expect(textOf(r)).toContain("✅ artist:wlop");
    expect(textOf(r)).toContain("❌ artist:nobody_xyz");
    expect(fake.generateBodies().length).toBe(0);
    expect(fake.state.anlas).toBe(1000);
    const q = new URL(suggestRequests()[0]!.path, "http://x").searchParams;
    expect(q.get("model")).toBe("nai-diffusion-4-5-full");
    expect(q.get("lang")).toBe("en");
  });

  it("없는 이름이면 비슷한 태그를 보여 준다", async () => {
    const { client } = await connect();
    const r: any = await client.callTool({ name: "nai_tags", arguments: { tags: ["artist:wlo"] } });
    expect(r.structuredContent.results[0].found).toBe(false);
    expect(textOf(r)).toContain("비슷한 태그: artist:wlop (5,123)");
  });

  it("태그 검색이 안 되면 그렇게 알려 준다", async () => {
    fake.state.suggestStatus = 404;
    const { client } = await connect();
    const r: any = await client.callTool({ name: "nai_tags", arguments: { tags: ["artist:wlop"] } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("태그 검색을 사용할 수 없습니다");
  });
});

describe("nai_compare", () => {
  const variants = [{ prompt: "artist:wlop" }, { prompt: "artist:ask (askzy)", label: "ask" }, { prompt: "0.6::artist:wlop::, 0.4::artist:ask (askzy)::" }];

  it("비구독: 시트 전체 비용을 먼저 확인받고, 같은 시드로 칸마다 태그만 바꿔 뽑는다", async () => {
    const { client, ctx } = await connect();
    const first: any = await client.callTool({ name: "nai_compare", arguments: { variants } });
    expect(first.structuredContent.status).toBe("needs_confirmation");
    // 크기를 안 정하면 비구독은 작은 세로(512x768): 장당 7 × 3칸
    expect(first.structuredContent.estimated_anlas).toBe(21);
    expect(fake.generateBodies().length).toBe(0);

    const r: any = await client.callTool({
      name: "nai_compare",
      arguments: { variants, confirm_id: first.structuredContent.confirm_id },
    });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.status).toBe("done");
    const bodies = fake.generateBodies();
    expect(bodies.length).toBe(3);
    const seeds = new Set(bodies.map((b) => b.parameters.seed));
    expect(seeds.size).toBe(1);
    expect(bodies.every((b) => b.parameters.width === 512 && b.parameters.height === 768)).toBe(true);
    expect(bodies[0].input.startsWith("artist:wlop, 1girl")).toBe(true);
    expect(bodies[1].input.startsWith("artist:ask (askzy), 1girl")).toBe(true);
    expect(bodies[2].input.startsWith("0.6::artist:wlop::, 0.4::artist:ask (askzy)::")).toBe(true);

    const sc = r.structuredContent;
    expect(sc.anlas_spent).toBe(21);
    expect(sc.variants.map((v: any) => v.n)).toEqual([1, 2, 3]);
    expect(sc.variants[1].label).toBe("ask");
    const files = await fs.readdir(sc.dir);
    expect(files.sort()).toEqual([`01_${sc.seed}.png`, `02_${sc.seed}.png`, `03_${sc.seed}.png`, "sheet.jpg", "sheet.txt"]);
    expect(path.basename(path.dirname(sc.dir))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(path.basename(sc.dir)).toMatch(/^compare_\d{6}$/);
    // 결과에는 시트 이미지 한 장만 (개별 미리보기 여러 장 대신)
    expect(r.content.filter((c: any) => c.type === "image").length).toBe(1);
    const legend = await fs.readFile(path.join(sc.dir, "sheet.txt"), "utf8");
    expect(legend).toContain("2. artist:ask (askzy)  (ask)");
    const rec = await ctx.sheets.get();
    expect(rec?.id).toBe(sc.sheet_id);
    expect(rec?.variants[0]?.file).toBeTruthy();
  });

  it("Opus + V4.5: 크기를 안 정하면 보통 크기로 무료, 바로 실행", async () => {
    fake.state.tier = 3;
    fake.state.active = true;
    fake.state.charge = () => 0;
    const { client } = await connect();
    const r: any = await client.callTool({ name: "nai_compare", arguments: { variants, seed: 42 } });
    expect(r.structuredContent.status).toBe("done");
    expect(fake.generateBodies().every((b) => b.parameters.width === 832 && b.parameters.seed === 42)).toBe(true);
  });

  it("13칸 이상은 받지 않는다", async () => {
    const { client } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "1000" });
    const many = Array.from({ length: 13 }, (_, i) => ({ prompt: `artist:a${i}` }));
    const r: any = await client.callTool({ name: "nai_compare", arguments: { variants: many } });
    expect(r.isError).toBe(true);
    expect(fake.generateBodies().length).toBe(0);
  });

  it("세션 상한을 넘는 시트는 막는다", async () => {
    const { client } = await connect({ NAI_SESSION_LIMIT: "15" });
    const r: any = await client.callTool({ name: "nai_compare", arguments: { variants } });
    expect(r.structuredContent.status).toBe("blocked");
  });

  it("중간에 실패하면 된 칸까지 시트로 만들고 기록한다", async () => {
    const { client, ctx } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "100" });
    fake.state.failures = [0, 500]; // 첫 칸은 성공, 둘째 칸에서 500
    const r: any = await client.callTool({ name: "nai_compare", arguments: { variants } });
    expect(r.structuredContent.status).toBe("partial");
    expect(textOf(r)).toContain("2번째 칸에서 중단");
    expect(textOf(r)).toContain("2. artist:ask (askzy)  (ask)  — 생성 안 됨");
    const rec = await ctx.sheets.get();
    expect(rec?.variants.map((v) => !!v.file)).toEqual([true, false, false]);
    expect(r.content.filter((c: any) => c.type === "image").length).toBe(1);
  });
});

describe("시트 번호로 프리셋 저장", () => {
  it("고른 번호의 태그를 그대로 화풍 프리셋으로 저장하고 생성에 쓴다", async () => {
    const { client } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "100" });
    await client.callTool({
      name: "nai_compare",
      arguments: { variants: [{ prompt: "artist:wlop" }, { prompt: "0.7::artist:wlop::, 0.3::artist:ask (askzy)::" }] },
    });
    const s: any = await client.callTool({
      name: "nai_preset",
      arguments: { action: "save", name: "몽환 화풍", from_sheet: { number: 2 } },
    });
    expect(s.isError).toBeFalsy();
    expect(textOf(s)).toContain("태그: 0.7::artist:wlop::, 0.3::artist:ask (askzy)::");
    const g: any = await client.callTool({ name: "nai_preset", arguments: { action: "get", name: "몽환 화풍" } });
    expect(g.structuredContent.preset.kind).toBe("style");
    expect(g.structuredContent.preset.prompt).toBe("0.7::artist:wlop::, 0.3::artist:ask (askzy)::");
    expect(g.structuredContent.preset.note).toMatch(/비교 시트 .+의 2번/);

    await client.callTool({ name: "nai_generate", arguments: { prompt: "1girl, cafe", presets: ["몽환 화풍"] } });
    const last = fake.generateBodies().at(-1);
    expect(last.input.startsWith("0.7::artist:wlop::, 0.3::artist:ask (askzy)::, 1girl, cafe")).toBe(true);
  });

  it("없는 번호·시트는 알려 준다", async () => {
    const { client } = await connect({ NAI_COST_MODE: "allow", NAI_ALLOW_MAX: "100" });
    const none: any = await client.callTool({
      name: "nai_preset",
      arguments: { action: "save", name: "x", from_sheet: { number: 1 } },
    });
    expect(none.isError).toBe(true);
    expect(textOf(none)).toContain("저장된 비교 시트가 아직 없습니다");
    await client.callTool({ name: "nai_compare", arguments: { variants: [{ prompt: "artist:a" }, { prompt: "artist:b" }] } });
    const big: any = await client.callTool({
      name: "nai_preset",
      arguments: { action: "save", name: "x", from_sheet: { number: 5 } },
    });
    expect(big.isError).toBe(true);
    expect(textOf(big)).toContain("5번이 없습니다");
    const wrong: any = await client.callTool({
      name: "nai_preset",
      arguments: { action: "save", name: "x", from_sheet: { number: 1, sheet: "000000" } },
    });
    expect(wrong.isError).toBe(true);
  });
});
