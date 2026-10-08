// Release 본문 만들기: 설치 안내 + CHANGELOG.md에서 그 버전 부분
import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("사용법: node scripts/release-notes.mjs <버전>");
  process.exit(1);
}
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const lines = changelog.split("\n");
const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l.trim() === `## ${version}`);
let section = "";
if (start >= 0) {
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  section = lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

process.stdout.write(`## 설치 (Claude 데스크톱)
1. 아래 \`nai-vibe-mcp-${version}.mcpb\`를 받아서 더블클릭 (또는 Claude 데스크톱 창에 끌어다 놓기)
2. 설정 창에 NovelAI **Persistent API Token**(\`pst-…\`)을 넣고 설치 — NovelAI → User Settings → Account → Get Persistent API Token. 토큰은 설정 창에만 넣고 채팅에는 붙여넣지 마
3. 새 대화에서 "NovelAI 연결 확인해 줘"

이미 설치돼 있으면 새 파일로 다시 설치하면 돼. 프리셋·기록은 저장 폴더에 있어서 그대로 남아.
사용법·설정·FAQ는 [README](https://github.com/HARU645/nai-vibe-mcp#readme).

## 바뀐 것
${section || "(CHANGELOG에 이 버전 항목이 없어)"}

---
비공식 도구야. NovelAI / Anlatan과 관계없어. 문제가 있으면 Issue에 \`nai_about\` 진단 정보를 붙여서 알려 줘 (토큰은 안 들어 있어).
`);
