// 대화에 붙일 작은 미리보기 JPEG. 원본 PNG(1MB 넘음)를 그대로 넣으면 대화가 금방 무거워져서 줄여서 보낸다.
// 네이티브 모듈 없이 순수 JS(pngjs, jpeg-js)만 써서 어느 OS에서나 돈다.

import { PNG } from "pngjs";
import jpeg from "jpeg-js";

export interface Preview {
  data: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

export interface Rgba {
  data: Uint8Array;
  width: number;
  height: number;
}

/** 상자 평균 축소: 대상 픽셀 하나가 덮는 원본 영역의 평균. 알파는 흰 배경에 합성해서 불투명 RGBA로 */
export function boxResize(src: Rgba, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h * 4);
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(src.width, Math.floor((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * src.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          const a = src.data[i + 3]! / 255;
          r += src.data[i]! * a + 255 * (1 - a);
          g += src.data[i + 1]! * a + 255 * (1 - a);
          b += src.data[i + 2]! * a + 255 * (1 - a);
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** 긴 변을 maxSide로 줄인 JPEG. 알파는 흰 배경에 합성 */
export function makePreview(png: Buffer, maxSide = 512, quality = 80): Preview {
  const src = PNG.sync.read(png);
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = boxResize(src, w, h);
  const encoded = jpeg.encode({ data: out, width: w, height: h }, quality);
  return { data: Buffer.from(encoded.data), mimeType: "image/jpeg", width: w, height: h };
}

/** PNG 머리에서 크기만 읽는다 (디코딩 없이) */
export function pngSize(png: Buffer): { width: number; height: number } | undefined {
  if (png.length < 24 || png.readUInt32BE(12) !== 0x49484452) return undefined;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
