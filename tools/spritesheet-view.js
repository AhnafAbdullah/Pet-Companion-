// Dev: magnify the cat sprite sheets into one contact sheet so frames are
// visible. Run: node tools/spritesheet-view.js  -> tools/sprite-view.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function decodePNG(buf) {
  // minimal PNG decoder for 8-bit RGBA / truecolor+alpha, filter types 0-4
  let p = 8; const chunks = [];
  let w, h, bitDepth, colorType;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  void chunks; void bitDepth;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
  const stride = w * channels;
  const out = Buffer.alloc(w * h * 4);
  const cur = Buffer.alloc(stride); const prev = Buffer.alloc(stride);
  let ptr = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[ptr++];
    raw.copy(cur, 0, ptr, ptr + stride); ptr += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = cur[x];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) { const pp = a + b - c; const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      cur[x] = v;
    }
    cur.copy(prev);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * channels;
      if (channels === 4) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3]; }
      else if (channels === 3) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; }
      else { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255; }
    }
  }
  return { w, h, rgba: out };
}

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

const dir = path.join(__dirname, '..', 'src', 'assets', 'cat');
const files = ['Idle.png', 'drculacat.png', 'Box3.png'];
const SCALE = 5, GAP = 6, FRAME = 32;
const imgs = files.map((f) => ({ name: f, ...decodePNG(fs.readFileSync(path.join(dir, f))) }));
const rows = imgs.length;
const maxW = Math.max(...imgs.map((i) => i.w));
const W = maxW * SCALE + 80;
const rowH = FRAME * SCALE + GAP * 2;
const H = rows * rowH;
const out = Buffer.alloc(W * H * 4);
// checker bg so transparency is visible
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = ((x >> 3) + (y >> 3)) & 1 ? 200 : 230; const o = (y * W + x) * 4; out[o] = out[o + 1] = out[o + 2] = c; out[o + 3] = 255; }

imgs.forEach((img, ri) => {
  const oy = ri * rowH + GAP;
  // frame separators every 32px
  for (let y = 0; y < img.h * SCALE; y++) for (let x = 0; x < img.w * SCALE; x++) {
    const sx = (x / SCALE) | 0, sy = (y / SCALE) | 0;
    const si = (sy * img.w + sx) * 4;
    const al = img.rgba[si + 3];
    if (al === 0) continue;
    const o = ((oy + y) * W + x) * 4;
    out[o] = img.rgba[si]; out[o + 1] = img.rgba[si + 1]; out[o + 2] = img.rgba[si + 2]; out[o + 3] = 255;
  }
  // red frame grid lines
  const nf = Math.round(img.w / FRAME);
  for (let fI = 0; fI <= nf; fI++) {
    const gx = fI * FRAME * SCALE;
    for (let y = 0; y < FRAME * SCALE; y++) { const o = ((oy + y) * W + Math.min(gx, W - 1)) * 4; out[o] = 255; out[o + 1] = 60; out[o + 2] = 60; out[o + 3] = 255; }
  }
});
fs.writeFileSync(path.join(__dirname, 'sprite-view.png'), encodePNG(W, H, out));
console.log('wrote tools/sprite-view.png', W + 'x' + H, '| frames per sheet:', imgs.map(i => i.name + '=' + Math.round(i.w / FRAME)).join(', '));
