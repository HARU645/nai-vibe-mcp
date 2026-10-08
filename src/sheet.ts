// 비교 시트: 여러 그림을 줄여서 한 장에 격자로 붙이고 칸마다 번호를 찍는다.
// 글꼴 파일 없이 숫자만 5x7 비트맵으로 그린다 (번호 → 태그 대응은 결과 글과 sheet.txt에).

import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { boxResize } from "./preview.js";

const DIGITS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

interface Canvas {
  data: Buffer;
  width: number;
  height: number;
}

function fillRect(c: Canvas, x: number, y: number, w: number, h: number, rgb: [number, number, number]): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(c.width, x + w);
  const y1 = Math.min(c.height, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const o = (yy * c.width + xx) * 4;
      c.data[o] = rgb[0];
      c.data[o + 1] = rgb[1];
      c.data[o + 2] = rgb[2];
      c.data[o + 3] = 255;
    }
  }
}

/** 왼쪽 위 (x, y)에 어두운 배지 + 흰 숫자. 배지 크기를 돌려준다 */
export function drawNumber(c: Canvas, x: number, y: number, n: number, scale = 3): { w: number; h: number } {
  const s = String(n);
  const pad = Math.max(3, scale + 1);
  const w = s.length * 5 * scale + (s.length - 1) * scale + pad * 2;
  const h = 7 * scale + pad * 2;
  fillRect(c, x, y, w, h, [28, 28, 32]);
  let cx = x + pad;
  for (const ch of s) {
    const glyph = DIGITS[ch];
    if (glyph) {
      glyph.forEach((row, gy) => {
        for (let gx = 0; gx < 5; gx++) {
          if (row[gx] === "1") fillRect(c, cx + gx * scale, y + pad + gy * scale, scale, scale, [255, 255, 255]);
        }
      });
    }
    cx += 6 * scale;
  }
  return { w, h };
}

export function sheetColumns(n: number): number {
  if (n <= 4) return Math.max(1, n);
  if (n <= 9) return 3;
  return 4;
}

export interface SheetItem {
  png: Buffer;
  /** 칸에 찍을 번호 */
  number: number;
}

export interface SheetImage {
  data: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

/** 그림들을 cellWidth 폭으로 줄여 격자로 붙인 JPEG. 그림 크기가 달라도 칸은 가장 큰 높이에 맞춘다 */
export function makeContactSheet(items: SheetItem[], cellWidth = 256, quality = 85): SheetImage {
  if (items.length === 0) throw new Error("시트에 넣을 그림이 없습니다.");
  const gap = 8;
  const cols = sheetColumns(items.length);
  const rows = Math.ceil(items.length / cols);
  // 디코딩은 한 장씩: 큰 그림 여러 장을 한꺼번에 풀면 메모리를 많이 쓴다
  const cells = items.map((it) => {
    const src = PNG.sync.read(it.png);
    const h = Math.max(1, Math.round((cellWidth * src.height) / src.width));
    return { number: it.number, h, data: boxResize(src, cellWidth, h) };
  });
  const cellHeight = Math.max(...cells.map((c) => c.h));
  const width = gap + cols * (cellWidth + gap);
  const height = gap + rows * (cellHeight + gap);
  const canvas: Canvas = { data: Buffer.alloc(width * height * 4), width, height };
  fillRect(canvas, 0, 0, width, height, [240, 240, 243]);
  cells.forEach((cell, i) => {
    const x0 = gap + (i % cols) * (cellWidth + gap);
    const y0 = gap + Math.floor(i / cols) * (cellHeight + gap);
    for (let y = 0; y < cell.h; y++) {
      cell.data.copy(canvas.data, ((y0 + y) * width + x0) * 4, y * cellWidth * 4, (y + 1) * cellWidth * 4);
    }
    drawNumber(canvas, x0, y0, cell.number, 4);
  });
  const encoded = jpeg.encode({ data: canvas.data, width, height }, quality);
  return { data: Buffer.from(encoded.data), mimeType: "image/jpeg", width, height };
}
