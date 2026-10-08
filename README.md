# NAI 바이브 짤뽑 (nai-vibe-mcp)

Claude에게 한국어로 말하면 NovelAI로 그림을 생성해 주는 MCP 서버입니다.
"은발 메이드가 카페에서 웃는 그림 세로로 2장"처럼 말하면 Claude가 태그로 바꿔 생성하고, 그림은 내 PC 폴더에 날짜별로 저장됩니다.

> ⚠️ **비공식 도구**입니다. NovelAI / Anlatan과 관계없는 개인 프로젝트이며, NovelAI 로고·상표를 사용하지 않습니다.
> 현재 **베타(v0.1)** 단계입니다.

## 주요 기능

- **비용 가드** — Anlas가 드는 요청은 생성 전에 예상 비용과 잔액을 먼저 보여 주고, 사용자가 승인해야 실행합니다. Opus 무료 조건에 해당하면 묻지 않고 바로 생성합니다.
- **프리셋** — 자주 쓰는 화풍·캐릭터·의상·크기를 이름으로 저장해 두고 "파스텔 화풍으로", "우리 메이드 애로"처럼 불러 쓸 수 있습니다.
- **날짜별 저장 + 기록** — 원본 PNG는 `저장 폴더/2026-10-08/` 같은 폴더에 저장되고, 설정은 기록 파일에 남아 시드까지 다시 사용할 수 있습니다.
- **한국어** — 안내·오류 메시지가 모두 한국어입니다.

## 필요한 것

1. **NovelAI 계정 + Persistent API Token**
   NovelAI 사이트 → 왼쪽 아래 톱니바퀴(User Settings) → **Account** → **Get Persistent API Token**을 누르면 `pst-`로 시작하는 토큰이 발급됩니다.
   - 구독이 끝난 계정도 남은 Anlas로 생성할 수 있습니다 (이 경우 모든 생성이 유료로 계산됩니다).
   - 토큰은 **설정 창에만** 입력하고, 채팅창에는 붙여넣지 마세요.
2. **Claude 데스크톱 앱** (Windows / Mac). 다른 앱은 [아래](#다른-앱에서-사용하기)를 참고하세요.

## 설치 (Claude 데스크톱)

1. [Releases](../../releases)에서 `nai-vibe-mcp-x.y.z.mcpb`를 내려받습니다.
2. 파일을 **더블클릭**하거나 Claude 데스크톱 창에 끌어다 놓습니다. (또는 설정 → 확장 프로그램 → 고급 설정 → 확장 프로그램 설치)
3. 설정 창에 **NovelAI 토큰**을 입력하고, 필요하면 저장 폴더를 고른 뒤 설치합니다.

새 대화에서 다음과 같이 입력해 보세요.

```
NovelAI 연결 확인해 줘
```

구독 등급과 Anlas 잔액이 표시되면 설치가 끝난 것입니다.

## 사용 예시

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

Claude가 비용을 물어보면 숫자를 확인한 뒤 "응 진행해"처럼 답하면 됩니다.

## 비용 (Anlas)

NovelAI에는 비용 조회 API가 없어서, 웹 클라이언트와 같은 공식으로 비용을 **추정**합니다. 실제로 차감된 양은 생성할 때마다 잔액 차이로 확인해 알려 드립니다.

| 상황 | 비용 |
|---|---|
| Opus + V4.5 + 1024x1024 픽셀 이하 + 28스텝 이하 | 무료 |
| Opus + V5 + 같은 조건 | 무료이지만 회복형 **V5 할당량**에서 차감 (소진 시 유료) |
| 그 외 (Opus가 아닌 경우, 큰 크기, 29스텝 이상) | 유료 |

유료일 때 장당 비용 (실제 차감으로 확인한 공식 기준):

| 크기 · 스텝 | V4.5 | V5 |
|---|---|---|
| 세로 832x1216 · 23 (기본) | 17 | 26 |
| 세로 832x1216 · 28 | 20 | 30 |
| 작은 세로 512x768 · 23 | 7 | 11 |
| 큰 세로 1024x1536 · 28 | 30 | 45 |

V5는 같은 크기에서 V4.5보다 1.5배 비쌉니다.
여러 장을 요청해도 항상 **한 장씩** 보내므로 Opus 무료 조건이 장마다 적용됩니다.

### 비용 모드 (설정)

- `confirm` (기본, 추천): 무료면 바로 실행하고, 유료면 먼저 확인을 받습니다.
- `free_only`: 무료 요청만 실행하고 유료 요청은 막습니다 (Opus 구독이 아니면 아무것도 생성할 수 없습니다).
- `allow`: "자동 허용 상한"까지는 묻지 않고 실행합니다.

또한 **세션 Anlas 상한**(기본 1000)을 넘으면 확인을 받아도 실행하지 않습니다. 실수로 많이 쓰는 것을 막는 마지막 안전장치입니다.

## 설정

| 항목 | 기본값 | 설명 |
|---|---|---|
| NovelAI 토큰 | (필수) | `pst-…` |
| 저장 폴더 | `내 사진/nai-vibe` | 날짜별 하위 폴더에 PNG 저장 |
| 기본 모델 | `v4.5-full` | `v4.5-full`, `v4.5-curated`, `v5-full`, `v5-curated` |
| 비용 모드 | `confirm` | 위 설명 참고 |
| 자동 허용 상한 | 30 | allow 모드에서 묻지 않고 실행하는 요청 하나의 최대 Anlas |
| 세션 Anlas 상한 | 1000 | 0이면 상한 없음 |
| 한 번에 뽑는 최대 장 수 | 4 | 1~8 |
| 기본 nsfw 가드 | 켜짐 | Full 모델에서 NovelAI 웹처럼 기본 네거티브 앞에 `nsfw`를 붙여, 평범한 프롬프트가 수위 쪽으로 새지 않게 함 |
| 새 버전 알림 | 켜짐 | 하루 한 번 GitHub에서 최신 버전 번호만 확인 |

## 파일

```
저장 폴더/
├─ 2026-10-08/
│   └─ nai_153012_1234567890.png   ← 원본 (NovelAI 메타데이터 그대로)
└─ .nai-vibe/
    ├─ presets.json    ← 프리셋
    ├─ history.jsonl   ← 그림별 설정 (프롬프트, 시드, 모델…)
    └─ ledger.jsonl    ← 요청별 예상 비용 / 실제 차감
```

업데이트하거나 다시 설치해도 이 폴더는 그대로 유지됩니다.

## 업데이트

- 새 버전이 나오면 도구 결과 끝에 한 줄로 알려 드립니다.
- Releases에서 새 `.mcpb`를 내려받아 다시 설치하면 됩니다. 프리셋·기록은 저장 폴더에 있으므로 사라지지 않습니다.

## 다른 앱에서 사용하기

Claude 데스크톱 외에도 **로컬(stdio) MCP**를 지원하는 앱이라면 사용할 수 있습니다. `.mcpb`는 zip 형식이므로 압축을 풀어 `server/index.mjs`를 꺼낸 뒤 Node 18 이상으로 실행하고, 설정은 환경변수로 전달합니다.

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

- **ChatGPT 데스크톱 (Codex 통합 앱)**: 설정 → MCP servers → Add server → STDIO를 선택하고, Command에 `node`, Arguments에 `server/index.mjs` 경로, 환경변수에 `NAI_TOKEN`을 입력합니다.
- **Codex CLI**: `codex mcp add nai-vibe --env NAI_TOKEN=pst-... -- node C:/tools/nai-vibe-mcp/server/index.mjs`
- ChatGPT 웹과 Grok 웹·앱은 인터넷에 공개된(https) 서버만 연결할 수 있어서 현재는 사용할 수 없습니다.
- npm 패키지와 Windows 실행 파일(.exe)은 준비 중입니다.

환경변수: `NAI_TOKEN`, `NAI_OUTPUT_DIR`, `NAI_DEFAULT_MODEL`, `NAI_COST_MODE`, `NAI_ALLOW_MAX`, `NAI_SESSION_LIMIT`, `NAI_MAX_COUNT`, `NAI_NSFW_GUARD`, `NAI_UPDATE_CHECK`

## 자주 묻는 질문

**토큰이 틀렸다고 나옵니다 (401)** — 토큰을 다시 발급해 설정에 입력해 주세요. 앞뒤 공백이 들어가지 않았는지도 확인해 주세요.

**Anlas가 부족하다고 나옵니다 (402)** — 잔액보다 비싼 요청입니다. 크기·스텝을 줄이거나 Anlas를 충전해 주세요.

**잠시 기다리라고 나옵니다 (429)** — NovelAI는 계정당 한 번에 한 장만 생성할 수 있어서, 다른 곳(웹 등)에서 동시에 생성하고 있으면 이 오류가 납니다. 몇 초 기다린 뒤 자동으로 두 번까지 다시 보냅니다.

**예상 비용과 실제 비용이 다릅니다** — 비공식 공식이라 틀릴 수 있습니다. 실제 차감은 `ledger.jsonl`에 기록되니 이슈로 알려 주시면 수정하겠습니다.

**Claude가 그림을 생성해 주지 않습니다** — Claude는 자체 정책에 따라 일부 요청을 거절할 수 있습니다. 이 도구로 바꿀 수 있는 부분이 아닙니다.

**문제 신고** — Claude에게 "nai_about 진단 정보 보여 줘"라고 요청한 뒤, 나온 내용을 이슈에 붙여 주세요 (토큰은 포함되어 있지 않습니다).

## 토큰 취급

- Claude 데스크톱은 확장 프로그램 설정의 민감한 값을 앱에서 따로 보관하고, 서버에는 환경변수로만 전달합니다.
- 서버는 NovelAI(`image.novelai.net`)에 요청할 때만 토큰을 사용합니다. 로그·저장 파일·오류 메시지에는 남기지 않습니다 (테스트로 확인).
- 업데이트 확인은 GitHub에 최신 버전 번호만 조회하며, 토큰이나 사용 기록은 보내지 않습니다.

## 라이선스

MIT

---

## English summary

Unofficial MCP server that lets Claude (and other local MCP clients) generate images with your own NovelAI account. Bring your own Persistent API Token (`pst-...`). Features: cost guard (paid requests need explicit confirmation; Opus-free requests run immediately), named presets, dated output folders, generation history and an Anlas ledger. Install the `.mcpb` in Claude Desktop, enter your token, and ask "check my NovelAI connection". Not affiliated with NovelAI/Anlatan.
