// Dev: verify sprite-companion sizing/anchoring against a procedural pet, and
// crown placement. Mirrors pet.js drawInto math. Run: node tools/sprite-preview.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Raster = require('../src/lib/raster.js');
const Critters = require('../src/lib/critters.js');
const Sprites = require('../src/lib/spritecat.js');

// ---- PNG decode/encode (RGBA) ----------------------------------------
function decodePNG(buf) {
  let p = 8; const idat = []; let w, h, colorType;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1, stride = w * ch;
  const out = Buffer.alloc(w * h * 4), cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  let ptr = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[ptr++]; raw.copy(cur, 0, ptr, ptr + stride); ptr += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0; let v = cur[x];
      if (ft === 1) v = (v + a) & 255; else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      cur[x] = v;
    }
    cur.copy(prev);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      out[o] = cur[s]; out[o + 1] = cur[ch >= 3 ? s + 1 : s]; out[o + 2] = cur[ch >= 3 ? s + 2 : s]; out[o + 3] = ch === 4 ? cur[s + 3] : 255;
    }
  }
  return { w, h, rgba: out };
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function ck(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'ascii'); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([l, t, data, cr]); }
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba).copy(raw, y * (w * 4 + 1) + 1, y * w * 4, y * w * 4 + w * 4); }
  return Buffer.concat([sig, ck('IHDR', ih), ck('IDAT', zlib.deflateSync(raw)), ck('IEND', Buffer.alloc(0))]);
}

// ---- compose ---------------------------------------------------------
const dir = path.join(__dirname, '..', 'src', 'assets', 'cat');
const sheetImg = {
  idle: decodePNG(fs.readFileSync(path.join(dir, 'Idle.png'))),
  cape: decodePNG(fs.readFileSync(path.join(dir, 'drculacat.png'))),
  box: decodePNG(fs.readFileSync(path.join(dir, 'Box3.png'))),
};
const FRAME = 32, PX = 4, ZOOM = 1.15;
const cellW = 200, cellH = 230, baseline = cellH - 24;
const items = [
  { kind: 'proc', animal: 'cat', level: 6, cap: 'cat L6 (procedural)' },
  { kind: 'sprite', sheet: 'idle', level: 6, cap: 'kitten L6 (idle)' },
  { kind: 'sprite', sheet: 'cape', level: 6, cap: 'vampire L6' },
  { kind: 'sprite', sheet: 'box', level: 4, cap: 'kitten sleep (box)' },
  { kind: 'sprite', sheet: 'idle', level: 12, crown: true, cap: 'kitten L12 mythic' },
];
const cols = items.length, W = cols * cellW, H = cellH;
const out = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { out[i * 4] = 232; out[i * 4 + 1] = 236; out[i * 4 + 2] = 242; out[i * 4 + 3] = 255; }
// baseline line
for (let cx = 0; cx < W; cx++) { const o = (baseline * W + cx) * 4; out[o] = 210; out[o + 1] = 180; out[o + 2] = 200; out[o + 3] = 255; }

function blit(srcRgba, sw, sx0, sy0, fw, fh, dx, dy, scale) {
  for (let y = 0; y < Math.round(fh * scale); y++) for (let x = 0; x < Math.round(fw * scale); x++) {
    const sx = sx0 + Math.floor(x / scale), sy = sy0 + Math.floor(y / scale);
    const si = (sy * sw + sx) * 4; if (srcRgba[si + 3] === 0) continue;
    const X = dx + x, Y = dy + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const o = (Y * W + X) * 4; out[o] = srcRgba[si]; out[o + 1] = srcRgba[si + 1]; out[o + 2] = srcRgba[si + 2]; out[o + 3] = 255;
  }
}

items.forEach((it, ci) => {
  const cx = ci * cellW + cellW / 2;
  const g = Critters.growth(it.level);
  if (it.kind === 'proc') {
    const buf = new Raster.PixelBuffer(56, 52);
    Critters.draw(buf, it.animal, { level: it.level, mood: 'happy', stepping: false, t: 0.3, cx: 28, groundY: 47 });
    const rgba = buf.toRGBA();
    blit(rgba, 56, 0, 0, 56, 52, Math.round(cx - 28 * PX), baseline - 47 * PX, PX);
  } else {
    const img = sheetImg[it.sheet];
    const size = FRAME * PX * ZOOM * g.scale;
    const scale = size / FRAME;
    const inset = 4 * (size / FRAME);
    const dx = Math.round(cx - size / 2), dy = Math.round(baseline - size + inset);
    blit(img.rgba, img.w, 0, 0, FRAME, FRAME, dx, dy, scale);
    if (it.crown) { // tiny gold marker where the canvas crown would sit
      const topY = Math.round(baseline - size * 0.82);
      for (let y = -6; y < 0; y++) for (let x = -8; x <= 8; x++) { const o = ((topY + y) * W + (Math.round(cx) + x)) * 4; if (o >= 0 && o < out.length) { out[o] = 255; out[o + 1] = 206; out[o + 2] = 84; out[o + 3] = 255; } }
    }
  }
});
fs.writeFileSync(path.join(__dirname, 'sprite-compare.png'), encodePNG(W, H, out));
console.log('wrote tools/sprite-compare.png', W + 'x' + H);
void Sprites;
