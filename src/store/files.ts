// 저장 폴더 아래 파일 다루기. 프리셋·기록은 `<저장 폴더>/.nai-vibe/`에 둔다 (업데이트해도 안 날아가게).

import { promises as fs } from "node:fs";
import path from "node:path";

export function dataDir(outputDir: string): string {
  return path.join(outputDir, ".nai-vibe");
}

/** 쓰다가 끊겨도 파일이 반쯤 깨지지 않게 임시 파일에 쓰고 이름을 바꾼다 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  // Windows에서 OneDrive·백신이 파일을 잡고 있으면 rename이 잠깐 실패할 수 있다 → 몇 번 다시
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt < 5 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        continue;
      }
      // 마지막 수단: 직접 덮어쓰고 임시 파일은 정리
      await fs.writeFile(file, data);
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      return;
    }
  }
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`${path.basename(file)} 파일을 읽지 못했어: ${(e as Error).message}`);
  }
}

export async function appendLine(file: string, obj: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(obj)}\n`, "utf8");
}

export function localDateParts(d = new Date()): { date: string; time: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`,
  };
}

/** 같은 이름이 있으면 _2, _3…을 붙여서 덮어쓰지 않고 새 파일로 저장한다. 저장한 경로를 돌려준다 */
export async function writeNewFile(dir: string, base: string, ext: string, data: Uint8Array): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  for (let i = 1; i < 10_000; i++) {
    const p = path.join(dir, i === 1 ? `${base}${ext}` : `${base}_${i}${ext}`);
    try {
      await fs.writeFile(p, data, { flag: "wx" });
      return p;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error("저장할 파일 이름을 만들지 못했어.");
}
