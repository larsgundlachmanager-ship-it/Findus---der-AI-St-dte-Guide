/**
 * WebView-ähnliche PNG-Badges + GPS-Pfeil für die Native-Karte.
 * Run: node scripts/homeMap/writeAmenityIcons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  const xi = x | 0;
  const yi = y | 0;
  if (xi < 0 || yi < 0 || xi >= c.s || yi >= c.s) return;
  const i = (yi * c.s + xi) * 4;
  c.rgba[i] = r;
  c.rgba[i + 1] = g;
  c.rgba[i + 2] = b;
  c.rgba[i + 3] = a;
}

function fillRect(c, x0, y0, x1, y1, col) {
  const xa = Math.max(0, Math.min(x0, x1) | 0);
  const xb = Math.min(c.s - 1, Math.max(x0, x1) | 0);
  const ya = Math.max(0, Math.min(y0, y1) | 0);
  const yb = Math.min(c.s - 1, Math.max(y0, y1) | 0);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) px(c, x, y, col[0], col[1], col[2], col[3] ?? 255);
  }
}

function fillCircle(c, cx, cy, rad, col) {
  const r2 = rad * rad;
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(c.s - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(c.s - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) px(c, x, y, col[0], col[1], col[2], col[3] ?? 255);
    }
  }
}

function inRoundRect(x, y, pad, rad, s) {
  const x0 = pad;
  const y0 = pad;
  const x1 = s - 1 - pad;
  const y1 = s - 1 - pad;
  if (x < x0 || y < y0 || x > x1 || y > y1) return false;
  const cx = x < x0 + rad ? x0 + rad : x > x1 - rad ? x1 - rad : x;
  const cy = y < y0 + rad ? y0 + rad : y > y1 - rad ? y1 - rad : y;
  if (cx === x || cy === y) return true;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rad * rad;
}

function strokeRoundRect(c, pad, rad, col, w = 2) {
  for (let y = 0; y < c.s; y++) {
    for (let x = 0; x < c.s; x++) {
      const inner = inRoundRect(x, y, pad + w, Math.max(0, rad - w), c.s);
      const outer = inRoundRect(x, y, pad, rad, c.s);
      if (outer && !inner) px(c, x, y, col[0], col[1], col[2], 255);
    }
  }
}

function fillPoly(c, pts, col) {
  const ys = pts.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(c.s - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const scan = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= scan && b[1] > scan) || (b[1] <= scan && a[1] > scan)) {
        const t = (scan - a[1]) / (b[1] - a[1] || 1e-6);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.floor(xs[i]));
      const xb = Math.min(c.s - 1, Math.ceil(xs[i + 1]));
      for (let x = xa; x <= xb; x++) px(c, x, y, col[0], col[1], col[2], col[3] ?? 255);
    }
  }
}

function strokePoly(c, pts, col, width = 3) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const n = Math.ceil(len);
    for (let t = 0; t <= n; t++) {
      const x = a[0] + (dx * t) / n;
      const y = a[1] + (dy * t) / n;
      fillCircle(c, x, y, width / 2, col);
    }
  }
}

const W = [255, 255, 255, 255];

function badge(bg, draw) {
  const c = makeCanvas(96);
  for (let y = 0; y < c.s; y++) {
    for (let x = 0; x < c.s; x++) {
      if (inRoundRect(x, y, 4, 16, c.s)) px(c, x, y, bg[0], bg[1], bg[2], 255);
    }
  }
  strokeRoundRect(c, 4, 16, W, 4);
  draw(c);
  return c.rgba;
}

function rect(c, x0, y0, x1, y1) {
  fillRect(c, x0, y0, x1, y1, W);
}

const ICONS = {
  rail: [
    [0x2c, 0x3a, 0x42],
    (c) => {
      fillRect(c, 24, 14, 72, 62, W);
      fillRect(c, 34, 20, 62, 28, [0x2c, 0x3a, 0x42]);
      fillRect(c, 30, 34, 66, 50, [0x2c, 0x3a, 0x42]);
      fillCircle(c, 36, 58, 6, [0x2c, 0x3a, 0x42]);
      fillCircle(c, 60, 58, 6, [0x2c, 0x3a, 0x42]);
      fillPoly(c, [[28, 68], [16, 84], [80, 84], [68, 68]], W);
    },
  ],
  bus: [
    [0xd4, 0x78, 0x2a],
    (c) => {
      fillRect(c, 14, 28, 82, 64, W);
      fillRect(c, 18, 32, 36, 48, [0xd4, 0x78, 0x2a]);
      fillRect(c, 40, 32, 52, 48, [0xd4, 0x78, 0x2a]);
      fillRect(c, 56, 32, 68, 48, [0xd4, 0x78, 0x2a]);
      fillCircle(c, 30, 68, 8, W);
      fillCircle(c, 66, 68, 8, W);
      fillCircle(c, 30, 68, 4, [0xd4, 0x78, 0x2a]);
      fillCircle(c, 66, 68, 4, [0xd4, 0x78, 0x2a]);
    },
  ],
  doctor: [
    [0x8b, 0x4a, 0x52],
    (c) => {
      rect(c, 42, 18, 54, 78);
      rect(c, 22, 42, 74, 54);
    },
  ],
  pharmacy: [
    [0x2e, 0x8b, 0x57],
    (c) => {
      rect(c, 42, 18, 54, 78);
      rect(c, 22, 42, 74, 54);
    },
  ],
  parking: [
    [0x1a, 0x73, 0xe8],
    (c) => {
      rect(c, 28, 18, 40, 78);
      rect(c, 28, 18, 64, 30);
      rect(c, 56, 18, 68, 50);
      rect(c, 28, 44, 64, 56);
    },
  ],
  restaurant: [
    [0xb8, 0x87, 0x6a],
    (c) => {
      rect(c, 28, 18, 38, 78);
      rect(c, 24, 18, 42, 30);
      rect(c, 56, 22, 66, 78);
      rect(c, 52, 18, 70, 26);
    },
  ],
  cafe: [
    [0xc4, 0xa0, 0x6a],
    (c) => {
      fillRect(c, 24, 30, 64, 64, W);
      fillRect(c, 64, 38, 76, 56, W);
      rect(c, 32, 68, 60, 78);
    },
  ],
  shop: [
    [0xc4, 0x7a, 0x32],
    (c) => {
      fillPoly(c, [[22, 36], [48, 18], [74, 36], [74, 78], [22, 78]], W);
    },
  ],
  toilet: [
    [0x6a, 0x8a, 0x7a],
    (c) => {
      fillCircle(c, 32, 26, 8, W);
      fillCircle(c, 64, 26, 8, W);
      rect(c, 24, 36, 40, 78);
      rect(c, 56, 36, 72, 78);
    },
  ],
  post: [
    [0xf5, 0xc4, 0x00],
    (c) => {
      fillPoly(c, [[16, 38], [48, 16], [80, 38], [80, 78], [16, 78]], W);
      fillPoly(c, [[20, 40], [48, 62], [76, 40]], [0xf5, 0xc4, 0x00]);
    },
  ],
  fuel: [
    [0xc4, 0x78, 0x3a],
    (c) => {
      rect(c, 24, 18, 56, 78);
      rect(c, 56, 30, 72, 66);
      rect(c, 64, 66, 72, 78);
    },
  ],
  supermarket: [
    [0xc4, 0x7a, 0x32],
    (c) => {
      rect(c, 22, 40, 74, 78);
      rect(c, 28, 22, 36, 40);
      rect(c, 60, 22, 68, 40);
      rect(c, 22, 40, 74, 48);
    },
  ],
  kiosk: [
    [0x6a, 0x5a, 0x48],
    (c) => {
      fillPoly(c, [[16, 40], [48, 18], [80, 40]], W);
      rect(c, 22, 40, 74, 78);
    },
  ],
  bar: [
    [0x5a, 0x2c, 0x3c],
    (c) => {
      fillPoly(c, [[30, 20], [66, 20], [58, 78], [38, 78]], W);
    },
  ],
  info: [
    [0xc4, 0xa3, 0x5a],
    (c) => {
      fillCircle(c, 48, 28, 8, W);
      rect(c, 42, 42, 54, 78);
    },
  ],
  viewpoint: [
    [0x6b, 0x9b, 0x7a],
    (c) => {
      fillCircle(c, 48, 48, 22, W);
      fillCircle(c, 48, 48, 10, [0x6b, 0x9b, 0x7a]);
    },
  ],
  park: [
    [0x3d, 0x7a, 0x4a],
    (c) => {
      fillCircle(c, 68, 30, 16, W);
      fillCircle(c, 58, 36, 11, W);
      fillCircle(c, 78, 36, 10, W);
      rect(c, 64, 42, 72, 80);
      rect(c, 14, 46, 54, 54);
      rect(c, 14, 58, 54, 66);
      rect(c, 18, 66, 24, 80);
      rect(c, 44, 66, 50, 80);
    },
  ],
  kita: [
    [0xc4, 0x7a, 0x6a],
    (c) => {
      fillPoly(c, [[16, 44], [48, 16], [80, 44]], W);
      rect(c, 22, 44, 74, 80);
      fillRect(c, 40, 56, 56, 80, [0xc4, 0x7a, 0x6a]);
      fillCircle(c, 32, 60, 6, W);
      fillCircle(c, 64, 60, 6, W);
    },
  ],
  nature: [
    [0x6b, 0x9b, 0x7a],
    (c) => {
      fillCircle(c, 48, 40, 20, W);
      rect(c, 44, 56, 52, 78);
    },
  ],
  historic: [
    [0x7a, 0x62, 0x48],
    (c) => {
      rect(c, 22, 30, 74, 78);
      fillPoly(c, [[18, 32], [48, 14], [78, 32]], W);
    },
  ],
  activity: [
    [0x5e, 0x8f, 0x8a],
    (c) => {
      fillCircle(c, 48, 48, 22, W);
      fillCircle(c, 48, 48, 8, [0x5e, 0x8f, 0x8a]);
    },
  ],
  camping: [
    [0x5a, 0x6b, 0x3a],
    (c) => {
      fillPoly(c, [[16, 70], [48, 18], [80, 70]], W);
    },
  ],
  hotel: [
    [0x9a, 0x84, 0x96],
    (c) => {
      rect(c, 22, 22, 74, 78);
      fillRect(c, 34, 34, 46, 46, [0x9a, 0x84, 0x96]);
      fillRect(c, 50, 34, 62, 46, [0x9a, 0x84, 0x96]);
      fillRect(c, 42, 56, 54, 78, [0x9a, 0x84, 0x96]);
    },
  ],
  hostel: [
    [0x5a, 0x6b, 0x82],
    (c) => {
      rect(c, 20, 28, 76, 78);
      rect(c, 32, 16, 64, 28);
    },
  ],
  attraction: [
    [0x7a, 0x6e, 0xa8],
    (c) => {
      fillPoly(c, [[48, 16], [56, 40], [80, 40], [60, 56], [68, 80], [48, 64], [28, 80], [36, 56], [16, 40], [40, 40]], W);
    },
  ],
  museum: [
    [0x7a, 0x6e, 0xa8],
    (c) => {
      fillPoly(c, [[16, 36], [48, 14], [80, 36]], W);
      rect(c, 22, 36, 74, 78);
      fillRect(c, 42, 50, 54, 78, [0x7a, 0x6e, 0xa8]);
    },
  ],
  cinema: [
    [0x8b, 0x3a, 0x4a],
    (c) => {
      rect(c, 18, 28, 78, 68);
      fillRect(c, 28, 36, 68, 60, [0x8b, 0x3a, 0x4a]);
    },
  ],
  theater: [
    [0x6a, 0x4a, 0x7a],
    (c) => {
      fillCircle(c, 32, 40, 12, W);
      fillCircle(c, 64, 40, 12, W);
      rect(c, 22, 56, 74, 78);
    },
  ],
  water: [
    [0x2f, 0x6f, 0x88],
    (c) => {
      fillCircle(c, 48, 36, 16, W);
      fillPoly(c, [[32, 40], [48, 78], [64, 40]], W);
    },
  ],
  bike: [
    [0x6a, 0x9a, 0x86],
    (c) => {
      fillCircle(c, 30, 62, 14, W);
      fillCircle(c, 66, 62, 14, W);
      fillCircle(c, 30, 62, 7, [0x6a, 0x9a, 0x86]);
      fillCircle(c, 66, 62, 7, [0x6a, 0x9a, 0x86]);
      rect(c, 30, 34, 66, 42);
    },
  ],
  bridge: [
    [0x5a, 0x65, 0x70],
    (c) => {
      rect(c, 12, 48, 84, 56);
      rect(c, 20, 56, 28, 78);
      rect(c, 68, 56, 76, 78);
      fillPoly(c, [[16, 48], [48, 22], [80, 48]], W);
    },
  ],
  ferry: [
    [0x4a, 0x6a, 0x8a],
    (c) => {
      fillPoly(c, [[16, 50], [48, 22], [80, 50], [72, 70], [24, 70]], W);
    },
  ],
};

function userArrow() {
  const c = makeCanvas(128);
  const cx = 64;
  const cy = 64;
  const pts = [
    [cx, cy - 40],
    [cx + 32, cy + 36],
    [cx, cy + 18],
    [cx - 32, cy + 36],
  ];
  fillPoly(c, pts, [0x1a, 0x73, 0xe8, 255]);
  strokePoly(c, pts, W, 7);
  return c.rgba;
}

function routeChevron() {
  const c = makeCanvas(48);
  const pts = [
    [24, 8],
    [40, 32],
    [24, 24],
    [8, 32],
  ];
  fillPoly(c, pts, W);
  return c.rgba;
}

mkdirSync(OUT, { recursive: true });
for (const [name, [bg, draw]] of Object.entries(ICONS)) {
  const png = encodePng(96, 96, badge(bg, draw));
  writeFileSync(join(OUT, `place-${name}.png`), png);
  console.log('wrote', name, png.length);
}
writeFileSync(join(OUT, 'user-arrow.png'), encodePng(128, 128, userArrow()));
writeFileSync(join(OUT, 'route-chevron.png'), encodePng(48, 48, routeChevron()));
console.log('wrote user-arrow + route-chevron');
