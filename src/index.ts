// 진입점: stdio로 MCP 서버를 띄운다. 로그는 전부 stderr로 (stdout은 MCP 통신용).

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

async function main(): Promise<void> {
  if (process.argv.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const config = loadConfig();
  const { server } = createServer(config);
  await server.connect(new StdioServerTransport());
  process.stderr.write(
    `nai-vibe-mcp v${VERSION} 시작 (토큰 ${config.token ? "있음" : "없음"}, 저장 폴더 ${config.outputDir})\n`,
  );
  for (const w of config.warnings) process.stderr.write(`설정 경고: ${w}\n`);
}

main().catch((e) => {
  process.stderr.write(`nai-vibe-mcp 시작 실패: ${(e as Error)?.message ?? String(e)}\n`);
  process.exit(1);
});
