/**
 * Write only missing tourist amenity icons (luggage/laundry/charging).
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'src/assets/homeMap');

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function makeCanvas(s) {
  return { s, rgba: Buffer.alloc(s * s * 4) };
}
function px(c, x, y, r, g, b, a = 255) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= c.s || y >= c.s) return;
  const i = (y * c.s + x) * 4;
  c.rgba[i] = r;
  c.rgba[i + 1] = g;
  c.rgba[i + 2] = b;
  c.rgba[i + 3] = a;
}
function fillRect(c, x0, y0, x1, y1, col) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++)
      px(c, x, y, col[0], col[1], col[2], col[3] ?? 255);
}
function fillCircle(c, cx, cy, r, col) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) px(c, x, y, col[0], col[1], col[2], col[3] ?? 255);
}
function fillPoly(c, pts, col) {
  const ys = pts.map((p) => p[1]);
  const minY = Math.floor(Math.min(...ys));
  const maxY = Math.ceil(Math.max(...ys));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1] || 1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.floor(xs[i]); x <= Math.ceil(xs[i + 1]); x++)
        px(c, x, y, col[0], col[1], col[2], col[3] ?? 255);
    }
  }
}
function inRoundRect(x, y, pad, r, s) {
  const x0 = pad;
  const y0 = pad;
  const x1 = s - pad;
  const y1 = s - pad;
  if (x < x0 || y < y0 || x >= x1 || y >= y1) return false;
  const cx = x < x0 + r ? x0 + r : x >= x1 - r ? x1 - r - 1 : null;
  const cy = y < y0 + r ? y0 + r : y >= y1 - r ? y1 - r - 1 : null;
  if (cx != null && cy != null) return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  return true;
}
function strokeRoundRect(c, pad, r, col, w = 3) {
  for (let y = 0; y < c.s; y++)
    for (let x = 0; x < c.s; x++) {
      const inOuter = inRoundRect(x, y, pad, r, c.s);
      const inInner = inRoundRect(x, y, pad + w, Math.max(1, r - 1), c.s);
      if (inOuter && !inInner) px(c, x, y, col[0], col[1], col[2], col[3] ?? 255);
    }
}
const W = [255, 255, 255, 255];
function badge(bg, draw) {
  const c = makeCanvas(96);
  for (let y = 0; y < c.s; y++)
    for (let x = 0; x < c.s; x++)
      if (inRoundRect(x, y, 4, 16, c.s)) px(c, x, y, bg[0], bg[1], bg[2], 255);
  strokeRoundRect(c, 4, 16, W, 4);
  draw(c);
  return c.rgba;
}
function rect(c, x0, y0, x1, y1) {
  fillRect(c, x0, y0, x1, y1, W);
}

const ICONS = {
  luggage: [
    [0x6a, 0x5a, 0x48],
    (c) => {
      rect(c, 28, 34, 68, 78);
      rect(c, 38, 22, 58, 34);
      rect(c, 44, 48, 52, 64);
    },
  ],
  laundry: [
    [0x4a, 0x7a, 0x8a],
    (c) => {
      rect(c, 22, 22, 74, 78);
      fillCircle(c, 48, 52, 16, W);
      fillCircle(c, 48, 52, 8, [0x4a, 0x7a, 0x8a]);
    },
  ],
  charging: [
    [0x2e, 0x8b, 0x57],
    (c) => {
      fillPoly(c, [[52, 16], [34, 48], [48, 48], [40, 78], [66, 42], [52, 42]], W);
    },
  ],
};

mkdirSync(OUT, { recursive: true });
for (const [name, [bg, draw]] of Object.entries(ICONS)) {
  const dest = join(OUT, `place-${name}.png`);
  if (existsSync(dest)) {
    console.log('exists', name);
    continue;
  }
  const png = encodePng(96, 96, badge(bg, draw));
  writeFileSync(dest, png);
  console.log('wrote', name, png.length);
}
