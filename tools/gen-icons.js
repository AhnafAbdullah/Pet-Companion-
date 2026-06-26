/*
 * gen-icons.js — renders the toolbar/store icons from the same procedural
 * critter art (no hand-made PNGs). Run: `node tools/gen-icons.js`.
 *
 * Draws the cat on a rounded pastel tile, then nearest-neighbour scales to
 * 16/48/128 and writes PNGs via a tiny zlib-backed encoder.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Raster = require('../src/lib/raster.js');
const Critters = require('../src/lib/critters.js');

// ---- minimal PNG encoder (RGBA, filter 0) -----------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, y * w * 4 + w * 4)
              : Buffer.from(rgba.buffer || rgba).copy(raw, y * (w * 4 + 1) + 1, y * w * 4, y * w * 4 + w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- render the critter ----------------------------------------------
const BW = 56, BH = 52;
function renderCritter(animal, level) {
  const buf = new Raster.PixelBuffer(BW, BH);
  Critters.draw(buf, animal, { level, facing: 1, mood: 'happy', stepping: false, t: 0, cx: BW >> 1, groundY: BH - 5 });
  const rgba = buf.toRGBA();
  // bounding box of opaque pixels
  let minX = BW, minY = BH, maxX = 0, maxY = 0;
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
    if (rgba[(y * BW + x) * 4 + 3] > 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return { rgba, minX, minY, maxX, maxY, w: BW, h: BH };
}

function makeIcon(size, crit) {
  const out = Buffer.alloc(size * size * 4);
  // rounded pastel tile background
  const r = Math.round(size * 0.22);
  const bg = [255, 217, 230, 255], bgEdge = [214, 71, 122, 255];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let inside = true, edge = false;
    const cxs = [r, size - 1 - r], cys = [r, size - 1 - r];
    for (let ci = 0; ci < 2; ci++) for (let cj = 0; cj < 2; cj++) {
      const ox = ci === 0 ? cxs[0] : cxs[1], oy = cj === 0 ? cys[0] : cys[1];
      const inCorner = (ci === 0 ? x < r : x > size - 1 - r) && (cj === 0 ? y < r : y > size - 1 - r);
      if (inCorner) { const d = Math.hypot(x - ox, y - oy); if (d > r) inside = false; else if (d > r - 2) edge = true; }
    }
    if (x < 2 || y < 2 || x > size - 3 || y > size - 3) edge = true;
    const o = (y * size + x) * 4;
    if (!inside) { out[o + 3] = 0; continue; }
    const col = edge ? bgEdge : bg;
    out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255;
  }
  // nearest-neighbour scale the cropped critter onto the tile
  const cw = crit.maxX - crit.minX + 1, chh = crit.maxY - crit.minY + 1;
  const pad = size * 0.16;
  const scale = Math.min((size - pad * 2) / cw, (size - pad * 2) / chh);
  const dw = cw * scale, dh = chh * scale;
  const dx = (size - dw) / 2, dy = size - dh - pad * 0.6;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.floor((x - dx) / scale) + crit.minX;
    const sy = Math.floor((y - dy) / scale) + crit.minY;
    if (sx < crit.minX || sx > crit.maxX || sy < crit.minY || sy > crit.maxY) continue;
    const si = (sy * crit.w + sx) * 4;
    if (crit.rgba[si + 3] === 0) continue;
    const o = (y * size + x) * 4;
    out[o] = crit.rgba[si]; out[o + 1] = crit.rgba[si + 1]; out[o + 2] = crit.rgba[si + 2]; out[o + 3] = 255;
  }
  return encodePNG(size, size, out);
}

const crit = renderCritter('cat', 6);
const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), makeIcon(size, crit));
  console.log(`wrote icons/icon${size}.png`);
}
