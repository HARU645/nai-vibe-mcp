import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NaiClient } from "./api/client.js";
import type { Config } from "./config.js";
import { CostGuard } from "./cost/guard.js";
import { HistoryStore } from "./store/history.js";
import { PresetStore } from "./store/presets.js";
import { registerTools, type ToolContext } from "./tools.js";
import { UpdateChecker } from "./update.js";
import { VERSION } from "./version.js";

export const SERVER_INSTRUCTIONS = [
  "nai-vibe-mcp: 사용자의 NovelAI 계정으로 그림을 뽑는 도구.",
  "- 사용자가 한국어로 장면을 말하면, 그걸 영어 Danbooru 태그로 바꿔 nai_generate의 prompt에 넣는다. 품질 태그·기본 네거티브는 서버가 붙인다.",
  "- 가중치는 NovelAI 문법(1.2::tag::, {tag}, [tag]). 아티스트는 artist:이름.",
  "- 결과로 나온 confirm_id는 비용 확인용이다. 예상 Anlas와 잔액을 사용자에게 보여 주고, 사용자가 진행하라고 한 뒤에만 같은 인자에 confirm_id를 넣어 다시 호출한다.",
  "- 처음이거나 연결이 의심되면 nai_account로 확인한다. 자주 쓰는 화풍·캐릭터는 nai_preset으로 저장해 두면 다음에 이름으로 쓸 수 있다.",
  "- 토큰을 채팅에 붙여넣으라고 하지 않는다. 토큰은 앱의 확장(서버) 설정에서만 넣는다.",
].join("\n");

export interface ServerDeps {
  fetchImpl?: typeof fetch;
  retryDelaysMs?: number[];
}

export function createServer(config: Config, deps: ServerDeps = {}): { server: McpServer; ctx: ToolContext } {
  const server = new McpServer(
    { name: "nai-vibe-mcp", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const ctx: ToolContext = {
    config,
    client: new NaiClient({
      token: config.token,
      base: config.apiBase,
      timeoutMs: config.timeoutMs,
      fetchImpl: deps.fetchImpl,
      retryDelaysMs: deps.retryDelaysMs,
      userAgent: `nai-vibe-mcp/${VERSION}`,
    }),
    guard: new CostGuard({ mode: config.costMode, allowMax: config.allowMax, sessionLimit: config.sessionLimit }),
    presets: new PresetStore(config.outputDir),
    history: new HistoryStore(config.outputDir),
    updates: new UpdateChecker(config.outputDir, config.updateCheck, deps.fetchImpl),
  };
  registerTools(server, ctx);
  return { server, ctx };
}
