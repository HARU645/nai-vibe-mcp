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
1. 아래 \`nai-vibe-mcp-${version}.mcpb\`를 내려받아 더블클릭합니다 (또는 Claude 데스크톱 창에 끌어다 놓습니다).
2. 설정 창에 NovelAI **Persistent API Token**(\`pst-…\`)을 입력하고 설치합니다. 토큰은 NovelAI → User Settings → Account → Get Persistent API Token에서 발급할 수 있으며, 설정 창에만 입력하고 채팅에는 붙여넣지 마세요.
3. 새 대화에서 "NovelAI 연결 확인해 줘"라고 입력합니다.

이미 설치되어 있다면 새 파일로 다시 설치하면 됩니다. 프리셋·기록은 저장 폴더에 있으므로 그대로 유지됩니다.
사용법·설정·자주 묻는 질문은 [README](https://github.com/HARU645/nai-vibe-mcp#readme)를 참고하세요.

## 변경 사항
${section || "(CHANGELOG에 이 버전 항목이 없습니다)"}

---
비공식 도구이며, NovelAI / Anlatan과 관계가 없습니다. 문제가 있으면 Issue에 \`nai_about\` 진단 정보를 붙여 알려 주세요 (토큰은 포함되어 있지 않습니다).
`);
