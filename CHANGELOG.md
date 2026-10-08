# 변경 기록

## 0.1.2 — 2026-10-08
- 설정에 "기본 nsfw 가드" 추가 (기본 켜짐). Full 모델에서 NovelAI 웹처럼 기본 네거티브 앞에 `nsfw`를 붙이는 동작을 끌 수 있음

## 0.1.1 — 2026-10-08
- 비용 계산을 실제 차감으로 맞춤: V4.5는 ×1.0, V5는 ×1.5 (전에는 둘 다 ×1.5로 계산해서 V4.5 예상이 비쌌음)
- `nai_account`에 V4.5·V5 예상 비용을 같이 보여 줌
- 결과를 structuredContent로만 보여 주는 앱에서도 안내문이 보이게 `message` 필드 추가

## 0.1.0 — 2026-10-08
- 첫 클로즈드 베타: `nai_generate`, `nai_account`, `nai_preset`, `nai_about`
- 비용 가드(confirm / free_only / allow, 세션 상한), 날짜별 저장, 생성 기록·비용 기록
