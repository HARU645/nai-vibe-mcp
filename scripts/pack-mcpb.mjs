// .mcpb 묶기: 번들된 서버 파일 하나 + manifest + 아이콘 + 문서.
// 의존성은 dist/index.js 안에 다 들어 있어서 node_modules를 넣지 않는다.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const stage = path.join(root, "build", "mcpb");
const outDir = path.join(root, "build");
const out = path.join(outDir, `nai-vibe-mcp-${pkg.version}.mcpb`);

execFileSync("node", ["scripts/build.mjs"], { cwd: root, stdio: "inherit" });
if (!existsSync(path.join(root, "icon.png"))) {
  execFileSync("node", ["scripts/make-icon.mjs"], { cwd: root, stdio: "inherit" });
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(path.join(stage, "server"), { recursive: true });

const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
manifest.version = pkg.version;
if (pkg.repository?.url) {
  manifest.repository = { type: "git", url: pkg.repository.url };
}
writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
// .mjs로 둬야 Node가 버전과 상관없이 ESM으로 읽는다 (package.json이 번들 안에 없으니까)
cpSync(path.join(root, "dist", "index.js"), path.join(stage, "server", "index.mjs"));
for (const f of ["icon.png", "README.md", "LICENSE"]) cpSync(path.join(root, f), path.join(stage, f));

// Windows에서도 되게 .bin 래퍼 대신 CLI 파일을 node로 직접 실행
const mcpbCli = path.join(root, "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");
execFileSync("node", [mcpbCli, "validate", path.join(stage, "manifest.json")], { stdio: "inherit" });
rmSync(out, { force: true });
execFileSync("node", [mcpbCli, "pack", stage, out], { stdio: "inherit" });
console.log(`\n→ ${path.relative(root, out)}`);
