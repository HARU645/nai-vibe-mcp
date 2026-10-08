import { describe, expect, it } from "vitest";
import { scrubSecrets, extractImages } from "../src/api/client.js";
import { buildGenerateBody, parsePosition, varietyPlusSigma } from "../src/api/request.js";
import { loadConfig } from "../src/config.js";
import { accountStateOf, costPerImage, estimateCost } from "../src/cost/cost.js";
import { CostGuard, hashRequest } from "../src/cost/guard.js";
import { MODELS, resolveModel } from "../src/models.js";
import { composeNegative, composePrompt, extractQuoted } from "../src/prompt/compose.js";
import { convertWeightSyntax, joinTags, tidyPrompt } from "../src/prompt/syntax.js";
import { parseSize } from "../src/sizes.js";
import { zipSync } from "fflate";

const m = (key: string) => resolveModel(key)!;

describe("모델 이름", () => {
  it("별명을 받는다", () => {
    expect(resolveModel("v5")?.id).toBe("nai-diffusion-5-full");
    expect(resolveModel("V4.5 Curated")?.id).toBe("nai-diffusion-4-5-curated");
    expect(resolveModel("nai-diffusion-4-5-full")?.key).toBe("v4.5-full");
    expect(resolveModel("v45")?.key).toBe("v4.5-full");
    expect(resolveModel("v3")).toBeUndefined();
  });
  it("V5만 params_version 4", () => {
    for (const model of MODELS) expect(model.paramsVersion).toBe(model.family === "v5" ? 4 : 3);
  });
});

describe("문법 변환", () => {
  it("(tag:1.2) → 1.2::tag::", () => {
    expect(convertWeightSyntax("1girl, (silver hair:1.2), (smile:0.8)")).toBe("1girl, 1.2::silver hair::, 0.8::smile::");
  });
  it("가중치 없는 괄호와 이스케이프는 태그 이름으로 둔다", () => {
    expect(convertWeightSyntax("ych (character), azure \\(capriccio\\)")).toBe("ych (character), azure (capriccio)");
  });
  it("artist: 안의 콜론과 헷갈리지 않는다", () => {
    expect(convertWeightSyntax("(artist:foo:1.3)")).toBe("1.3::artist:foo::");
    expect(convertWeightSyntax("artist:foo")).toBe("artist:foo");
  });
  it("쉼표·공백 정리", () => {
    expect(tidyPrompt(" 1girl ,, solo,  smile , ")).toBe("1girl, solo, smile");
    expect(joinTags("a, b,", undefined, "", " c ")).toBe("a, b, c");
  });
});

describe("프롬프트 조립", () => {
  it("V4.5 Full: 품질 태그를 끝에", () => {
    const r = composePrompt(m("v4.5-full"), "1girl, solo", "standard");
    expect(r.text).toBe("1girl, solo, very aesthetic, masterpiece, no text");
    expect(r.tagHintQt).toBe(1);
  });
  it("이미 있으면 또 안 붙인다", () => {
    const r = composePrompt(m("v4.5-full"), "1girl, very aesthetic, masterpiece, no text", "standard");
    expect(r.text).toBe("1girl, very aesthetic, masterpiece, no text");
  });
  it("light는 V5만, 다른 모델은 standard로", () => {
    expect(composePrompt(m("v5-full"), "1girl", "light").text).toBe("1girl, very aesthetic, amazing quality, no text");
    const r = composePrompt(m("v4.5-full"), "1girl", "light");
    expect(r.qualityApplied).toBe("standard");
  });
  it("off면 안 붙인다", () => {
    expect(composePrompt(m("v5-full"), "1girl", "off").text).toBe("1girl");
  });
  it("V5: 따옴표 글자를 Text 블록으로, 품질 태그는 그 앞", () => {
    const r = composePrompt(m("v5-full"), '1girl, holding sign, sign that says "OPEN"', "standard");
    expect(r.text).toBe('1girl, holding sign, sign that says "OPEN", very aesthetic, masterpiece, no text\nText: OPEN');
  });
  it("사용자가 쓴 Text 블록은 그대로 두고 품질 태그는 앞에", () => {
    const r = composePrompt(m("v5-full"), "1girl, sign\nText: Hello,world", "standard");
    expect(r.text).toBe("1girl, sign, very aesthetic, masterpiece, no text\nText: Hello,world");
  });
  it("V4.5는 Text 블록을 안 만든다", () => {
    expect(composePrompt(m("v4.5-full"), 'sign "OPEN"', "off").text).toBe('sign "OPEN"');
  });
  it("짝 없는 따옴표는 무시", () => {
    expect(extractQuoted('a "b" c "d')).toEqual(["b"]);
    expect(extractQuoted("「안녕」 “hi”")).toEqual(["안녕", "hi"]);
  });
  it("Full 모델: UC 프리셋 앞에 nsfw 가드", () => {
    const r = composeNegative(m("v4.5-full"), "bad hands", "1girl", "heavy");
    expect(r.text.startsWith("nsfw, lowres, artistic error")).toBe(true);
    expect(r.text.endsWith(", bad hands")).toBe(true);
    expect(r.tagHintUc).toBe(2);
  });
  it("프롬프트에 nsfw가 있으면 가드 안 붙임", () => {
    const r = composeNegative(m("v5-full"), "", "1girl, nsfw", "light");
    expect(r.text.startsWith("lowres, bad hands")).toBe(true);
  });
  it("Curated는 nsfw 가드 없음, 없는 프리셋은 heavy로", () => {
    const r = composeNegative(m("v4.5-curated"), "", "1girl", "furry_focus");
    expect(r.ucApplied).toBe("heavy");
    expect(r.text.startsWith("blurry, lowres, upscaled")).toBe(true);
    expect(r.text.includes("nsfw")).toBe(false);
  });
  it("가드를 끄면 nsfw를 안 붙인다", () => {
    const r = composeNegative(m("v4.5-full"), "bad hands", "1girl", "heavy", false);
    expect(r.text.startsWith("lowres, artistic error")).toBe(true);
    expect(r.text.includes("nsfw")).toBe(false);
  });
  it("none이면 사용자 UC만", () => {
    expect(composeNegative(m("v5-full"), "bad hands", "1girl", "none").text).toBe("bad hands");
  });
});

describe("요청 본문", () => {
  const base = {
    prompt: "p",
    negative: "n",
    width: 832,
    height: 1216,
    steps: 23,
    scale: 5,
    sampler: "k_euler_ancestral" as const,
    noiseSchedule: "karras" as const,
    cfgRescale: 0,
    seed: 42,
    varietyPlus: false,
    tagHintQt: 1,
    tagHintUc: 2,
  };
  it("V5: params_version 4, 자유 좌표, use_coords", () => {
    const b = buildGenerateBody({ ...base, model: m("v5-full"), characters: [{ prompt: "a", negative: "", center: { x: 0.23, y: 0.61 } }] }) as any;
    expect(b.model).toBe("nai-diffusion-5-full");
    expect(b.input).toBe("p");
    expect(b.parameters.params_version).toBe(4);
    expect(b.parameters.n_samples).toBe(1);
    expect(b.parameters.use_coords).toBe(true);
    expect(b.parameters.v4_prompt.use_coords).toBe(true);
    expect(b.parameters.v4_prompt.caption.char_captions[0].centers[0]).toEqual({ x: 0.23, y: 0.61 });
    expect(b.parameters.v4_negative_prompt.use_order).toBe(false);
    expect(b.parameters.characterPrompts[0].center).toEqual({ x: 0.23, y: 0.61 });
  });
  it("V4.5: 칸 중심에 맞춤, 위치 없으면 use_coords false", () => {
    const b = buildGenerateBody({ ...base, model: m("v4.5-full"), characters: [{ prompt: "a", negative: "", center: { x: 0.23, y: 0.61 } }] }) as any;
    expect(b.parameters.params_version).toBe(3);
    expect(b.parameters.v4_prompt.caption.char_captions[0].centers[0]).toEqual({ x: 0.3, y: 0.7 });
    const b2 = buildGenerateBody({ ...base, model: m("v4.5-full"), characters: [{ prompt: "a", negative: "" }] }) as any;
    expect(b2.parameters.use_coords).toBe(false);
    expect(b2.parameters.characterPrompts[0].center).toEqual({ x: 0.5, y: 0.5 });
  });
  it("Variety+ 시그마", () => {
    expect(varietyPlusSigma(1024, 1024)).toBeCloseTo(19, 5);
    const b = buildGenerateBody({ ...base, model: m("v5-full"), varietyPlus: true, characters: [] }) as any;
    expect(b.parameters.skip_cfg_above_sigma).toBeGreaterThan(0);
  });
  it("칸 이름", () => {
    expect(parsePosition("C3")).toEqual({ x: 0.5, y: 0.5 });
    expect(parsePosition("a1")).toEqual({ x: 0.1, y: 0.1 });
    expect(parsePosition("F9")).toBeUndefined();
  });
});

describe("크기", () => {
  it("이름·별명·WxH", () => {
    expect(parseSize("portrait")).toEqual({ width: 832, height: 1216 });
    expect(parseSize("세로")).toEqual({ width: 832, height: 1216 });
    expect(parseSize("large portrait")).toEqual({ width: 1024, height: 1536 });
    expect(parseSize("640x640")).toEqual({ width: 640, height: 640 });
  });
  it("64 배수가 아니면 가까운 값을 알려 준다", () => {
    expect(() => parseSize("800x1200")).toThrow(/832|1216|768|1152/);
    expect(() => parseSize("2048x2048")).toThrow(/1600/);
  });
});

describe("비용", () => {
  it("공식: V4.5 ×1.0, V5 ×1.5 (실측값)", () => {
    expect(costPerImage(m("v4.5-full"), 512, 512, 10)).toBe(3);
    expect(costPerImage(m("v4.5-curated"), 512, 512, 10)).toBe(3);
    expect(costPerImage(m("v4.5-full"), 832, 1216, 28)).toBe(20);
    expect(costPerImage(m("v4.5-full"), 512, 768, 23)).toBe(7);
    expect(costPerImage(m("v5-full"), 512, 512, 10)).toBe(5);
    expect(costPerImage(m("v5-curated"), 512, 512, 10)).toBe(5);
    expect(costPerImage(m("v5-full"), 832, 1216, 28)).toBe(30);
    expect(costPerImage(m("v5-full"), 1088, 1088, 28)).toBe(35);
    expect(costPerImage(m("v5-full"), 64, 64, 1)).toBe(2);
  });
  const opus = accountStateOf({ tier: 3, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 10, purchasedTrainingSteps: 5 } });
  const opusV5 = (percent: number, isNegative = false) =>
    accountStateOf({ tier: 3, active: true, usage: { percent, isNegative, timeUntilNextPercent: 7888 } });
  const free = accountStateOf({ tier: 0, active: false, trainingStepsLeft: { purchasedTrainingSteps: 9000 } });
  const expired = accountStateOf({ tier: 3, active: false });

  it("계정 상태", () => {
    expect(opus.opus).toBe(true);
    expect(opus.anlas).toBe(15);
    expect(free.opus).toBe(false);
    expect(expired.opus).toBe(false);
    expect(opusV5(69).v5Allowance).toMatchObject({ percent: 69, empty: false, approxImages: 1194, refillPercentPerDay: 11 });
    expect(opusV5(5, true).v5Allowance?.empty).toBe(true);
  });
  it("Opus V4.5: 조건 안이면 무료, 넘으면 유료", () => {
    expect(estimateCost(m("v4.5-full"), 832, 1216, 28, 2, opus).total).toBe(0);
    expect(estimateCost(m("v4.5-full"), 832, 1216, 29, 1, opus).total).toBe(20);
    expect(estimateCost(m("v4.5-full"), 1088, 1088, 28, 1, opus).total).toBe(23);
  });
  it("Opus V5: 할당량이 있으면 무료, 비었으면 유료", () => {
    expect(estimateCost(m("v5-full"), 832, 1216, 23, 1, opusV5(50)).free).toBe(true);
    expect(estimateCost(m("v5-full"), 832, 1216, 23, 1, opusV5(0)).free).toBe(false);
    expect(estimateCost(m("v5-full"), 832, 1216, 23, 1, opus).free).toBe(false);
    expect(estimateCost(m("v5-full"), 832, 1216, 23, 4, opusV5(0.1)).free).toBe(false);
  });
  it("비구독·만료·계정 모름은 유료", () => {
    expect(estimateCost(m("v4.5-full"), 832, 1216, 23, 3, free).total).toBe(17 * 3);
    expect(estimateCost(m("v4.5-full"), 832, 1216, 23, 1, expired).free).toBe(false);
    expect(estimateCost(m("v4.5-full"), 832, 1216, 23, 1, null).free).toBe(false);
  });
});

describe("비용 가드", () => {
  const est = (total: number, count = 1) => ({ perImage: total / count, count, total, free: total === 0, reason: "test" });

  it("무료면 바로 실행", () => {
    const g = new CostGuard({ mode: "confirm", allowMax: 0, sessionLimit: 100 });
    expect(g.check("h", est(0), undefined, 0).action).toBe("run");
  });
  it("confirm: 번호를 받고, 같은 요청에 한 번만 쓸 수 있다", () => {
    const g = new CostGuard({ mode: "confirm", allowMax: 0, sessionLimit: 0 });
    const d1 = g.check("h1", est(30), undefined, 1000);
    expect(d1.action).toBe("confirm");
    const id = (d1 as { confirmId: string }).confirmId;
    // 다른 요청에 이 번호를 쓰면 실행 안 되고 새 확인을 받는다
    expect(g.check("h2", est(30), id, 1000).action).toBe("confirm");
    // 원래 요청엔 여전히 쓸 수 있다
    expect(g.check("h1", est(30), id, 1000).action).toBe("run");
  });
  it("confirm: 올바른 번호면 실행, 다시 쓰면 새 확인", () => {
    const g = new CostGuard({ mode: "confirm", allowMax: 0, sessionLimit: 0 });
    const d1 = g.check("h", est(30), undefined, 1000) as { confirmId: string };
    expect(g.check("h", est(30), d1.confirmId, 1000).action).toBe("run");
    expect(g.check("h", est(30), d1.confirmId, 1000).action).toBe("confirm");
  });
  it("confirm: 비용이 올랐으면 다시 확인", () => {
    const g = new CostGuard({ mode: "confirm", allowMax: 0, sessionLimit: 0 });
    const d1 = g.check("h", est(30), undefined, 1000) as { confirmId: string };
    expect(g.check("h", est(60, 2), d1.confirmId, 1000).action).toBe("confirm");
  });
  it("confirm: 번호는 시간이 지나면 만료", () => {
    let t = 0;
    const g = new CostGuard({ mode: "confirm", allowMax: 0, sessionLimit: 0, confirmTtlMs: 1000, now: () => t });
    const d1 = g.check("h", est(30), undefined, 1000) as { confirmId: string };
    t = 2000;
    expect(g.check("h", est(30), d1.confirmId, 1000).action).toBe("confirm");
  });
  it("free_only는 유료를 막는다", () => {
    const g = new CostGuard({ mode: "free_only", allowMax: 0, sessionLimit: 0 });
    expect(g.check("h", est(5), undefined, 1000).action).toBe("blocked");
  });
  it("allow: 상한 안이면 바로, 넘으면 확인", () => {
    const g = new CostGuard({ mode: "allow", allowMax: 30, sessionLimit: 0 });
    expect(g.check("h", est(30), undefined, 1000).action).toBe("run");
    expect(g.check("h", est(31), undefined, 1000).action).toBe("confirm");
  });
  it("세션 상한과 잔액 부족은 확인 번호가 있어도 막는다", () => {
    const g = new CostGuard({ mode: "allow", allowMax: 100, sessionLimit: 50 });
    g.record(40);
    expect(g.check("h", est(20), undefined, 1000).action).toBe("blocked");
    const g2 = new CostGuard({ mode: "confirm", allowMax: 0, sessionLimit: 0 });
    const d = g2.check("h", est(30), undefined, 1000) as { confirmId: string };
    expect(g2.check("h", est(30), d.confirmId, 10).action).toBe("blocked");
  });
  it("요청 해시는 키 순서와 상관없다", () => {
    expect(hashRequest({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(hashRequest({ b: [1, { d: 3, c: 2 }], a: 1 }));
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
  });
});

describe("토큰·응답 처리", () => {
  it("토큰을 지운다", () => {
    const t = "pst-abcDEF123456789_-xyz";
    expect(scrubSecrets(`error for ${t} Bearer ${t}`, t)).not.toContain("abcDEF");
    expect(scrubSecrets("Authorization: Bearer eyJhbGciOi.x.y")).toContain("Bearer ***");
  });
  it("zip에서 순서대로 PNG를 꺼낸다", () => {
    const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, n]);
    const zip = zipSync({ "image_1.png": png(1), "image_0.png": png(0) });
    const imgs = extractImages(zip);
    expect(imgs.map((b) => b[4])).toEqual([0, 1]);
  });
  it("zip이 아니고 PNG면 그대로", () => {
    expect(extractImages(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7])).length).toBe(1);
    expect(() => extractImages(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe("설정", () => {
  it("빈 값과 치환 안 된 자리표시자는 기본값", () => {
    const c = loadConfig({ NAI_TOKEN: "", NAI_COST_MODE: "${user_config.cost_mode}", NAI_OUTPUT_DIR: " " });
    expect(c.token).toBeUndefined();
    expect(c.costMode).toBe("confirm");
    expect(c.outputDir).toMatch(/nai-vibe$/);
    expect(c.defaultModel.key).toBe("v4.5-full");
    expect(c.nsfwGuard).toBe(true);
    expect(loadConfig({ NAI_NSFW_GUARD: "false" }).nsfwGuard).toBe(false);
  });
  it("이상한 값은 경고하고 기본값", () => {
    const c = loadConfig({ NAI_COST_MODE: "yolo", NAI_MAX_COUNT: "99", NAI_DEFAULT_MODEL: "v9" });
    expect(c.costMode).toBe("confirm");
    expect(c.maxCount).toBe(4);
    expect(c.warnings.length).toBe(3);
  });
});

describe("리뷰 반영", () => {
  it("이상한 문자가 섞인 토큰도 꼬리가 안 남는다", () => {
    const t = "pst-abc\ndef123456";
    expect(scrubSecrets(`Bearer ${t}`, t)).not.toContain("def123456");
  });
  it("따옴표 안 글자는 정리·변환하지 않는다", () => {
    const r = composePrompt(m("v5-full"), 'sign, "Hello ,  world", "(sale:50)"', "off");
    expect(r.text).toBe('sign, "Hello ,  world", "(sale:50)"\nText: Hello ,  world\n\n(sale:50)');
  });
  it("치환 안 된 ${HOME}은 무시하고 경고", () => {
    const c = loadConfig({ NAI_OUTPUT_DIR: "${HOME}/Pictures/nai-vibe" });
    expect(c.outputDir).not.toContain("${");
    expect(c.warnings.length).toBe(1);
  });
});
