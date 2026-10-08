// 비교 시트 기록. "아까 시트 3번 저장해 줘"처럼 번호로 다시 쓰려고 남긴다.
// 파일: <저장 폴더>/.nai-vibe/sheets.jsonl (한 줄에 시트 하나)

import { promises as fs } from "node:fs";
import path from "node:path";
import { appendLine, dataDir } from "./files.js";

export interface SheetVariant {
  /** 시트에 찍힌 번호 (1부터) */
  n: number;
  label: string;
  /** 이 칸에만 들어간 태그 (화풍·아티스트 조합 등) */
  prompt: string;
  /** 저장된 원본 그림 (생성 실패면 없음) */
  file?: string;
  /** 칸 태그 없는 기준 칸 */
  baseline?: boolean;
}

export interface SheetRecord {
  /** YYYY-MM-DD_HHmmss */
  id: string;
  time: string;
  dir: string;
  sheetFile?: string;
  model: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  /** 모든 칸에 공통으로 들어간 프롬프트 */
  basePrompt: string;
  presets: string[];
  variants: SheetVariant[];
}

export class SheetStore {
  constructor(private readonly outputDir: string) {}

  private get file(): string {
    return path.join(dataDir(this.outputDir), "sheets.jsonl");
  }

  add(rec: SheetRecord): Promise<void> {
    return appendLine(this.file, rec);
  }

  /** 새것부터 n개. 깨진 줄은 건너뛴다 */
  async recent(n: number): Promise<SheetRecord[]> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const out: SheetRecord[] = [];
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
      const line = lines[i]!.trim();
      if (!line) continue;
      try {
        const r = JSON.parse(line) as SheetRecord;
        if (r && typeof r.id === "string" && Array.isArray(r.variants)) out.push(r);
      } catch {
        /* 깨진 줄 */
      }
    }
    return out;
  }

  /**
   * id를 안 주면 그림이 한 장이라도 나온 가장 최근 시트.
   * id는 전체(2026-10-08_153012), 시각 부분(153012), 폴더 이름(compare_153012)으로 찾는다
   */
  async get(id?: string): Promise<SheetRecord | undefined> {
    const all = await this.recent(500);
    if (!id) return all.find((r) => r.variants.some((v) => v.file));
    const want = id.trim().replace(/^compare_/, "");
    return all.find((r) => r.id === want) ?? all.find((r) => r.id.endsWith(`_${want}`));
  }
}
