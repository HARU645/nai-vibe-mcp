// 사용자 프리셋: 아티스트/화풍, 캐릭터, 의상, 장면, 해상도 등을 이름으로 저장해 두고 생성할 때 불러 쓴다.
// 파일: <저장 폴더>/.nai-vibe/presets.json

import path from "node:path";
import { z } from "zod";
import { dataDir, readJson, writeFileAtomic } from "./files.js";

export const PRESET_KINDS = ["style", "character", "outfit", "scene", "size", "other"] as const;
export type PresetKind = (typeof PRESET_KINDS)[number];

export interface PresetCharacter {
  prompt: string;
  negative?: string;
  position?: string | { x: number; y: number };
}

export interface Preset {
  kind: PresetKind;
  /** 프롬프트 앞에 붙는 태그 */
  prompt?: string;
  /** 네거티브에 더해지는 태그 */
  negative?: string;
  model?: string;
  size?: string;
  steps?: number;
  scale?: number;
  sampler?: string;
  characters?: PresetCharacter[];
  note?: string;
  created: string;
  updated: string;
}

interface PresetFile {
  schema: 1;
  presets: Record<string, Preset>;
}

const SCHEMA = 1;
const RESERVED_NAMES = new Set(["__proto__", "constructor", "prototype"]);

/** presets.json을 손으로 고쳤을 때 이상한 값이 NovelAI로 그대로 가지 않게 쓸 때마다 검사한다 */
const presetSchema = z.object({
  kind: z.enum(PRESET_KINDS),
  prompt: z.string().optional(),
  negative: z.string().optional(),
  model: z.string().optional(),
  size: z.string().optional(),
  steps: z.number().int().min(1).max(50).optional(),
  scale: z.number().min(0).max(10).optional(),
  sampler: z.string().optional(),
  characters: z
    .array(
      z.object({
        prompt: z.string().min(1),
        negative: z.string().optional(),
        position: z.union([z.string(), z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })]).optional(),
      }),
    )
    .optional(),
  note: z.string().optional(),
  created: z.string(),
  updated: z.string(),
});

function checkPreset(name: string, p: unknown): Preset {
  const r = presetSchema.safeParse(p);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new Error(`"${name}" 프리셋 값이 올바르지 않습니다 (${issue?.path.join(".") || "?"}: ${issue?.message}). nai_preset으로 다시 저장해 주세요.`);
  }
  return r.data;
}

export function normalizePresetName(name: string): string {
  const n = name.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!n) throw new Error("프리셋 이름이 비어 있습니다.");
  if (n.length > 60) throw new Error("프리셋 이름은 60자까지만 쓸 수 있습니다.");
  if (RESERVED_NAMES.has(n.toLowerCase())) throw new Error(`"${n}"은(는) 프리셋 이름으로 쓸 수 없습니다.`);
  return n;
}

export class PresetStore {
  constructor(private readonly outputDir: string) {}

  private get file(): string {
    return path.join(dataDir(this.outputDir), "presets.json");
  }

  private async load(): Promise<PresetFile> {
    const data = await readJson<PresetFile>(this.file);
    if (!data) return { schema: SCHEMA, presets: Object.create(null) };
    if (data.schema !== SCHEMA || typeof data.presets !== "object" || data.presets === null) {
      throw new Error(`presets.json 형식(schema ${String(data.schema)})을 알 수 없습니다. 새 버전으로 업데이트해 주세요.`);
    }
    // 프로토타입 없는 객체로 옮겨 담는다 (__proto__ 같은 키 문제 방지)
    const presets: Record<string, Preset> = Object.create(null);
    for (const [k, v] of Object.entries(data.presets)) if (!RESERVED_NAMES.has(k.toLowerCase())) presets[k] = v;
    return { schema: SCHEMA, presets };
  }

  async list(): Promise<Array<{ name: string } & Preset>> {
    const data = await this.load();
    return Object.entries(data.presets)
      .map(([name, p]) => ({ name, ...p }))
      .sort((a, b) => String(a.kind ?? "").localeCompare(String(b.kind ?? "")) || a.name.localeCompare(b.name));
  }

  /** 이름은 대소문자·앞뒤 공백 무시하고 찾는다 */
  async get(name: string): Promise<({ name: string } & Preset) | undefined> {
    const data = await this.load();
    const key = this.findKey(data, name);
    return key ? { name: key, ...checkPreset(key, data.presets[key]) } : undefined;
  }

  async save(name: string, fields: Omit<Preset, "created" | "updated">): Promise<{ created: boolean; name: string }> {
    const data = await this.load();
    const n = normalizePresetName(name);
    const existingKey = this.findKey(data, n);
    const now = new Date().toISOString();
    const prev = existingKey ? data.presets[existingKey] : undefined;
    if (existingKey && existingKey !== n) delete data.presets[existingKey];
    data.presets[n] = { ...fields, created: prev?.created ?? now, updated: now };
    await writeFileAtomic(this.file, JSON.stringify(data, null, 2));
    return { created: !prev, name: n };
  }

  async delete(name: string): Promise<boolean> {
    const data = await this.load();
    const key = this.findKey(data, name);
    if (!key) return false;
    delete data.presets[key];
    await writeFileAtomic(this.file, JSON.stringify(data, null, 2));
    return true;
  }

  private findKey(data: PresetFile, name: string): string | undefined {
    const want = name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
    return Object.keys(data.presets).find((k) => k.toLowerCase() === want);
  }
}
