// Generates the PWA icons (192/512, maskable-safe) with zero dependencies:
// a hand-rolled PNG encoder over node's built-in zlib. Run: npm run icons.
// Output is committed, so this only needs re-running if the design changes.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function render(size) {
  const img = Buffer.alloc(size * size * 4);
  const bg = hex('#10151c');
  const body = hex('#1e293b');
  const lights = [hex('#f4553f'), hex('#f5c445'), hex('#2fd274')];
  const s = size / 512;

  const inset = 20 * s; // maskable: keep content well inside
  const radius = 110 * s;
  const cx = size / 2;
  const lightR = 62 * s;
  const lightY = [148 * s, 256 * s, 364 * s];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = bg;
      // Rounded-square body.
      const dx = Math.max(inset + radius - x, x - (size - inset - radius), 0);
      const dy = Math.max(inset + radius - y, y - (size - inset - radius), 0);
      const inBody =
        x >= inset && x < size - inset && y >= inset && y < size - inset && Math.hypot(dx, dy) <= radius;
      if (inBody) c = body;
      for (let i = 0; i < 3; i++) {
        if (Math.hypot(x - cx, y - lightY[i]) <= lightR) c = lights[i];
      }
      const o = (y * size + x) * 4;
      img[o] = c[0];
      img[o + 1] = c[1];
      img[o + 2] = c[2];
      img[o + 3] = 255;
    }
  }
  return png(size, size, img);
}

mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(new URL(`../public/icons/icon-${size}.png`, import.meta.url), render(size));
  console.log(`icon-${size}.png written`);
}
