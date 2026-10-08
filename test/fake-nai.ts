// 가짜 NovelAI 서버. 실제 응답 형식(zip 안의 image_0.png)과 오류 코드를 흉내 낸다.
// 비용은 우리 공식과 같은 값으로 잔액에서 빼서, "잔액 차이로 실제 비용 확인" 흐름까지 시험한다.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { zipSync } from "fflate";
import { PNG } from "pngjs";

export const TEST_TOKEN = "pst-TESTtoken1234567890abcdefXYZ";

export interface FakeState {
  tier: number;
  active: boolean;
  anlas: number;
  usage?: { percent: number; isNegative: boolean; timeUntilNextPercent: number };
  /** 생성 한 번에 뺄 Anlas (요청 본문을 보고 정함) */
  charge: (body: Record<string, any>) => number;
  /** 다음 생성 요청들에 돌려줄 오류 상태 코드 (앞에서부터 하나씩 씀) */
  failures: number[];
  /** 오류여도 잔액을 빼는지 (서버가 처리 중 죽은 상황) */
  chargeOnFailure: boolean;
  requests: Array<{ method: string; path: string; headers: http.IncomingHttpHeaders; body?: any }>;
  maxConcurrent: number;
  delayMs: number;
  /** 다음 생성 응답 한 번을 이상하게: drop = 본문 중간에 연결 끊기, stall = 헤더만 보내고 멈춤 */
  nextBody?: "drop" | "stall";
  /** 태그 자동완성이 아는 태그들 (prompt가 들어 있는 것을 돌려줌) */
  tagDb: Array<{ tag: string; count: number; confidence: number }>;
  /** 태그 자동완성을 이 상태 코드로 실패시키기 */
  suggestStatus?: number;
}

function tinyPng(): Buffer {
  const png = new PNG({ width: 64, height: 96 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 200;
    png.data[i + 1] = 120;
    png.data[i + 2] = 160;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

export async function startFakeNai(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    tier: 0,
    active: false,
    anlas: 1000,
    charge: () => 0,
    failures: [],
    chargeOnFailure: false,
    requests: [],
    maxConcurrent: 0,
    delayMs: 5,
    tagDb: [
      { tag: "artist:wlop", count: 5123, confidence: 0.93 },
      { tag: "artist:wlop (style)", count: 12, confidence: 0.2 },
      { tag: "artist:ask (askzy)", count: 2311, confidence: 0.88 },
      { tag: "silver hair", count: 182000, confidence: 0.99 },
    ],
    ...initial,
  };
  let inFlight = 0;
  const stalled: http.ServerResponse[] = [];
  const png = tinyPng();

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: any;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    state.requests.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body });

    if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ statusCode: 401, message: "Unauthorized" }));
      return;
    }

    if (req.method === "GET" && req.url === "/user/subscription") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          tier: state.tier,
          active: state.active,
          expiresAt: 1_800_000_000,
          perks: { unlimitedImageGeneration: state.active && state.tier >= 3 },
          trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: state.anlas },
          ...(state.usage ? { usage: state.usage } : {}),
        }),
      );
      return;
    }

    if (req.method === "GET" && (req.url ?? "").startsWith("/ai/generate-image/suggest-tags")) {
      if (state.suggestStatus) {
        res.writeHead(state.suggestStatus, { "content-type": "application/json" });
        res.end(JSON.stringify({ statusCode: state.suggestStatus, message: "fake" }));
        return;
      }
      const q = new URL(req.url ?? "", "http://x").searchParams;
      const want = (q.get("prompt") ?? "").toLowerCase();
      const tags = state.tagDb.filter((t) => t.tag.toLowerCase().includes(want));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ tags }));
      return;
    }

    if (req.method === "POST" && req.url === "/ai/generate-image") {
      inFlight++;
      state.maxConcurrent = Math.max(state.maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, state.delayMs));
      inFlight--;
      const fail = state.failures.shift();
      if (fail) {
        if (state.chargeOnFailure) state.anlas -= state.charge(body);
        res.writeHead(fail, { "content-type": "application/json" });
        res.end(JSON.stringify({ statusCode: fail, message: `fake error ${fail} for ${TEST_TOKEN}` }));
        return;
      }
      const cost = state.charge(body);
      if (cost > state.anlas) {
        res.writeHead(402, { "content-type": "application/json" });
        res.end(JSON.stringify({ statusCode: 402, message: "Not enough Anlas" }));
        return;
      }
      state.anlas -= cost;
      const zip = zipSync({ "image_0.png": png });
      const mode = state.nextBody;
      state.nextBody = undefined;
      if (mode) {
        res.writeHead(200, { "content-type": "application/x-zip-compressed", "content-length": String(zip.length) });
        res.write(Buffer.from(zip.slice(0, 10)));
        if (mode === "drop") setTimeout(() => res.destroy(), 20);
        else stalled.push(res);
        return;
      }
      res.writeHead(200, { "content-type": "application/x-zip-compressed" });
      res.end(Buffer.from(zip));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    state,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((r) => {
        for (const s of stalled) s.destroy();
        server.closeAllConnections?.();
        server.close(() => r());
      }),
    generateBodies: () => state.requests.filter((r) => r.path === "/ai/generate-image").map((r) => r.body),
  };
}
