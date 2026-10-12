# nai-vibe-mcp — Claude Code 작업 규칙

NovelAI 이미지 생성을 Claude 같은 MCP 앱에서 말로 쓰게 해 주는 MCP 서버 (TypeScript, stdio). Claude 데스크톱용 `.mcpb`로 배포.
공개 저장소 https://github.com/HARU645/nai-vibe-mcp (MIT). NovelAI/Anlatan과 무관한 비공식 도구 — NovelAI 로고·상표 사용 금지.

## 역할 나누기
- 기능 방향과 스펙은 설계 담당(claude.ai 프로젝트 쪽 Claude + 사용자)이 `docs/specs/`에 씀. 여기(Claude Code)는 **스펙대로 구현·테스트·릴리스** 담당
- 작업 시작 전에 `docs/specs/README.md`에서 대상 스펙을 확인하고 그 문서를 끝까지 읽기
- `docs/roadmap.md`는 설계 쪽이 관리하는 아이디어·버전 계획. 로드맵에만 있고 스펙이 `준비됨`이 아닌 기능은 구현하지 않음
- 스펙이 모호하거나 스펙에 없는 큰 결정(새 도구, 도구 입력·출력 변경, 설정 추가, 저장 파일 형식 변경, 기본값 변경)이 필요하면 추측하지 말고 사용자에게 먼저 묻기
- 구현이 끝나면 그 스펙 문서 맨 위의 `상태`를 고치기 (예: `구현됨 — v0.2.2, PR #3`). 구현하다 스펙과 다르게 한 부분은 스펙 끝 "구현 메모"에 이유와 함께 적기

## 꼭 지킬 것
1. **커밋 작성자는 `haru645 <108279410+HARU645@users.noreply.github.com>`만**. 새 clone이나 새 PC에서는 커밋 전에 저장소 로컬 설정으로 지정하고 확인
   ```
   git config user.name "haru645"
   git config user.email "108279410+HARU645@users.noreply.github.com"
   git config user.email   # 확인
   ```
   실명이나 개인 이메일이 들어간 커밋은 절대 push하지 않음. push 전에 `git log --format='%an <%ae>' origin/main..HEAD`로 한 번 더 확인
2. 개인 정보(실명, 개인 이메일, PC 사용자 폴더 이름 등)를 코드·커밋 메시지·이슈·PR·Release 노트에 넣지 않음. `docs/plan.md`는 개인 계획서라 `.gitignore`에 있음 — 올리지 않음
3. NovelAI 토큰(`pst-…`)은 출력·로그·파일·커밋 어디에도 남기지 않음. 테스트는 `test/fake-nai.ts` 가짜 서버로
4. 실제 NovelAI 요청(Anlas가 드는 생성)은 사용자 확인 후에만
5. 비용·약관 관련 구조를 깨지 않음
   - confirm 모드의 `confirm_id`는 실제로 보낼 요청의 해시에 묶임 (1회용)
   - 요청이 나간 뒤 자동 재시도 금지 (429만 예외), 동시 생성 금지 (`SerialQueue`)
   - NovelAI 웹사이트인 척하는 헤더(Origin·Referer·브라우저 User-Agent) 금지
   - 저장 폴더 밖에 파일을 쓰지 않음
6. NovelAI API를 건드리기 전에 `docs/api-notes.md`(실측 메모: 요청 형식, 비용 공식, 자동완성 한계, 숫자 뒤 `::` 500 오류 등)를 읽기

## 명령
- 설치 `npm ci` (CI는 Node 22, `engines`는 >=18.17)
- 타입 검사 `npm run typecheck`
- 테스트 `npm test` (vitest 3.2 — 4는 npm 설치 버그가 있어서 안 올림)
- 빌드 `npm run build` → `npm run pack:mcpb` → `build/nai-vibe-mcp-<버전>.mcpb`
- 커밋 전에 typecheck + test 통과

## 브랜치와 릴리스
- 작업은 브랜치(`fix/…`, `feat/…`)에서 → PR → 사용자가 main에 머지 (사용자가 "바로 main에 올려"라고 하면 예외)
- **main에 들어가는 순간 릴리스됨**: `.github/workflows/release.yml`이 main push마다 `package.json` 버전의 Release가 없으면 테스트·빌드 후 태그 `v<버전>` + Release(`.mcpb` 첨부)를 만듦
  - 그래서 버전 올리기(`package.json` + `package-lock.json` + `CHANGELOG.md`의 `## x.y.z — 날짜`)는 **릴리스할 PR에만** 넣음. 버전을 안 올린 PR은 머지돼도 릴리스 안 됨
  - Release 노트는 `scripts/release-notes.mjs`가 CHANGELOG의 그 버전 항목으로 만듦
  - 0.x는 제목에 "(베타)"가 자동으로 붙음. 프리릴리스로 표시하지 않음 (프리릴리스는 `/releases/latest`에서 빠져서 앱의 새 버전 알림이 못 찾음)
  - 태그·Release를 손으로 만들지 않음
- `src/version.ts`의 `GITHUB_REPO`는 업데이트 알림이 보는 저장소. 바꾸지 않음
- 저장소를 비공개로 돌리면 다른 사용자에게 새 버전 알림과 Releases 다운로드가 막힘 (공개 여부는 사용자가 정함)

## 코드 구조
- `src/server.ts` — MCP 서버, 도구 등록, `SERVER_INSTRUCTIONS`(AI가 읽는 사용 안내)
- `src/tools.ts` — 도구 6개: `nai_generate`, `nai_account`, `nai_preset`, `nai_about`, `nai_tags`, `nai_compare`
- `src/generate.ts` — 생성 공통 단계 (`resolveCommon`, `runJobs`, `settle`)
- `src/compare.ts`, `src/sheet.ts` — 비교 시트 / `src/tags.ts` — 태그 확인(자동완성)
- `src/api/` — NovelAI 호출만 / `src/cost/` — 비용 계산·가드 / `src/prompt/` — 문법 변환·프롬프트 조립
- `src/store/` — 프리셋·생성 기록·시트 기록 (`<저장 폴더>/.nai-vibe/`)
- `src/serial.ts` — `SerialQueue` / `src/config.ts` — 설정(환경변수·manifest user_config) / `src/update.ts` — 새 버전 알림
- `manifest.json` — `.mcpb` 매니페스트. 도구를 추가하거나 이름·설명을 바꾸면 여기도 같이 고침
- `test/` — `unit.test.ts`, `e2e.test.ts`(가짜 서버 + MCP 클라이언트), `style.test.ts`(화풍 찾기)

## 문체 (한국어, 반말 금지)
- 공개 문서(README, manifest의 설정 설명, Release 노트, 이슈 양식): 합니다체
- 사용자에게 보이는 도구 결과·오류 메시지: 합니다체
- AI가 읽는 글(도구 description, `SERVER_INSTRUCTIONS`): 해라체
- CHANGELOG, `docs/specs/`, 코드 주석: 개조식 (지금 파일들 문체를 따름)

## 그 밖에
- 사용자는 Windows. 저장소 줄바꿈은 `.gitattributes`로 LF. 사용자에게 주는 텍스트 파일(`sheet.txt` 등)은 지금처럼 CRLF로 씀
- 남이 만든 의존성 코드를 고쳐야 하면 먼저 사용자에게 물음

## PC 작업 폴더 `D:\nai-vibe-mcp` 처음 설정 (한 번만)
이 폴더는 원격 작업으로 파일만 복사된 사본이라 `.git`과 `.github`가 없음 (`docs/plan.md`, `build/`는 일부러 있음). 여기서 작업하려면 먼저 GitHub와 연결:
```
git init -b main
git remote add origin https://github.com/HARU645/nai-vibe-mcp.git
git fetch origin
git reset --mixed origin/main      # 작업 파일은 그대로 두고 기록만 맞춤
git restore .github                # 빠져 있던 .github 복원
git status                         # 남는 차이가 있으면 지우지 말고 사용자에게 먼저 보여 주기
```
그다음 위의 "커밋 작성자" 설정을 하고, `npm ci`로 의존성 설치.
