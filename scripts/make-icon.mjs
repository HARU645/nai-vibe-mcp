// 확장 아이콘(icon.png, 512x512)을 코드로 그린다. NovelAI 로고는 쓰지 않는다.
// 둥근 사각형 보라→분홍 그라데이션 위에 흰 반짝이 별 하나.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

const S = 512;
const K = S / 256; // 256 기준으로 잡은 좌표를 늘리는 배율
const png = new PNG({ width: S, height: S });
const R = 56 * K; // 모서리 반지름
const mix = (a, b, t) => Math.round(a + (b - a) * t);

function insideRounded(x, y) {
  const cx = Math.min(Math.max(x, R), S - 1 - R);
  const cy = Math.min(Math.max(y, R), S - 1 - R);
  return (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
}

// 4갈래 반짝이: |dx|^p + |dy|^p 꼴의 별 모양
function sparkle(x, y, cx, cy, r) {
  const dx = Math.abs(x - cx) / r;
  const dy = Math.abs(y - cy) / r;
  return Math.sqrt(dx) + Math.sqrt(dy) <= 1;
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    // 4배 슈퍼샘플링으로 가장자리 부드럽게
    let cover = 0;
    let star = 0;
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        const px = x + (sx + 0.5) / 4;
        const py = y + (sy + 0.5) / 4;
        if (insideRounded(px, py)) cover++;
        if (sparkle(px, py, 128 * K, 124 * K, 88 * K) || sparkle(px, py, 190 * K, 64 * K, 26 * K)) star++;
      }
    }
    const t = (x + y) / (2 * S);
    let r = mix(124, 236, t);
    let g = mix(92, 120, t);
    let b = mix(230, 178, t);
    const s = star / 16;
    r = mix(r, 255, s);
    g = mix(g, 255, s);
    b = mix(b, 255, s);
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = Math.round((cover / 16) * 255);
  }
}

writeFileSync(new URL("../icon.png", import.meta.url), PNG.sync.write(png));
console.log("icon.png written");
