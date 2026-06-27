/*
 * spritecat.js — image-sprite companions. Three sheet formats live here, all
 * addressed through one resolver (resolveClip -> frameAt) that returns a source
 * (sx, sy) rect, so the renderer never has to know which format a pet uses:
 *
 *   1. Cat sprites (CatPackFree, 32x32 strips) — one PNG per animation, used
 *      whole. `anims` maps a pet state straight to a sheet name.
 *   2. The Dino (Arks "DinoSprites", 24x24 strip) — a single 24-frame strip per
 *      colour skin; each animation is a horizontal sub-range (`clip`). The skin
 *      picks the sheet, the clip picks the frames.
 *   3. Foxi (a 14x7 grid of 32x32 frames) — one sheet, animations laid out on
 *      separate rows; a clip names a `row` plus a column range.
 *
 * The engine's behaviour/physics/XP are animal-agnostic, so sprite pets reuse
 * all of it and only differ in how the body frame is drawn.
 *
 * Sheets are loaded lazily from the extension's packaged assets (needs the
 * web_accessible_resources entry in the manifest). Until a sheet's Image has
 * loaded, drawInto is a no-op and the renderer just shows the shadow.
 */
(function (global) {
  'use strict';

  const FRAME = 32; // default frame size; a sheet may override via `frame`

  // raw sheets. `frame` defaults to FRAME when omitted.
  const SHEETS = {
    idle: { file: 'src/assets/cat/Idle.png',      frames: 10, fps: 8 },
    cape: { file: 'src/assets/cat/drculacat.png', frames: 6,  fps: 7 },
    box:  { file: 'src/assets/cat/Box3.png',      frames: 4,  fps: 5 },
    // Dino: one 24x24 strip per colour skin, 24 frames each. Animations are
    // frame sub-ranges of the strip (see dino.clips), not separate files.
    'dino-doux': { file: 'src/assets/dino/doux.png', frames: 24, frame: 24 },
    'dino-mort': { file: 'src/assets/dino/mort.png', frames: 24, frame: 24 },
    'dino-tard': { file: 'src/assets/dino/tard.png', frames: 24, frame: 24 },
    'dino-vita': { file: 'src/assets/dino/vita.png', frames: 24, frame: 24 },
    // Foxi: a 14x7 grid of 32x32 frames; animations are rows (see fox.clips).
    fox: { file: 'src/assets/fox/fox.png', frames: 14, frame: 32 },
  };

  // companions defined purely by sprites.
  const PETS = {
    kitten: {
      label: 'Biscuit',
      glow: [255, 205, 150], ink: [120, 80, 60],
      footInset: 4,            // empty rows below the paws in the frame, so it seats on the ground
      hold: { state: 'box', mode: 'once' }, // press-and-hold plays 'box' once, all frames, to completion
      anims: { idle: 'idle', walk: 'idle', sit: 'idle', cheer: 'idle', sleep: 'box', held: 'idle', box: 'box' },
    },
    vampire: {
      label: 'Vampire Biscuit',
      glow: [196, 90, 120], ink: [60, 30, 45],
      footInset: 4,
      anims: { idle: 'cape', walk: 'cape', sit: 'cape', cheer: 'cape', sleep: 'cape', held: 'cape' },
    },
    dino: {
      label: 'Dino',
      glow: [120, 200, 150], ink: [40, 56, 50],
      frame: 24,
      footInset: 3,            // feet sit ~3px above the frame bottom
      zoom: 1.5,               // 24px frame -> roughly match the 32px sprites' height
      defaultSkin: 'doux',
      // selectable colour skins; each maps to its own full strip + accent glow.
      skins: [
        { id: 'doux', label: 'Blue',   sheet: 'dino-doux', glow: [120, 180, 235] },
        { id: 'mort', label: 'Red',    sheet: 'dino-mort', glow: [235, 120, 120] },
        { id: 'tard', label: 'Yellow', sheet: 'dino-tard', glow: [255, 210, 110] },
        { id: 'vita', label: 'Green',  sheet: 'dino-vita', glow: [180, 220, 120] },
      ],
      // single-strip clips: state -> { from, count, fps }.
      // Arks layout: idle 0-3, run 4-9, kick 10-12, hurt 13-16, sneak 17-23.
      clips: {
        idle:  { from: 0,  count: 4, fps: 6 },
        walk:  { from: 4,  count: 6, fps: 12 },
        sit:   { from: 17, count: 7, fps: 7 },   // crouch/sneak reads as a low resting shuffle
        cheer: { from: 10, count: 3, fps: 10 },  // kick = a happy little jump-kick
        hurt:  { from: 13, count: 4, fps: 10 },  // flinch, played on a double-click
        sleep: { from: 0,  count: 4, fps: 2.2 }, // slow idle breathing
        held:  { from: 0,  count: 4, fps: 6 },
      },
    },
    fox: {
      label: 'Foxi',
      glow: [255, 168, 96], ink: [90, 52, 34],
      sheet: 'fox',            // single grid sheet (no skins)
      frame: 32,
      footInset: 0,            // feet sit on the frame's bottom edge
      zoom: 1.6,               // the fox fills only the lower half of its frame
      crownFrac: 0.46,         // head height (fraction of frame) for the mythic crown
      hold: { state: 'sleep', mode: 'loop' }, // press-and-hold loops the sleeping animation
      // grid clips: state -> { row, from, count, fps }. Rows of the 14x7 sheet:
      // 0 idle, 1 walk, 2 pounce, 4 frightened, 5 sleep, 6 lie-down.
      clips: {
        idle:  { row: 0, from: 0, count: 5,  fps: 5 },
        walk:  { row: 1, from: 0, count: 14, fps: 14 },
        cheer: { row: 2, from: 0, count: 8,  fps: 12 }, // playful pounce on feed/level-up
        hurt:  { row: 4, from: 0, count: 5,  fps: 8 },  // frightened rear-up (double-click)
        sleep: { row: 5, from: 0, count: 6,  fps: 5 },  // curled up, slow breathing
      },
    },
  };

  const loaded = {};   // sheetName -> { img, ready, frames, fps, frame }
  let started = false;

  function start(resolveUrl) {
    if (started) return;
    started = true;
    for (const [name, def] of Object.entries(SHEETS)) {
      const rec = { img: null, ready: false, frames: def.frames, fps: def.fps || 0, frame: def.frame || FRAME };
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
  function frameSize(name) { const s = SHEETS[name]; return (s && s.frame) || FRAME; }
  function sheetMeta(name) { const s = SHEETS[name]; return s ? { frames: s.frames, fps: s.fps || 0, frame: s.frame || FRAME } : null; }

  // ---- skins (multi-colour pets) --------------------------------------
  function skins(animal) { const d = PETS[animal]; return (d && d.skins) || null; }
  function pickSkin(def, skinId) {
    if (!def || !def.skins) return null;
    return def.skins.find((s) => s.id === skinId) ||
           def.skins.find((s) => s.id === def.defaultSkin) || def.skins[0];
  }
  function skinDef(animal, skinId) { return pickSkin(PETS[animal], skinId); }
  // accent colour for the aura/particles, honouring the active skin
  function glowFor(animal, skinId) {
    const d = PETS[animal]; if (!d) return [255, 255, 255];
    const sk = pickSkin(d, skinId);
    return (sk && sk.glow) || d.glow;
  }

  // ---- frame addressing -----------------------------------------------
  // Resolve a pet state to its source sheet + clip layout (row/from/count/fps),
  // unifying whole-sheet pets, single-strip clip pets and grid clip pets.
  function resolveClip(def, state, skinId) {
    const frame = def.frame || FRAME;
    if (def.clips) {                                   // dino (strip) / fox (grid)
      const clip = def.clips[state] || def.clips.idle;
      const skin = pickSkin(def, skinId);
      const sheetName = skin ? skin.sheet : def.sheet;
      const sheet = sheetName ? loaded[sheetName] : null;
      return { sheet, frame, row: clip.row || 0, from: clip.from || 0, count: clip.count || 1, fps: clip.fps || 0 };
    }
    const sheetName = def.anims[state] || def.anims.idle; // whole-sheet pet (cats)
    const sheet = loaded[sheetName];
    return { sheet, frame: frameSize(sheetName), row: 0, from: 0, count: sheet ? sheet.frames : 1, fps: sheet ? sheet.fps : 0 };
  }
  function frameCount(def, state, skinId) { return resolveClip(def, state, skinId).count; }
  function clipFps(def, state, skinId) { return resolveClip(def, state, skinId).fps; }

  // Source rect for a specific local frame within a clip. Returns { sheet, sx, sy, frame }.
  function frameAt(def, state, localIndex, skinId) {
    const c = resolveClip(def, state, skinId);
    const F = c.frame;
    if (!c.sheet) return { sheet: null, sx: 0, sy: 0, frame: F };
    const n = Math.max(1, c.count);
    const li = ((localIndex % n) + n) % n;
    return { sheet: c.sheet, sx: (c.from + li) * F, sy: c.row * F, frame: F };
  }

  // Time-based (looping) frame for ambient animations. `t` in seconds.
  function frameFor(def, state, t, skinId) {
    const c = resolveClip(def, state, skinId);
    if (!c.sheet) return { sheet: null, sx: 0, sy: 0, frame: c.frame };
    const n = Math.max(1, c.count);
    const li = Math.floor(t * (c.fps || 0)) % n;
    return frameAt(def, state, li, skinId);
  }

  /**
   * Draw one frame. Caller has already translated to the feet pivot and applied
   * facing/squash scale; we draw the frame centred horizontally with its feet
   * resting on the pivot. `sx`/`sy` are the source rect origin; `size` is the
   * on-screen pixel size of one frame; `frame` is the source frame size.
   */
  function drawInto(ctx, sheet, sx, sy, size, footInset, frame) {
    if (!sheet || !sheet.ready || !sheet.img) return false;
    const F = frame || (sheet.frame) || FRAME;
    const inset = (footInset || 0) * (size / F);
    ctx.drawImage(sheet.img, sx, sy, F, F, -size / 2, -size + inset, size, size);
    return true;
  }

  const Sprites = {
    FRAME, SHEETS, PETS, start, isSpritePet, petDef, list, getSheet, frameSize,
    sheetMeta, skins, skinDef, glowFor, resolveClip, frameCount, clipFps,
    frameAt, frameFor, drawInto, loaded,
  };
  global.PetSprites = Sprites;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sprites;
})(typeof globalThis !== 'undefined' ? globalThis : this);
