// 새 버전 알림. 하루에 한 번 GitHub 최신 릴리스 번호만 확인한다 (보내는 정보 없음, 끌 수 있음).

import path from "node:path";
import { dataDir, readJson, writeFileAtomic } from "./store/files.js";
import { GITHUB_REPO, VERSION } from "./version.js";

interface UpdateCache {
  checkedAt: number;
  latest?: string;
  url?: string;
}

const DAY = 24 * 60 * 60 * 1000;

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export class UpdateChecker {
  private memo: UpdateCache | undefined;
  private inflight: Promise<void> | undefined;

  constructor(
    private readonly outputDir: string,
    private readonly enabled: boolean,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get file(): string {
    return path.join(dataDir(this.outputDir), "update.json");
  }

  /** 하루가 지났으면 백그라운드로 확인. 기다리지 않는다 */
  poke(): void {
    if (!this.enabled || !GITHUB_REPO || this.inflight) return;
    this.inflight = this.check(false).finally(() => {
      this.inflight = undefined;
    });
  }

  async check(force: boolean): Promise<void> {
    if (!this.enabled || !GITHUB_REPO) return;
    const cache = this.memo ?? (await readJson<UpdateCache>(this.file).catch(() => undefined));
    if (cache) this.memo = cache;
    if (!force && cache && Date.now() - cache.checkedAt < DAY) return;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5_000);
      const res = await this.fetchImpl(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "nai-vibe-mcp" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const next: UpdateCache = { checkedAt: Date.now() };
      if (res.ok) {
        const j = (await res.json()) as { tag_name?: string; html_url?: string };
        if (j.tag_name) {
          next.latest = j.tag_name;
          next.url = j.html_url;
        }
      }
      this.memo = next;
      await writeFileAtomic(this.file, JSON.stringify(next));
    } catch {
      // 오프라인 등은 조용히 넘어간다
    }
  }

  /** 새 버전이 있으면 한 줄 안내, 없으면 undefined */
  notice(): string | undefined {
    const m = this.memo;
    if (!m?.latest || compareVersions(m.latest, VERSION) <= 0) return undefined;
    return `📦 새 버전이 나왔습니다: nai-vibe-mcp ${m.latest} (현재 v${VERSION}). 받는 곳: ${m.url ?? `https://github.com/${GITHUB_REPO}/releases`}`;
  }

  get latest(): string | undefined {
    return this.memo?.latest;
  }
}
