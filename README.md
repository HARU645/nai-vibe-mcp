# NAI 바이브 짤뽑 (nai-vibe-mcp)

Claude한테 한국어로 말하면 NovelAI로 그림을 뽑아 주는 MCP 서버야.
"은발 메이드가 카페에서 웃는 그림 세로로 2장" 하고 말하면 Claude가 태그로 바꿔서 뽑고, 그림은 내 PC 폴더에 날짜별로 저장돼.

> ⚠️ **비공식 도구**야. NovelAI / Anlatan과 관계없는 개인 프로젝트고, NovelAI 로고·상표를 쓰지 않아.
> 지금은 **클로즈드 베타(v0.1)** 단계야.

## 뭐가 좋아?

- **비용 가드** — Anlas가 드는 요청은 그림을 뽑기 전에 예상 비용과 잔액을 먼저 보여 주고, 내가 "응"이라고 해야 실행해. Opus 무료 조건이면 묻지 않고 바로 뽑아.
- **프리셋** — 자주 쓰는 화풍·캐릭터·의상·크기를 이름으로 저장해 두고 "파스텔 화풍으로", "우리 메이드 애로" 하고 불러 쓸 수 있어.
- **날짜별 저장 + 기록** — 원본 PNG는 `저장 폴더/2026-10-08/` 같은 곳에, 설정은 기록 파일에 남아서 시드까지 다시 쓸 수 있어.
- **한국어** — 안내·오류 메시지가 전부 한국어야.

## 필요한 것

1. **NovelAI 계정 + Persistent API Token**
   NovelAI 사이트 → 왼쪽 아래 톱니바퀴(User Settings) → **Account** → **Get Persistent API Token** → `pst-`로 시작하는 토큰이 나와.
   - 구독이 끝났어도 남은 Anlas로 뽑을 수 있어 (모든 생성이 유료로 계산돼).
   - 토큰은 **설정 창에만** 넣어. 채팅창에 붙여넣지 마.
2. **Claude 데스크톱 앱** (Windows / Mac). 다른 앱은 [아래](#다른-앱에서-쓰기) 참고.

## 설치 (Claude 데스크톱)

1. [Releases](../../releases)에서 `nai-vibe-mcp-x.y.z.mcpb`를 받아.
2. 파일을 **더블클릭**하거나 Claude 데스크톱 창에 끌어다 놓아. (또는 설정 → 확장 프로그램 → 고급 설정 → 확장 프로그램 설치)
3. 설정 창에 **NovelAI 토큰**을 넣고, 필요하면 저장 폴더를 고른 뒤 설치.

새 대화에서 이렇게 말해 봐:

```
NovelAI 연결 확인해 줘
```

구독 등급이랑 Anlas 잔액이 나오면 끝이야.

## 이렇게 말하면 돼

```
은발 메이드가 카페에서 웃는 그림 한 장 뽑아 줘
```
```
방금 거 시드 그대로 두고 머리만 분홍색으로
```
```
지금 화풍 태그를 "파스텔 화풍" 프리셋으로 저장해 줘
```
```
파스텔 화풍으로 빨간 머리 애랑 파란 머리 애가 공원 벤치에 앉아 있는 그림, 왼쪽이 빨강
```
```
V5로 "OPEN"이라고 써 있는 간판 든 여자애 그려 줘
```
```
가로로 4장, 28스텝으로
```

Claude가 비용을 물어보면 숫자를 보고 "응 진행해" 하면 돼.

## 비용 (Anlas)

NovelAI는 비용 조회 API가 없어서, 웹 클라이언트와 같은 공식으로 **추정**해. 실제로 빠진 양은 생성할 때마다 잔액 차이로 확인해서 알려 줘.

| 상황 | 비용 |
|---|---|
| Opus + V4.5 + 1024x1024 픽셀 이하 + 28스텝 이하 | 무료 |
| Opus + V5 + 같은 조건 | 무료지만 회복형 **V5 할당량**에서 차감 (다 쓰면 유료) |
| 그 밖 (Opus 아님, 큰 크기, 29스텝 이상) | 유료 |

유료일 때 장당 (실제 차감으로 확인한 공식 기준):

| 크기 · 스텝 | V4.5 | V5 |
|---|---|---|
| 세로 832x1216 · 23 (기본) | 17 | 26 |
| 세로 832x1216 · 28 | 20 | 30 |
| 작은 세로 512x768 · 23 | 7 | 11 |
| 큰 세로 1024x1536 · 28 | 30 | 45 |

V5는 같은 크기에서 V4.5보다 1.5배 비싸.
여러 장은 항상 **한 장씩** 보내서 Opus 무료 조건이 장마다 적용돼.

### 비용 모드 (설정)

- `confirm` (기본, 추천): 무료면 바로, 유료면 먼저 물어봄
- `free_only`: 무료만. 유료 요청은 막음 (Opus가 아니면 아무것도 못 뽑아)
- `allow`: "자동 허용 상한"까지는 묻지 않고 실행

그리고 **세션 Anlas 상한**(기본 1000)을 넘으면 확인을 받아도 막아. 실수로 많이 쓰는 걸 막는 마지막 안전장치야.

## 설정

| 항목 | 기본값 | 설명 |
|---|---|---|
| NovelAI 토큰 | (필수) | `pst-…` |
| 저장 폴더 | `내 사진/nai-vibe` | 날짜별 하위 폴더에 PNG 저장 |
| 기본 모델 | `v4.5-full` | `v4.5-full`, `v4.5-curated`, `v5-full`, `v5-curated` |
| 비용 모드 | `confirm` | 위 참고 |
| 자동 허용 상한 | 30 | allow 모드에서 묻지 않는 한 요청의 최대 Anlas |
| 세션 Anlas 상한 | 1000 | 0이면 없음 |
| 한 번에 뽑는 최대 장 수 | 4 | 1~8 |
| 새 버전 알림 | 켜짐 | 하루 한 번 GitHub 최신 버전 번호만 확인 |

## 파일

```
저장 폴더/
├─ 2026-10-08/
│   └─ nai_153012_1234567890.png   ← 원본 (NovelAI 메타데이터 그대로)
└─ .nai-vibe/
    ├─ presets.json    ← 프리셋
    ├─ history.jsonl   ← 그림마다 설정 (프롬프트, 시드, 모델…)
    └─ ledger.jsonl    ← 요청마다 예상 비용 / 실제 차감
```

업데이트하거나 다시 설치해도 이 폴더는 그대로야.

## 업데이트

- 새 버전이 나오면 도구 결과 끝에 한 줄로 알려 줘.
- Releases에서 새 `.mcpb`를 받아서 다시 설치하면 돼. 프리셋·기록은 저장 폴더에 있어서 안 날아가.

## 다른 앱에서 쓰기

Claude 데스크톱 말고도 **로컬(stdio) MCP**를 지원하는 앱이면 다 돼. `.mcpb` 안의 `server/index.mjs`를 Node 18 이상으로 실행하면 되고, 설정은 환경변수로 줘.

```jsonc
// Claude Code, Cursor 등 (mcpServers 형식)
{
  "mcpServers": {
    "nai-vibe": {
      "command": "node",
      "args": ["C:/tools/nai-vibe-mcp/server/index.mjs"],
      "env": { "NAI_TOKEN": "pst-...", "NAI_OUTPUT_DIR": "D:/nai-pictures" }
    }
  }
}
```

- **ChatGPT 데스크톱 (Codex 통합 앱)**: 설정 → MCP servers → Add server → STDIO, Command `node`, Arguments에 `server/index.mjs` 경로, 환경변수에 `NAI_TOKEN`.
- **Codex CLI**: `codex mcp add nai-vibe --env NAI_TOKEN=pst-... -- node C:/tools/nai-vibe-mcp/server/index.mjs`
- ChatGPT 웹·Grok 웹/앱은 인터넷에 열린(https) 서버만 붙일 수 있어서 지금은 못 써.
- npm 패키지·Windows 실행 파일(.exe)은 준비 중이야.

환경변수: `NAI_TOKEN`, `NAI_OUTPUT_DIR`, `NAI_DEFAULT_MODEL`, `NAI_COST_MODE`, `NAI_ALLOW_MAX`, `NAI_SESSION_LIMIT`, `NAI_MAX_COUNT`, `NAI_UPDATE_CHECK`

## 자주 묻는 것

**토큰이 틀렸대 (401)** — 토큰을 다시 만들어서 설정에 넣어 줘. 앞뒤 공백도 확인.

**Anlas가 부족하대 (402)** — 잔액보다 비싼 요청이야. 크기·스텝을 줄이거나 Anlas를 채워.

**잠깐 쉬래 (429)** — NovelAI는 계정당 한 번에 한 장만 뽑아. 다른 곳(웹 등)에서 동시에 뽑고 있으면 나와. 몇 초 기다렸다가 자동으로 두 번까지 다시 보내.

**예상 비용이랑 실제가 달라** — 비공식 공식이라 틀릴 수 있어. `ledger.jsonl`에 기록되니까 이슈로 알려 주면 고칠게.

**Claude가 그림을 안 그려 줘** — Claude는 자기 정책에 따라 일부 요청을 거절할 수 있어. 이건 이 도구가 바꿀 수 있는 부분이 아니야.

**문제 신고** — Claude한테 "nai_about 진단 정보 보여 줘"라고 하고 나온 내용을 이슈에 붙여 줘 (토큰은 안 들어 있어).

## 토큰은 어떻게 다뤄?

- Claude 데스크톱은 확장 설정의 민감한 값을 앱이 따로 보관하고, 서버에는 환경변수로만 넘겨.
- 서버는 토큰을 NovelAI(`image.novelai.net`)에 보낼 때만 써. 로그·저장 파일·오류 메시지에 남기지 않아 (테스트로 확인).
- 업데이트 확인은 GitHub에 최신 버전 번호만 물어봐. 아무 정보도 보내지 않아.

## 라이선스

MIT

---

## English summary

Unofficial MCP server that lets Claude (and other local MCP clients) generate images with your own NovelAI account. Bring your own Persistent API Token (`pst-...`). Features: cost guard (paid requests need explicit confirmation; Opus-free requests run immediately), named presets, dated output folders, generation history and an Anlas ledger. Install the `.mcpb` in Claude Desktop, enter your token, and ask "check my NovelAI connection". Not affiliated with NovelAI/Anlatan.
