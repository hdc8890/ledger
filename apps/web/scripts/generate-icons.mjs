// Dependency-free PNG icon generator for the Ledger PWA.
//
// We avoid pulling in an image library (sharp/canvas) for what amounts to a
// handful of static brand assets. PNGs are encoded by hand from an RGBA
// bitmap using Node's built-in zlib. Re-run with `node scripts/generate-icons.mjs`
// whenever the brand mark changes.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'icons');

// Brand palette.
const BG = [11, 18, 32]; // #0B1220 deep navy
const ACCENT = [52, 211, 153]; // #34D399 emerald — "growth"

/** @param {number[]} rgb @param {number} a */
function px(rgb, a = 255) {
  return [rgb[0], rgb[1], rgb[2], a];
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Encode an RGBA pixel buffer (length = w*h*4) into a PNG Buffer.
 * @param {number} w @param {number} h @param {Uint8Array} rgba
 */
function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is prefixed with a filter-type byte (0 = none).
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    const line = rgba.subarray(y * stride, y * stride + stride);
    for (let i = 0; i < line.length; i++) {
      raw[y * (stride + 1) + 1 + i] = line[i];
    }
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Draw the Ledger mark: an emerald ascending bar chart on a navy field.
 * @param {number} size pixel dimension (square)
 * @param {number} pad fraction of size reserved as safe-zone padding (maskable)
 */
function drawIcon(size, pad) {
  const rgba = new Uint8Array(size * size * 4);

  // Fill background (fully opaque — Apple/maskable require no transparency).
  for (let i = 0; i < size * size; i++) {
    const [r, g, b, a] = px(BG);
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  }

  const inset = Math.round(size * pad);
  const area = size - inset * 2;

  // Three ascending bars within the safe area.
  const bars = 3;
  const gap = Math.round(area * 0.08);
  const barW = Math.round((area - gap * (bars - 1)) / bars);
  const heights = [0.45, 0.7, 1.0];
  const baseline = inset + area;

  for (let bi = 0; bi < bars; bi++) {
    const x0 = inset + bi * (barW + gap);
    const barH = Math.round(area * heights[bi]);
    const y0 = baseline - barH;
    for (let y = y0; y < baseline; y++) {
      for (let x = x0; x < x0 + barW; x++) {
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const idx = (y * size + x) * 4;
        const [r, g, b, a] = px(ACCENT);
        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
        rgba[idx + 3] = a;
      }
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { name: 'icon-192.png', size: 192, pad: 0.14 },
  { name: 'icon-512.png', size: 512, pad: 0.14 },
  // Maskable variants reserve a ~20% safe zone so the mark survives masking.
  { name: 'icon-maskable-192.png', size: 192, pad: 0.2 },
  { name: 'icon-maskable-512.png', size: 512, pad: 0.2 },
  // Apple touch icon: opaque, full-bleed (iOS applies its own rounding).
  { name: 'apple-touch-icon.png', size: 180, pad: 0.14 },
];

for (const t of targets) {
  const buf = drawIcon(t.size, t.pad);
  writeFileSync(join(OUT_DIR, t.name), buf);
  console.log(`wrote ${t.name} (${buf.length} bytes)`);
}
