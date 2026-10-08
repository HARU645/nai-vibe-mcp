# NAI 이미지 API 노트

2026-10-08 조사. NovelAI는 공식 API 문서를 거의 안 내놔서, 공개된 클라이언트 3개의 소스를 대조해서 정리함. **"확인됨"은 두 곳 이상이 같거나 실제 과금으로 확인된 것, "불확실"은 실테스트로 정해야 하는 것.** 실테스트 결과가 나오면 이 문서를 고친다.

## 0. 출처

| 이름 | 버전 / 날짜 | 언어 | 비고 |
|---|---|---|---|
| novelai-sdk (PyPI, caru-ini) | 0.14.1 / 2026-09-05 | Python | V5 지원. 비용 함수 `utils/anlas.py` |
| NekoAI-JS (Nya-Foundation) | 1.3.0, 커밋 61c1777 / 2026-07-17 | TypeScript | V4.5까지만, V5 없음. 모델별 품질 태그·UC 표 |
| MooshieUI NovelAI 백엔드 | 커밋 14a7ca6 / 2026-10-08 | Rust + TS | V5 지원. 품질 태그·UC를 novelai.net 웹 클라이언트 번들에서 옮겼다고 밝힘. 실제 과금 2건으로 비용 공식 확인. `docs/NOVELAI.md`에 상세 기록 |
| NovelAI 공식 문서 | docs.novelai.net | — | 품질 태그(`/image/qualitytags`), UC(`/image/undesiredcontent`), 구독·Anlas, Opus 무료 조건 |
| HF space P01yH3dr0n/client | utils.py | Python | 옛 비용 공식 (SDK와 같은 계수) |

## 1. 호스트와 인증

- 이미지 호스트 `https://image.novelai.net`
  - `POST /ai/generate-image` — 생성 (응답: zip) ← **우리가 쓸 것**
  - `POST /ai/generate-image-stream` — 생성 + 중간 단계 (msgpack 스트림)
  - `GET /user/subscription` — 구독·잔액·V5 할당량. **이제 이미지 호스트에 있음** (api.novelai.net의 `/user/*`는 "이미지 URL로 바꾸라"는 400을 돌려준다고 SDK·MooshieUI 둘 다 기록) — 확인됨
  - `POST /ai/generate-image/suggest-tags` — 태그 추천
  - `POST /ai/encode-vibe`, `POST /ai/augment-image`(디렉터 도구) — 나중 단계
- `POST /ai/upscale` — 호스트가 출처마다 다름 (SDK: image, MooshieUI 코드: api.novelai.net). 나중 단계라 그때 확인
- 인증: `Authorization: Bearer pst-...` (Persistent API Token 그대로) + `Content-Type: application/json` — 확인됨
- 헤더: NekoAI-JS·HF space는 `Origin/Referer: https://novelai.net`과 브라우저 User-Agent를 붙이지만, SDK·MooshieUI는 안 붙이고도 동작 → **우리는 안 붙임** (계획서 11장 약관 항목)
- 동시 요청은 계정당 1개. 겹치면 429 — 확인됨

## 2. 모델 id

| 모델 | id | 인페인트 id | params_version | 캐릭터 최대 |
|---|---|---|---|---|
| V5 Full | `nai-diffusion-5-full` | `nai-diffusion-5-full-inpainting` | **4** | 22 (발표 기준, API 한도는 불확실) |
| V5 Curated | `nai-diffusion-5-curated` | 아직 없음 → 웹도 `nai-diffusion-4-5-curated-inpainting`을 대신 씀 | **4** | 22 |
| V4.5 Full | `nai-diffusion-4-5-full` | `…-4-5-full-inpainting` | 3 | 6 |
| V4.5 Curated | `nai-diffusion-4-5-curated` | `…-4-5-curated-inpainting` | 3 | 6 |
| V4 Full | `nai-diffusion-4-full` | `…-4-full-inpainting` | 3 | 6 |
| V4 Curated | **불확실**: SDK `nai-diffusion-4-curated`, NekoAI-JS `nai-diffusion-4-curated-preview` | `…-4-curated-inpainting` | 3 | 6 |

- V5는 `params_version: 4`가 아니면 요청은 받지만 캐릭터 위치를 조용히 버림 (MooshieUI가 겪고 고침, SDK도 4) — 확인됨
- v1은 V5 둘 + V4.5 둘만 지원하고, V4·V3는 안 넣음

## 3. 요청 본문 (txt2img)

```jsonc
{
  "input": "<최종 프롬프트 = v4_prompt.base_caption과 같은 문자열>",
  "model": "nai-diffusion-4-5-full",
  "action": "generate",              // img2img, infill(인페인트)
  "parameters": {
    "params_version": 3,             // V5는 4
    "width": 832, "height": 1216,    // 64의 배수
    "steps": 28, "scale": 5, "sampler": "k_euler_ancestral",
    "noise_schedule": "karras", "cfg_rescale": 0,
    "seed": 123456789, "n_samples": 1,
    "skip_cfg_above_sigma": null,    // Variety+ 켜면 숫자 (아래)
    "tag_hint_qt": 1,                // 품질 태그 프리셋 번호 (아래 표)
    "tag_hint_uc_preset": 2,         // UC 프리셋 번호 (아래 표)
    "negative_prompt": "<최종 UC>",
    "use_coords": false,
    "v4_prompt": {
      "caption": { "base_caption": "<최종 프롬프트>", "char_captions": [] },
      "use_coords": false, "use_order": true, "legacy_uc": false
    },
    "v4_negative_prompt": {
      "caption": { "base_caption": "<최종 UC>", "char_captions": [] },
      "use_coords": false, "use_order": false, "legacy_uc": false
    },
    "characterPrompts": [],
    "legacy": false, "legacy_v3_extend": false, "legacy_uc": false,
    "prefer_brownian": true, "deliberate_euler_ancestral_bug": false,
    "dynamic_thresholding": false, "controlnet_strength": 1,
    "add_original_image": false
  }
}
```

- 값 범위 (SDK 검증 기준): width·height 64~1600, 64의 배수 / steps 1~50 / scale 0~10 / n_samples 1~8. NekoAI-JS에는 1920x1088 "wallpaper" 크기도 있어서 최대치는 불확실 → v1은 SDK 범위로 막음
- 샘플러: `k_euler_ancestral`(웹 기본), `k_euler`, `k_dpmpp_2s_ancestral`, `k_dpmpp_2m`, `k_dpmpp_sde`, `k_dpmpp_2m_sde`. 노이즈 스케줄: `karras`(기본), `exponential`, `polyexponential`
- 웹 기본값 (MooshieUI 위키): 23스텝, scale 7.0, Euler Ancestral, Karras, cfg_rescale 0. SDK 기본은 scale 5.0 → 모델별로 실테스트 후 정함
- `ucPreset`·`qualityToggle` 옛 필드: SDK는 아직 보내지만, MooshieUI는 지금 웹 클라이언트가 이 둘 대신 `tag_hint_qt`·`tag_hint_uc_preset`을 보낸다고 기록. 어느 쪽이든 서버는 태그를 **안 붙여 줌** → 우리는 tag_hint만 보냄
- `input`: SDK는 품질 태그 없는 원래 프롬프트, MooshieUI는 최종 프롬프트를 넣음 → 웹과 같게 최종 프롬프트 (실테스트에서 PNG 메타데이터와 대조)
- `use_new_shared_trial: true`: SDK만 최상위에 넣음. 무료 체험 관련으로 보이지만 의미 불확실 → 안 넣고 시작, 비구독 계정에서 문제 생기면 시험
- Variety+: SDK는 고정 58, MooshieUI는 웹 클라이언트를 따라 `19 * sqrt((w/8)*(h/8) / (128*128))` → 후자를 씀
- 캐릭터 (V4 이상)
  - `v4_prompt.caption.char_captions[]`: `{char_caption, centers:[{x,y}]}`, 부정은 `v4_negative_prompt` 쪽에 같은 순서로
  - `characterPrompts[]`: `{prompt, uc, center:{x,y}, enabled:true}`도 같이 보냄 (두 출처 모두)
  - 좌표는 0~1. V4.x는 5x5 칸 중심(0.1, 0.3, 0.5, 0.7, 0.9)에 맞춰야 함, V5는 자유 좌표
  - 위치를 하나라도 지정하면 `use_coords: true`(파라미터와 v4_prompt 둘 다), 아니면 false = "AI가 정함"
  - V5는 캐릭터가 1명이면 위치를 무시하고 가운데 둠 (웹도 같음) — 확인됨

## 4. 프롬프트 조립 (클라이언트가 해야 함)

서버는 품질 태그·UC 프리셋을 안 붙임. 웹 클라이언트가 보내기 전에 붙인다. — 확인됨 (MooshieUI·NekoAI-JS·공식 문서)

### 4-1. 품질 태그 (프롬프트 **끝**에 `, ` + 태그)

| 모델 | Standard (tag_hint_qt 1) | Light (tag_hint_qt 3, V5만) |
|---|---|---|
| V5 Full·Curated | `very aesthetic, masterpiece, no text` | `very aesthetic, amazing quality, no text` |
| V4.5 Full | 공식 문서 `location, very aesthetic, masterpiece, no text` / 웹 클라이언트 `very aesthetic, masterpiece, no text` (MooshieUI) | — |
| V4.5 Curated | `location, masterpiece, no text, -0.8::feet::, rating:general` | — |
| V4 Full | `no text, best quality, very aesthetic, absurdres` | — |

- 끄면 tag_hint_qt 0
- V5 `Text:` 블록이 있으면 품질 태그는 그 **앞**에 (Text 블록은 항상 맨 끝)
- 이미 같은 태그가 들어 있으면 또 붙이지 않음

### 4-2. UC 프리셋 (사용자 UC **앞**에 + `, `)

tag_hint_uc_preset 번호: 0 없음 / 2 Heavy / 3 Light / 4 Human Focus / 5 Furry Focus (1은 품질 태그 Standard용, 6~8은 옛 프리셋)

- V5 Heavy·V4.5 Full Heavy: `lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page`
- V5 Light: `lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::`
- V4.5 Full Light: `lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page`
- V5·V4.5 Full Human Focus: Heavy + `, @_@, mismatched pupils, glowing eyes, bad anatomy`
- V4.5 Curated (NekoAI-JS): Heavy `blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page` / Light `blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page` / Human Focus는 Heavy에 `bad anatomy, bad hands`, `@_@, mismatched pupils, glowing eyes`가 중간중간 끼어 있는 형태 (순서가 달라서 구현할 땐 NekoAI-JS 원문 그대로 복사)
- 문자열은 MooshieUI(웹 번들에서 옮김)·NekoAI-JS 기준. 1단계 구현할 때 공식 UC 문서 원문과 한 번 더 대조
- **`nsfw` 가드**: 웹 클라이언트는 Full 모델에서 UC 프리셋이 켜져 있고 프롬프트·UC 어디에도 `nsfw`가 없으면 UC 맨 앞에 `nsfw, `를 붙임 (Curated는 원래 SFW라 안 붙임). 공식 UC 문서 표에는 nsfw가 없고, NekoAI-JS는 V4.5 프리셋 문자열 안에 넣어 둠 → 결과는 같음. 우리도 웹과 같게

### 4-3. 그 밖의 문법

- 가중치: `1.2::tag::` (음수도 됨, 예 `-0.8::feet::`), `{tag}` ×1.05, `[tag]` ÷1.05. ComfyUI식 `(tag:1.2)` → `1.2::tag::`로 변환
- 아티스트: 보통 `artist:이름`으로 씀. **MooshieUI는 보내기 전에 `artist:` 접두어를 지움** (단부루 학습 데이터엔 맨 이름만 있어서 토큰 낭비라는 주장). 공식 근거는 못 찾음 → 그대로 보내고, 실테스트에서 같은 시드로 비교 (불확실)
- V5 글씨: 따옴표 안 글자를 프롬프트 끝 `Text: …` 블록으로 모으면 그려 줌. 사용자가 직접 `Text:` 줄을 쓰면 자동 변환 안 함. 여러 조각은 빈 줄로 구분
- V5 투명 배경: 요청 필드가 아니라 프롬프트 태그 (MooshieUI의 `TRANSPARENCY_TAG`). V5만 실제 알파가 나옴. v1에선 안 다룸

## 5. 응답

- `/ai/generate-image`: **zip**, 장마다 `image_0.png`, `image_1.png`… — 확인됨. 일부 클라이언트는 zip이 아니면 그대로 PNG로 읽음 (대비만 해 둠)
- 스트림(`/ai/generate-image-stream`, `parameters.stream: "msgpack"`): SSE가 아님. `[u32 빅엔디언 길이][msgpack]` 프레임 반복, `event_type` intermediate/final/error, `image`(바이너리), `samp_ix`, `step_ix`. zip 엔드포인트에 `stream`을 넣으면 안 됨. v1은 안 씀
- PNG 메타데이터: tEXt `Software`(NovelAI 표시), `Source`(모델 버전), `Comment`(요청 파라미터 JSON) + 알파 채널에 숨긴 사본. 다시 뽑기는 우리 기록 파일을 1순위로, `Comment`를 2순위로

## 6. 오류

| 코드 | 뜻 | 우리 처리 |
|---|---|---|
| 400 | 요청 잘못됨 | 메시지 그대로 보여주고 재시도 안 함 |
| 401 | 토큰 틀림 | "토큰 확인" 안내 |
| 402 | Anlas 부족 / 구독 필요 | 잔액과 예상 비용을 같이 보여줌 |
| 409 | 충돌 | 재시도 안 함 |
| 429 | 동시 요청·속도 제한 | 몇 초 기다렸다 최대 2번 재시도 |
| 5xx | 서버 오류 | 재시도 안 하고 알림 (과금됐을 수 있음 → 잔액 다시 확인) |

- **요청이 서버에 닿은 뒤엔 자동 재시도 안 함.** 타임아웃이 짧으면 Anlas만 나가고 그림은 못 받을 수 있음 (ComfyUI_NAIDGenerator 경고) → 타임아웃 넉넉히(180초), 실패하면 생성 전후 잔액을 비교해서 알려줌

## 7. 계정 (`GET /user/subscription`)

```jsonc
{
  "tier": 3,                 // 0 Paper, 1 Tablet, 2 Scroll, 3 Opus
  "active": true,
  "expiresAt": 1790000000,   // 초
  "trainingStepsLeft": { "fixedTrainingStepsLeft": 10000, "purchasedTrainingSteps": 0 },  // 합 = Anlas 잔액
  "perks": { "unlimitedImageGeneration": true, "unlimitedImageGenerationLimits": [{ "resolution": 1048576, "maxPrompts": 1 }], ... },
  "usage": { "percent": 69, "isNegative": false, "timeUntilNextPercent": 7888 }   // Opus V5 할당량
}
```

- Opus 판정: `active && tier >= 3` (구독이 끝나면 tier가 남아 있어도 active가 false) — MooshieUI. `perks.unlimitedImageGeneration`도 같이 봄
- V5 할당량 (`usage`): `percent`는 **남은** 양(웹이 "Opus 생성 남은 %"로 표시). `isNegative`면 다 씀. 회복은 `timeUntilNextPercent`초마다 1% (위 예시면 하루 약 11%). 1% ≈ 17.3장 (웹이 쓰는 환산). 보너스로 100%를 넘을 때도 있음 — 확인됨 (MooshieUI가 실제 응답으로 확인)
- 비구독 계정 응답은 아직 아무 출처에도 없음 → 실테스트 1번

## 8. 비용

```
px    = max(width * height, 65536)
base  = ceil(2.951823174884865e-6 * px + 5.753298233447344e-7 * px * steps)
1장   = max(ceil(base * 1.5 * strength), 2)      // strength: txt2img는 1
```

- 계수 두 개는 세 출처가 같음 (웹 클라이언트 비용 함수에서 나온 값)
- **×1.5는 MooshieUI에만 있음.** SDK·NekoAI-JS에는 없음. MooshieUI는 실제 과금 두 건으로 맞췄다고 기록: 1088x1088 28스텝 → 35, 832x1216 29스텝 → 30 (×1.5 없으면 23, 20). 같은 문서의 "모르는 것" 목록에는 아직 미확인이라고 적혀 있어서, **우리 실테스트 1순위**
- 무료(Opus): `Opus && px ≤ 1,048,576 && steps ≤ 28 && txt2img` 이면 0. 여러 장(n_samples > 1)이면 SDK·NekoAI-JS는 첫 장만 무료, 공식 문서는 "여러 장은 항상 Anlas" → 우리는 항상 1장씩 보내서 이 차이를 피함
- V5: Opus여도 `usage`가 비었으면(`isNegative` 또는 `percent <= 0`) 무료 아님
- 비구독 (개발자 계정 포함): 전부 유료
- 장당 상한 140 (SDK, 넘으면 요청 거부)
- 비용 조회 API는 없음. 생성 전후 잔액 차이로 검증

| 크기 · 스텝 | ×1.0 | ×1.5 |
|---|---|---|
| 512x512 · 10 | 3 | 5 |
| 512x768 · 28 | 8 | 12 |
| 832x1216 · 23 (웹 기본) | 17 | 26 |
| 832x1216 · 28 | 20 | 30 |
| 1024x1024 · 28 | 20 | 30 |
| 1088x1088 · 28 | 23 | 35 |
| 1024x1536 · 28 | 30 | 45 |

→ ×1.5가 맞으면 Anlas 10,000으로 일반 크기 약 330장 (×1.0이면 약 500장)

## 9. 실테스트 목록 (개발자 계정, Anlas 사용)

순서대로. 형식 확인은 512x512·10스텝(5 Anlas 안팎)으로.

1. `/user/subscription` — 비구독 계정의 tier·active·잔액·usage 모양 (무료)
2. 비구독 계정으로 V4.5 Full 1장 생성 → 되는지, 잔액 차이로 ×1.0/×1.5 판정
3. 같은 설정으로 V5 Full 1장 → V5도 같은 공식인지
4. 832x1216·28스텝 1장 (V4.5, V5 각각) → 일반 크기 비용 확정
5. zip 엔트리 이름, PNG `Comment` 안의 `input`/프롬프트가 우리가 보낸 것과 같은지
6. V4 Curated id 둘 중 어느 쪽이 되는지 (400이면 과금 없음)
7. `artist:` 접두어 있음/없음 같은 시드 비교 (2장)
8. 429: 일부러 두 요청을 겹쳐 보내지는 않음 (약관 취지). 우리 큐가 한 번에 하나만 보내는지만 확인

예상 사용량: 1~8 합쳐서 약 150 Anlas. 이후 1단계 기능 확인에 300~500 정도.

### Opus 테스터만 확인 가능

- V4.5 무료 판정이 맞는지 (잔액이 안 줄어드는지)
- V5 `usage` 차감·회복 속도, 다 썼을 때 과금
- 29스텝·1MP 초과에서 과금되는지

## 10. 설계 결론 (1단계에 반영)

- 생성은 `/ai/generate-image` zip 하나만. 스트림은 나중
- 브라우저 흉내 헤더 안 붙임
- 품질 태그·UC·nsfw 가드는 우리가 웹과 같게 조립하고 `tag_hint_*`만 보냄
- `n_samples`는 항상 1. 여러 장은 순서대로 한 장씩, 큐는 한 번에 하나
- 요청이 나간 뒤엔 자동 재시도 없음 (429만 예외). 생성 전후 잔액을 기록
- 비용 공식은 `src/cost/`에 표 하나로 두고 ×1.5 같은 계수를 모델별로 바꿀 수 있게 (V5 정책이 바뀔 때 대비)
- v1 모델: V5 Full·Curated, V4.5 Full·Curated
