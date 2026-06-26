/*
 * critters.js — procedural pixel-art for the cat, dog and owl.
 *
 * Each animal is drawn from raster primitives into a PixelBuffer. Growth is a
 * single 0..1 parameter derived from level: it re-proportions the animal
 * (baby = oversized head + huge eyes + pastel coat; elder = larger, deeper
 * coat, ear tufts/crown) so a level-up visibly transforms the pet instead of
 * swapping a static sprite. Legs, tail and ears animate from `walk`/`t`.
 *
 * theme() returns rgba arrays; before drawing we resolve them to palette
 * indices (`p`) because the raster primitives take indices. The raw arrays are
 * handed back via meta.colors for the canvas layer (aura/particles).
 *
 * draw() returns silhouette metrics so the renderer knows where the feet are.
 */
(function (global) {
  'use strict';

  const Raster = global.PetRaster || (typeof require !== 'undefined' && require('./raster.js'));
  void Raster;

  // ---- colour helpers --------------------------------------------------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function mix(a, b, t) {
    return [
      Math.round(lerp(a[0], b[0], t)),
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t)),
    ];
  }
  function shade(c, f) {
    const target = f < 0 ? [40, 30, 55] : [255, 255, 255];
    return mix(c, target, Math.abs(f));
  }

  // ---- per-animal signature palettes ----------------------------------
  const THEMES = {
    cat: {
      name: 'Cat',
      baby:  { coat: [255, 199, 150], belly: [255, 244, 230], ear: [248, 197, 209], nose: [232, 138, 160], ink: [120, 78, 60] },
      elder: { coat: [240, 156, 78],  belly: [255, 238, 214], ear: [244, 165, 182], nose: [220, 110, 138], ink: [74, 44, 30] },
      eye: [44, 39, 64], glow: [255, 196, 120],
    },
    dog: {
      name: 'Dog',
      baby:  { coat: [248, 214, 170], belly: [255, 248, 236], ear: [224, 176, 130], nose: [90, 70, 64], ink: [110, 76, 52] },
      elder: { coat: [228, 158, 86],  belly: [255, 246, 228], ear: [196, 130, 80],  nose: [54, 42, 40], ink: [70, 44, 28] },
      eye: [44, 39, 64], glow: [255, 206, 130], tongue: [255, 138, 158],
    },
    owl: {
      name: 'Owl',
      baby:  { coat: [176, 162, 222], belly: [240, 232, 255], ear: [150, 134, 200], nose: [255, 200, 90], ink: [90, 76, 130] },
      elder: { coat: [126, 107, 184], belly: [232, 222, 252], ear: [104, 86, 158],  nose: [255, 188, 64], ink: [59, 47, 94] },
      eye: [44, 39, 64], glow: [180, 150, 255], ring: [244, 238, 255],
    },
  };

  const ANIMALS = ['cat', 'dog', 'owl'];

  function theme(animal, t) {
    const T = THEMES[animal] || THEMES.cat; // unknown animal (e.g. a sprite pet) -> cat fallback
    const b = T.baby, e = T.elder, tt = clamp(t, 0, 1);
    const coat = mix(b.coat, e.coat, tt);
    return {
      coat,
      coatHi: shade(coat, 0.22),
      coatLo: shade(coat, -0.18),
      belly: mix(b.belly, e.belly, tt),
      ear: mix(b.ear, e.ear, tt),
      nose: mix(b.nose, e.nose, tt),
      ink: mix(b.ink, e.ink, tt),
      eye: T.eye,
      glow: T.glow,
      tongue: T.tongue || [255, 138, 158],
      ring: T.ring || mix(b.belly, e.belly, tt),
    };
  }

  // resolve rgba theme -> palette indices for a specific buffer
  function resolve(buf, c) {
    return {
      coat: buf.color(c.coat), coatHi: buf.color(c.coatHi), coatLo: buf.color(c.coatLo),
      belly: buf.color(c.belly), ear: buf.color(c.ear), nose: buf.color(c.nose),
      ink: buf.color(c.ink), eye: buf.color(c.eye), ring: buf.color(c.ring),
      tongue: buf.color(c.tongue), white: buf.color([255, 255, 255]),
    };
  }

  // ---- growth model ----------------------------------------------------
  const MAX_LEVEL = 12;
  function growth(level) {
    const t = clamp((level - 1) / (MAX_LEVEL - 1), 0, 1);
    return {
      t, level,
      scale: lerp(0.74, 1.32, t),
      headRatio: lerp(1.22, 0.9, t),
      eyeRatio: lerp(1.3, 0.94, t),
      earLen: lerp(0.7, 1.15, t),
      aura: level >= 5,
      sparkle: level >= 7,
      crown: level >= MAX_LEVEL,
    };
  }
  function stageLabel(level) {
    if (level <= 2) return 'Baby';
    if (level <= 4) return 'Young';
    if (level <= 7) return 'Adult';
    if (level < MAX_LEVEL) return 'Elder';
    return 'Mythic';
  }

  // ---- shared limb drawing --------------------------------------------
  function legPose(phase, stepping) {
    if (!stepping) return { dx: 0, lift: 0 };
    const a = phase * Math.PI * 2;
    return { dx: Math.sin(a) * 2.4, lift: Math.max(0, Math.sin(a)) * 2.6 };
  }
  function drawLeg(buf, hipX, hipY, footBaseY, phase, stepping, colMain, colInk, far) {
    const { dx, lift } = legPose(phase, stepping);
    const fx = Math.round(hipX + dx);
    const fy = Math.round(footBaseY - lift);
    const col = far ? colInk : colMain;
    buf.line(Math.round(hipX), Math.round(hipY), fx, fy, col);
    buf.line(Math.round(hipX) + (far ? 0 : 1), Math.round(hipY), fx + (far ? 0 : 1), fy, col);
    buf.set(fx, fy, colInk);
    buf.set(fx + (far ? -1 : 1), fy, colInk);
  }

  function drawEye(buf, x, y, r, p, blink) {
    if (blink > 0.6) { // closed happy arc
      buf.line(x - r, y, x, y + 1, p.ink);
      buf.line(x, y + 1, x + r, y, p.ink);
      return;
    }
    buf.fillEllipse(x, y, r, r + 1, p.eye); // slightly tall = cuter
    buf.set(x - 1, y - 1, p.white);          // shine
    buf.set(x, y - 1, p.white);
  }

  // =====================================================================
  //  CAT
  // =====================================================================
  function drawCat(buf, g, p, o) {
    const s = g.scale, f = o.facing, cx = o.cx, gy = o.groundY;
    const legLen = Math.round(5 * s);
    const bodyRx = Math.round(11 * s), bodyRy = Math.round(7 * s);
    const bx = cx - f * 1, by = gy - legLen - bodyRy;
    const footY = gy;
    drawLeg(buf, bx - f * bodyRx * 0.7 + f, by + bodyRy, footY, o.walk + 0.5, o.stepping, p.coatLo, p.ink, true);
    drawLeg(buf, bx + f * bodyRx * 0.55 + f, by + bodyRy, footY, o.walk + 0.5, o.stepping, p.coatLo, p.ink, true);
    drawLeg(buf, bx - f * bodyRx * 0.7, by + bodyRy, footY, o.walk, o.stepping, p.coat, p.ink, false);
    drawLeg(buf, bx + f * bodyRx * 0.55, by + bodyRy, footY, o.walk, o.stepping, p.coat, p.ink, false);
    // tail
    const tailBaseX = bx - f * (bodyRx - 1), tailBaseY = by - bodyRy * 0.2;
    const sway = Math.sin(o.t * 2.4) * 2;
    for (let i = 0; i < Math.round(7 * s); i++) {
      const k = i / (7 * s);
      const tx = tailBaseX - f * i * 1.1;
      const ty = tailBaseY - Math.sin(k * Math.PI * 0.8) * 8 * s + sway * k;
      buf.disc(Math.round(tx), Math.round(ty), Math.max(1, Math.round(2.2 * s - k * 1.4)), p.coat);
    }
    // body
    buf.fillEllipse(bx, by, bodyRx, bodyRy, p.coat);
    buf.fillEllipse(bx + f * 2, by + bodyRy * 0.3, bodyRx * 0.62, bodyRy * 0.6, p.belly);
    buf.fillEllipse(bx - f * bodyRx * 0.4, by - bodyRy * 0.5, bodyRx * 0.45, bodyRy * 0.4, p.coatHi);
    // head
    const headR = Math.round(7 * s * g.headRatio);
    const hx = bx + f * (bodyRx * 0.62), hy = by - bodyRy * 0.55 - headR * 0.5;
    const earH = Math.round(6 * s * g.earLen), earW = Math.round(4 * s);
    const ear = (ex) => {
      buf.triangle(ex - earW, hy - headR * 0.5, ex + earW, hy - headR * 0.5, ex, hy - headR - earH, p.coat);
      buf.triangle(ex - earW * 0.5, hy - headR * 0.55, ex + earW * 0.5, hy - headR * 0.55, ex, hy - headR - earH * 0.6, p.ear);
    };
    ear(hx - f * headR * 0.55);
    ear(hx + f * headR * 0.55);
    buf.disc(hx, hy, headR, p.coat);
    buf.fillEllipse(hx, hy + headR * 0.45, headR * 0.7, headR * 0.5, p.belly);
    buf.fillEllipse(hx - f * headR * 0.4, hy - headR * 0.4, headR * 0.4, headR * 0.32, p.coatHi);
    buf.outline(p.ink, false);
    // face on top of outline
    const er = Math.max(1, Math.round(headR * 0.17 * g.eyeRatio));
    const eyeY = Math.round(hy - headR * 0.02);
    const ex1 = Math.round(hx - f * headR * 0.33), ex2 = Math.round(hx + f * headR * 0.58);
    drawEye(buf, ex1, eyeY, er, p, o.blink);
    drawEye(buf, ex2, eyeY, er, p, o.blink);
    const ny = Math.round(hy + headR * 0.35);
    buf.set(hx, ny, p.nose); buf.set(hx, ny + 1, p.nose);
    buf.set(hx - 1, ny + 2, p.ink); buf.set(hx + 1, ny + 2, p.ink);
    buf.line(hx + f * headR * 0.5, ny, hx + f * (headR + 4), ny - 1, p.ink);
    buf.line(hx + f * headR * 0.5, ny + 1, hx + f * (headR + 4), ny + 2, p.ink);
    if (o.mood === 'happy') { buf.disc(ex1, eyeY + er + 2, 1, p.nose); buf.disc(ex2, eyeY + er + 2, 1, p.nose); }
    return { footY, cx: hx, headY: hy, headR };
  }

  // =====================================================================
  //  DOG
  // =====================================================================
  function drawDog(buf, g, p, o) {
    const s = g.scale, f = o.facing, cx = o.cx, gy = o.groundY;
    const legLen = Math.round(5.5 * s);
    const bodyRx = Math.round(12 * s), bodyRy = Math.round(7.5 * s);
    const bx = cx - f * 1, by = gy - legLen - bodyRy;
    const footY = gy;
    drawLeg(buf, bx - f * bodyRx * 0.6 + f, by + bodyRy, footY, o.walk + 0.5, o.stepping, p.coatLo, p.ink, true);
    drawLeg(buf, bx + f * bodyRx * 0.5 + f, by + bodyRy, footY, o.walk + 0.5, o.stepping, p.coatLo, p.ink, true);
    drawLeg(buf, bx - f * bodyRx * 0.6, by + bodyRy, footY, o.walk, o.stepping, p.coat, p.ink, false);
    drawLeg(buf, bx + f * bodyRx * 0.5, by + bodyRy, footY, o.walk, o.stepping, p.coat, p.ink, false);
    // wagging tail
    const wagSpeed = o.mood === 'happy' ? 9 : 3.5;
    const tailBaseX = bx - f * (bodyRx - 1), tailBaseY = by - bodyRy * 0.4;
    const wag = Math.sin(o.t * wagSpeed) * 4;
    for (let i = 0; i < Math.round(6 * s); i++) {
      const k = i / (6 * s);
      buf.disc(Math.round(tailBaseX - f * i), Math.round(tailBaseY - i * 1.4 + wag * k), Math.max(1, Math.round(2.4 * s - k)), p.coat);
    }
    buf.fillEllipse(bx, by, bodyRx, bodyRy, p.coat);
    buf.fillEllipse(bx + f * 3, by + bodyRy * 0.35, bodyRx * 0.6, bodyRy * 0.62, p.belly);
    buf.fillEllipse(bx - f * bodyRx * 0.4, by - bodyRy * 0.5, bodyRx * 0.5, bodyRy * 0.4, p.coatHi);
    const headR = Math.round(7 * s * g.headRatio);
    const hx = bx + f * (bodyRx * 0.66), hy = by - bodyRy * 0.5 - headR * 0.45;
    // big floppy ears first, so the head sits on top of where they attach
    const earSway = Math.sin(o.t * 3) * 1.4;
    const eL = Math.round(10 * s * g.earLen);
    floppyEar(buf, hx - f * headR * 0.85, hy - headR * 0.5, eL, p.ear, earSway);        // back ear
    floppyEar(buf, hx + f * headR * 0.78, hy - headR * 0.35, eL * 0.92, p.ear, earSway * 0.6); // front ear by the cheek
    buf.disc(hx, hy, headR, p.coat);
    // muzzle bump + nose
    const snX = hx + f * headR * 0.72, snY = hy + headR * 0.42;
    buf.fillEllipse(snX, snY, headR * 0.56, headR * 0.46, p.belly);
    buf.fillEllipse(hx - f * headR * 0.3, hy - headR * 0.38, headR * 0.42, headR * 0.32, p.coatHi);
    buf.outline(p.ink, false);
    const er = Math.max(1, Math.round(headR * 0.17 * g.eyeRatio));
    const eyeY = Math.round(hy - headR * 0.04);
    const ex1 = Math.round(hx - f * headR * 0.28), ex2 = Math.round(hx + f * headR * 0.55);
    drawEye(buf, ex1, eyeY, er, p, o.blink);
    drawEye(buf, ex2, eyeY, er, p, o.blink);
    buf.disc(Math.round(snX + f * headR * 0.45), Math.round(snY - 1), Math.max(1, Math.round(headR * 0.26)), p.nose);
    if (o.mood === 'happy') {
      buf.fillEllipse(snX + f * headR * 0.2, snY + headR * 0.5, 2, 3, p.tongue);
      buf.disc(Math.round(hx - f * headR * 0.6), eyeY + er + 2, 1, p.tongue);
    }
    return { footY, cx: hx, headY: hy, headR };
  }

  function floppyEar(buf, x, y, len, col, sway) {
    // teardrop: widens in the middle, tapers at the rounded tip
    for (let i = 0; i < len; i++) {
      const k = i / len;
      const w = Math.max(1, Math.round(3.4 - Math.abs(k - 0.4) * 4.2));
      buf.fillEllipse(Math.round(x + sway * k), Math.round(y + i), w, 1, col);
    }
  }

  // =====================================================================
  //  OWL
  // =====================================================================
  function drawOwl(buf, g, p, o) {
    const s = g.scale, f = o.facing, cx = o.cx, gy = o.groundY;
    const bodyRx = Math.round(9 * s), bodyRy = Math.round(11 * s);
    const footY = gy, by = gy - 3 - bodyRy;
    const waddle = o.stepping ? Math.sin(o.walk * Math.PI * 2) * 1.6 : 0;
    talon(buf, cx - 3, footY, p.nose, p.ink, -waddle);
    talon(buf, cx + 3, footY, p.nose, p.ink, waddle);
    buf.fillEllipse(cx, by, bodyRx, bodyRy, p.coat);
    buf.fillEllipse(cx, by + bodyRy * 0.25, bodyRx * 0.66, bodyRy * 0.62, p.belly);
    buf.fillEllipse(cx, by - bodyRy * 0.4, bodyRx * 0.7, bodyRy * 0.4, p.coatHi);
    for (let i = -1; i <= 1; i++) for (let j = 0; j < 3; j++) buf.set(cx + i * 3, Math.round(by + bodyRy * 0.1 + j * 4), p.coatLo);
    const flap = o.stepping ? Math.abs(Math.sin(o.walk * Math.PI * 2)) * 3 : 0;
    wing(buf, cx - bodyRx + 1, by, bodyRy, p.coatLo, -1, flap);
    wing(buf, cx + bodyRx - 1, by, bodyRy, p.coatLo, 1, flap);
    const tuft = Math.round(5 * s * g.earLen);
    buf.triangle(cx - bodyRx * 0.7, by - bodyRy * 0.7, cx - bodyRx * 0.3, by - bodyRy * 0.7, cx - bodyRx * 0.55, by - bodyRy - tuft, p.coat);
    buf.triangle(cx + bodyRx * 0.7, by - bodyRy * 0.7, cx + bodyRx * 0.3, by - bodyRy * 0.7, cx + bodyRx * 0.55, by - bodyRy - tuft, p.coat);
    buf.outline(p.ink, false);
    const er = Math.max(2, Math.round(bodyRx * 0.55 * g.eyeRatio));
    const eyeY = Math.round(by - bodyRy * 0.35);
    const ex1 = Math.round(cx - bodyRx * 0.42), ex2 = Math.round(cx + bodyRx * 0.42);
    owlEye(buf, ex1, eyeY, er, p, o.blink, f);
    owlEye(buf, ex2, eyeY, er, p, o.blink, f);
    buf.triangle(cx - 2, eyeY + er, cx + 2, eyeY + er, cx, eyeY + er + 3, p.nose);
    buf.set(cx, eyeY + er + 1, p.ink);
    if (o.mood === 'happy') { buf.disc(ex1 - er + 1, eyeY + er + 1, 1, p.nose); buf.disc(ex2 + er - 1, eyeY + er + 1, 1, p.nose); }
    return { footY, cx, headY: eyeY, headR: bodyRx };
  }

  function owlEye(buf, x, y, r, p, blink, f) {
    buf.disc(x, y, r + 1, p.ink);
    buf.disc(x, y, r, p.ring);
    if (blink > 0.6) { buf.line(x - r, y, x + r, y, p.ink); return; }
    const pr = Math.max(1, Math.round(r * 0.55));
    buf.disc(x + f, y, pr, p.eye);
    buf.set(x + f - 1, y - 1, p.white);
  }
  function wing(buf, x, by, bodyRy, col, dir, flap) {
    for (let i = 0; i < bodyRy; i++) {
      const k = i / bodyRy;
      const px = Math.round(x + dir * (flap * (1 - k)) - dir * Math.sin(k * Math.PI) * 2);
      buf.fillEllipse(px, Math.round(by - bodyRy * 0.4 + i), Math.max(1, Math.round(2.4 - k)), 1, col);
    }
  }
  function talon(buf, x, y, col, ink, dx) {
    const px = Math.round(x + dx);
    buf.vline(px, y - 2, y, col);
    buf.set(px - 1, y, ink); buf.set(px + 1, y, ink); buf.set(px, y, ink);
  }

  // ---- crown for mythic -----------------------------------------------
  function drawCrown(buf, meta) {
    const x = meta.cx, y = Math.round(meta.headY - meta.headR - 2);
    const g = buf.color([255, 206, 84]);
    buf.fillRect(x - 4, y, 9, 2, g);
    for (let i = -1; i <= 1; i++) buf.triangle(x + i * 3 - 1, y, x + i * 3 + 1, y, x + i * 3, y - 3, g);
    buf.set(x, y, buf.color([255, 90, 120]));
  }

  // ---- public draw -----------------------------------------------------
  function draw(buf, animal, opts) {
    const o = Object.assign({
      facing: 1, walk: 0, stepping: false, blink: 0, mood: 'idle', t: 0,
      cx: buf.w >> 1, groundY: buf.h - 5,
    }, opts);
    const g = growth(o.level || 1);
    const c = theme(animal, g.t);
    const p = resolve(buf, c);
    let meta;
    if (animal === 'dog') meta = drawDog(buf, g, p, o);
    else if (animal === 'owl') meta = drawOwl(buf, g, p, o);
    else meta = drawCat(buf, g, p, o);
    if (g.crown) drawCrown(buf, meta);
    meta.growth = g;
    meta.colors = c;
    return meta;
  }

  const Critters = { draw, growth, stageLabel, theme, ANIMALS, MAX_LEVEL, THEMES };
  global.PetCritters = Critters;
  if (typeof module !== 'undefined' && module.exports) module.exports = Critters;
})(typeof globalThis !== 'undefined' ? globalThis : this);
