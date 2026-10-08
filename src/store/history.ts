// 생성 기록과 Anlas 사용 기록. 둘 다 한 줄에 JSON 하나(jsonl)라서 덧붙이기만 한다.
// - history.jsonl: 그림마다 설정 전부 (나중에 "아까 그거 다시"에 씀)
// - ledger.jsonl: 요청마다 예상 비용과 실제 잔액 차이 (비용 공식 검증용)

import { promises as fs } from "node:fs";
import path from "node:path";
import { appendLine, dataDir } from "./files.js";

export interface HistoryEntry {
  id: string;
  time: string;
  file: string;
  model: string;
  /** 사용자가 준 프롬프트 (프리셋 합친 뒤, 품질 태그 붙이기 전) */
  prompt: string;
  negative: string;
  /** 실제로 보낸 최종 프롬프트·UC */
  finalPrompt: string;
  finalNegative: string;
  presets: string[];
  width: number;
  height: number;
  steps: number;
  scale: number;
  sampler: string;
  seed: number;
  quality: string;
  ucPreset: string;
  varietyPlus: boolean;
  characters: Array<{ prompt: string; negative: string; center?: { x: number; y: number } }>;
  estimatedAnlas: number;
}

export interface LedgerEntry {
  time: string;
  model: string;
  width: number;
  height: number;
  steps: number;
  count: number;
  generated: number;
  estimated: number;
  anlasBefore: number | null;
  anlasAfter: number | null;
  /** 잔액 차이 (못 읽었으면 null) */
  actual: number | null;
  opus: boolean | null;
  note?: string;
}

export class HistoryStore {
  constructor(private readonly outputDir: string) {}

  private get historyFile(): string {
    return path.join(dataDir(this.outputDir), "history.jsonl");
  }
  private get ledgerFile(): string {
    return path.join(dataDir(this.outputDir), "ledger.jsonl");
  }

  addImage(e: HistoryEntry): Promise<void> {
    return appendLine(this.historyFile, e);
  }

  addLedger(e: LedgerEntry): Promise<void> {
    return appendLine(this.ledgerFile, e);
  }

  /** 최근 n개 (새것부터). 깨진 줄은 건너뛴다 */
  async recent(n: number): Promise<HistoryEntry[]> {
    let text: string;
    try {
      text = await fs.readFile(this.historyFile, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const out: HistoryEntry[] = [];
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
      const line = lines[i]!.trim();
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as HistoryEntry);
      } catch {
        /* 깨진 줄 */
      }
    }
    return out;
  }
}
