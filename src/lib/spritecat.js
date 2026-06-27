/*
 * spritecat.js — image-sprite companions, sourced from the CatPackFree art
 * (32x32 horizontal strips). These live alongside the procedural cat/owl;
 * the engine's behaviour/physics/XP are animal-agnostic, so sprite pets reuse
 * all of it and only differ in how the body frame is drawn.
 *
 * Sheets are loaded lazily from the extension's packaged assets (needs the
 * web_accessible_resources entry in the manifest). Until a sheet's Image has
 * loaded, drawFrame is a no-op and the renderer just shows the shadow.
 */
(function (global) {
  'use strict';

  const FRAME = 32;

  // raw animation strips
  const SHEETS = {
    idle: { file: 'src/assets/cat/Idle.png',      frames: 10, fps: 8 },
    cape: { file: 'src/assets/cat/drculacat.png', frames: 6,  fps: 7 },
    box:  { file: 'src/assets/cat/Box3.png',      frames: 4,  fps: 5 },
  };

  // companions defined purely by sprites. `anims` maps a pet state to a sheet.
  const PETS = {
    kitten: {
      label: 'Biscuit',
      glow: [255, 205, 150], ink: [120, 80, 60],
      footInset: 4,            // empty rows below the paws in the frame, so it seats on the ground
      holdAnim: 'box',         // press-and-hold plays this once, all frames, to completion
      anims: { idle: 'idle', walk: 'idle', sit: 'idle', cheer: 'idle', sleep: 'box', held: 'idle', box: 'box' },
    },
    vampire: {
      label: 'Vampire Biscuit',
      glow: [196, 90, 120], ink: [60, 30, 45],
      footInset: 4,
      anims: { idle: 'cape', walk: 'cape', sit: 'cape', cheer: 'cape', sleep: 'cape', held: 'cape' },
    },
  };

  const loaded = {};   // sheetName -> { img, ready, frames, fps }
  let started = false;

  function start(resolveUrl) {
    if (started) return;
    started = true;
    for (const [name, def] of Object.entries(SHEETS)) {
      const rec = { img: null, ready: false, frames: def.frames, fps: def.fps };
      loaded[name] = rec;
      try {
        const img = new Image();
        img.onload = () => { rec.ready = true; };
        img.onerror = () => { rec.ready = false; };
        img.src = resolveUrl(def.file);
        rec.img = img;
      } catch (_) { /* non-browser context */ }
    }
  }

  function isSpritePet(animal) { return Object.prototype.hasOwnProperty.call(PETS, animal); }
  function petDef(animal) { return PETS[animal] || null; }
  function list() { return Object.keys(PETS); }
  function getSheet(name) { return loaded[name] || null; }
  function sheetMeta(name) { const s = SHEETS[name]; return s ? { frames: s.frames, fps: s.fps } : null; }

  // current frame index for a pet state at time `t` (seconds)
  function frameFor(def, state, t) {
    const sheetName = def.anims[state] || def.anims.idle;
    const sheet = loaded[sheetName];
    if (!sheet) return { sheet: null, index: 0, sheetName };
    const index = Math.floor(t * sheet.fps) % sheet.frames;
    return { sheet, index, sheetName };
  }

  /**
   * Draw one frame. Caller has already translated to the feet pivot and applied
   * facing/squash scale; we draw the frame centred horizontally with its paws
   * resting on the pivot. `size` is the on-screen pixel size of one 32px frame.
   */
  function drawInto(ctx, sheet, index, size, footInset) {
    if (!sheet || !sheet.ready || !sheet.img) return false;
    const dw = size, dh = size;
    const inset = (footInset || 0) * (size / FRAME);
    ctx.drawImage(sheet.img, index * FRAME, 0, FRAME, FRAME, -dw / 2, -dh + inset, dw, dh);
    return true;
  }

  const Sprites = { FRAME, SHEETS, PETS, start, isSpritePet, petDef, list, getSheet, sheetMeta, frameFor, drawInto, loaded };
  global.PetSprites = Sprites;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sprites;
})(typeof globalThis !== 'undefined' ? globalThis : this);
