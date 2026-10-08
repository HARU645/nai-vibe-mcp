// 서버를 파일 하나(dist/index.js)로 묶는다. .mcpb·npm·exe가 모두 이 파일을 쓴다.
import { build } from "esbuild";
import { readFileSync, mkdirSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  minify: false,
  sourcemap: false,
  legalComments: "none",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // pngjs 같은 CommonJS 의존성이 require를 쓰기 때문에 ESM 번들 안에 require를 만들어 준다.
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __nvCreateRequire } from 'node:module';",
      "const require = __nvCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});

console.log(`built dist/index.js (v${pkg.version})`);
