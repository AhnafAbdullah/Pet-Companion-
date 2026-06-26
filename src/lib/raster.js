/*
 * raster.js — tiny indexed-palette pixel buffer + drawing primitives.
 *
 * Asset-free pixel art: we compose critters from shapes into a small grid of
 * palette indices, run a 1px outline pass to unify the silhouette, then blit
 * the grid nearest-neighbour onto a canvas (crisp at any scale). The same
 * buffer can be exported to a PNG in Node, so the toolbar icons reuse the
 * exact critter art.
 *
 * Dual-mode: attaches to globalThis for classic <script>/content-script use,
 * and exports via module.exports for the Node icon generator.
 */
(function (global) {
  'use strict';

  function key(c) { return (c[0] << 24) ^ (c[1] << 16) ^ (c[2] << 8) ^ (c[3] | 0); }

  class PixelBuffer {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.data = new Uint16Array(w * h); // palette index per pixel, 0 = transparent
      this.palette = [[0, 0, 0, 0]];      // index 0 is always transparent
      this._lut = new Map();
    }

    clear() { this.data.fill(0); }

    /** Register an rgba colour, returning its palette index (deduped). */
    color(rgba) {
      const c = [rgba[0] | 0, rgba[1] | 0, rgba[2] | 0, rgba.length > 3 ? rgba[3] | 0 : 255];
      const k = key(c);
      let idx = this._lut.get(k);
      if (idx === undefined) { idx = this.palette.length; this.palette.push(c); this._lut.set(k, idx); }
      return idx;
    }

    inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    set(x, y, c) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c; }
    get(x, y) { return this.inside(x, y) ? this.data[y * this.w + x] : 0; }

    fillRect(x, y, w, h, c) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
    }

    hline(x0, x1, y, c) { if (x0 > x1) { const t = x0; x0 = x1; x1 = t; } for (let x = x0; x <= x1; x++) this.set(x, y, c); }
    vline(x, y0, y1, c) { if (y0 > y1) { const t = y0; y0 = y1; y1 = t; } for (let y = y0; y <= y1; y++) this.set(x, y, c); }

    line(x0, y0, x1, y1, c) {
      x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        this.set(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }

    /** Filled axis-aligned ellipse centred at (cx,cy). */
    fillEllipse(cx, cy, rx, ry, c) {
      if (rx <= 0 || ry <= 0) return;
      const rx2 = rx * rx, ry2 = ry * ry;
      for (let y = -ry; y <= ry; y++) {
        const span = rx * Math.sqrt(Math.max(0, 1 - (y * y) / ry2));
        const x0 = Math.round(-span), x1 = Math.round(span);
        for (let x = x0; x <= x1; x++) this.set(cx + x, cy + y, c);
      }
      void rx2;
    }

    disc(cx, cy, r, c) { this.fillEllipse(cx, cy, r, r, c); }

    /** Filled triangle (scanline). */
    triangle(ax, ay, bx, by, cx, cy, col) {
      const minY = Math.floor(Math.min(ay, by, cy));
      const maxY = Math.ceil(Math.max(ay, by, cy));
      const edges = [[ax, ay, bx, by], [bx, by, cx, cy], [cx, cy, ax, ay]];
      for (let y = minY; y <= maxY; y++) {
        const xs = [];
        for (const [x0, y0, x1, y1] of edges) {
          if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
            xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
          }
        }
        xs.sort((a, b) => a - b);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          this.hline(Math.round(xs[i]), Math.round(xs[i + 1]), y, col);
        }
      }
    }

    /**
     * Outline pass: every transparent pixel touching an opaque one (and not
     * itself replacing the body) becomes `c`. Run after all body fills, before
     * facial details, for a clean unified silhouette.
     */
    outline(c, diagonal) {
      const { w, h, data } = this;
      const snapshot = data.slice();
      const isSolid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && snapshot[y * w + x] !== 0;
      const nb = diagonal
        ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]
        : [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (snapshot[y * w + x] !== 0) continue;
          for (const [dx, dy] of nb) { if (isSolid(x + dx, y + dy)) { data[y * w + x] = c; break; } }
        }
      }
    }

    /** Replace one palette index with another wherever it appears. */
    recolorIndex(from, to) {
      const d = this.data;
      for (let i = 0; i < d.length; i++) if (d[i] === from) d[i] = to;
    }

    /** Flatten to RGBA Uint8ClampedArray (row-major), e.g. for ImageData. */
    toRGBA() {
      const out = new Uint8ClampedArray(this.w * this.h * 4);
      for (let i = 0; i < this.data.length; i++) {
        const c = this.palette[this.data[i]];
        const o = i * 4;
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
      }
      return out;
    }
  }

  const Raster = { PixelBuffer };
  global.PetRaster = Raster;
  if (typeof module !== 'undefined' && module.exports) module.exports = Raster;
})(typeof globalThis !== 'undefined' ? globalThis : this);
