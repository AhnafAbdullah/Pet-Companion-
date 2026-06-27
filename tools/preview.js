// Dev-only: render a sheet of all animals across growth levels to eyeball art.
// Run: node tools/preview.js  ->  tools/preview.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Raster = require('../src/lib/raster.js');
const Critters = require('../src/lib/critters.js');

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]); }
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba).copy(raw, y * (w * 4 + 1) + 1, y * w * 4, y * w * 4 + w * 4); }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const BW = 56, BH = 52, SCALE = 6;
const animals = ['cat', 'owl'];
const levels = [1, 4, 8, 12];
const cellW = BW * SCALE, cellH = BH * SCALE;
const W = cellW * levels.length, H = cellH * animals.length;
const out = Buffer.alloc(W * H * 4);
// light gray backdrop
for (let i = 0; i < W * H; i++) { out[i * 4] = 232; out[i * 4 + 1] = 236; out[i * 4 + 2] = 242; out[i * 4 + 3] = 255; }

animals.forEach((animal, ai) => {
  levels.forEach((lvl, li) => {
    const buf = new Raster.PixelBuffer(BW, BH);
    Critters.draw(buf, animal, { level: lvl, facing: 1, stepping: true, walk: 0.12, mood: 'happy', t: 0.3, cx: BW >> 1, groundY: BH - 5 });
    const rgba = buf.toRGBA();
    const ox = li * cellW, oy = ai * cellH;
    for (let y = 0; y < cellH; y++) for (let x = 0; x < cellW; x++) {
      const sx = (x / SCALE) | 0, sy = (y / SCALE) | 0;
      const si = (sy * BW + sx) * 4;
      if (rgba[si + 3] === 0) continue;
      const o = ((oy + y) * W + (ox + x)) * 4;
      out[o] = rgba[si]; out[o + 1] = rgba[si + 1]; out[o + 2] = rgba[si + 2]; out[o + 3] = 255;
    }
  });
});
fs.writeFileSync(path.join(__dirname, 'preview.png'), encodePNG(W, H, out));
console.log('wrote tools/preview.png', W + 'x' + H);
