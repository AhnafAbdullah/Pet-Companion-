/*
 * pet.js — the live companion: behaviour state-machine, procedural gait and
 * vertical physics (hop + squash/stretch), particle effects, and the canvas
 * renderer that blits the procedural pixel art with all the motion layered on.
 *
 * Horizontal travel across the page is done by the host (content.js) moving the
 * canvas element; everything inside here is expressed in the pet's local canvas
 * space, with feet pinned to the canvas baseline.
 */
(function (global) {
  'use strict';

  const Raster = global.PetRaster;
  const Critters = global.PetCritters;

  const BUF_W = 56, BUF_H = 52;
  const GROUND_Y = BUF_H - 5;
  const PX_BY_SIZE = { small: 2.1, medium: 2.7, large: 3.3 };
  const SPRITE_ZOOM = 1.15; // 32px sprite frames -> roughly match procedural pet height
  const CADENCE = { calm: 1.6, normal: 2.4, zoomies: 4.0 };
  const SPEED_PXS = { calm: 26, normal: 48, zoomies: 120 }; // page px / second

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class Pet {
    constructor(state) {
      this.buf = new Raster.PixelBuffer(BUF_W, BUF_H);
      this.off = null; // lazy offscreen canvas for crisp scaling
      this.apply(state);

      this.facing = 1;
      this.state = 'idle';
      this.gait = 0;            // stride accumulator
      this.stepping = false;
      this.y = 0;               // height above ground (canvas px, +up)
      this.vy = 0;
      this.squash = 0;          // landing squash, decays
      this.blink = 0;
      this.blinkTimer = rand(2, 5);
      this.mood = 'idle';
      this.moodTimer = 0;
      this.idleTimer = rand(1.5, 4);
      this.sleepiness = 0;
      this.particles = [];
      this.lastLevel = this.level;

      // page-space horizontal position is owned by host; we expose targetFrac
      this.frac = state.xPos ?? 0.12;
      this.targetFrac = this.frac;
      this.held = false;
      this.heldWiggle = 0;

      // press-and-hold play (sprite pets with a `hold` config): the kitten plays
      // its box once; Foxi loops its sleep while you keep holding.
      this.holding = false;
      this.holdHeld = false;
      this.holdState = null;
      this.holdMode = 'once';
      this.holdT0 = 0;
      this.holdFrame = 0;
      // anchored one-shot animation start (hurt clip), so it plays from frame 0
      this.hurtT0 = 0;
    }

    apply(state) {
      const newAnimal = state.animal || 'cat';
      if (newAnimal !== this.animal) this.holding = false; // switching pet cancels a hold
      this.animal = newAnimal;
      this.skin = state.skin || 'doux';   // colour variant, only used by multi-skin sprite pets
      this.name = state.name || 'Pixel';
      this.xp = state.xp || 0;
      this.size = state.size || 'medium';
      this.speedMode = state.speed || 'normal';
      this.level = Critters.growth ? levelFromXp(this.xp) : 1;
      this.px = PX_BY_SIZE[this.size] || PX_BY_SIZE.medium;
    }

    get growth() { return Critters.growth(this.level); }

    // ---- intents -------------------------------------------------------
    pickIntent() {
      if (this.mood === 'sleep') { this.wake(); return; }
      const r = Math.random();
      if (this.sleepiness > 1 && r < 0.18) { this.sleep(); return; }
      if (r < 0.55) {                       // wander
        this.state = 'walk';
        this.targetFrac = clamp(this.frac + rand(-0.4, 0.4), 0.04, 0.96);
        this.idleTimer = 99;
      } else if (r < 0.78) {                // sit & look
        this.state = 'sit';
        this.idleTimer = rand(2, 5);
      } else {                              // idle glance
        this.state = 'idle';
        this.idleTimer = rand(1.2, 3.5);
        if (Math.random() < 0.5) this.facing *= -1;
      }
    }

    sleep() { this.state = 'sleep'; this.mood = 'sleep'; this.stepping = false; this.idleTimer = rand(6, 12); }
    wake() { this.mood = 'idle'; this.sleepiness = 0; this.state = 'idle'; this.idleTimer = rand(1, 3); this.spawn('!', 1); }

    // ---- interactions --------------------------------------------------
    hop(power) { if (this.y <= 0.5) { this.vy = power; this.spawnSparkle(2); } }

    pat() {
      this.beHappy(2.2);
      this.hop(150);
      this.spawnHearts(4);
      return 'pat';
    }
    feed() {
      this.beHappy(3.2);
      this.hop(190);
      this.spawnHearts(7);
      this.state = 'cheer';
      this.idleTimer = 0.8;
    }
    beHappy(dur) { this.mood = 'happy'; this.moodTimer = dur; this.sleepiness = 0; if (this.state === 'sleep') this.wake(); }

    // does the current pet have an animation for `name` (sprite clip or sheet)?
    hasAnim(name) {
      const S = global.PetSprites; const d = S && S.petDef(this.animal);
      return !!(d && ((d.clips && d.clips[name]) || (d.anims && d.anims[name])));
    }
    // double-click reaction: a quick flinch for pets that have a 'hurt' clip
    // (the Dino); anything else just gets petted so the gesture still feels alive.
    hurt() {
      if (this.holding) return 'hold';
      if (!this.hasAnim('hurt')) return this.pat();
      if (this.mood === 'sleep') this.wake();
      this.state = 'hurt';
      this.mood = 'idle';
      this.stepping = false;
      // play the whole hurt/frightened clip once, from frame 0
      const S = global.PetSprites; const d = S && S.petDef(this.animal);
      const n = (S && d) ? S.frameCount(d, 'hurt', this.skin) : 4;
      const fps = (S && d && S.clipFps(d, 'hurt', this.skin)) || 10;
      this.hurtT0 = performance.now() / 1000;
      this.idleTimer = Math.max(0.4, n / fps + 0.08);
      this.hop(70);                  // small recoil
      this.spawn('!', 1);
      return 'hurt';
    }

    // press-and-hold: play the pet's `hold` animation. `once` (kitten box) plays
    // through all frames to completion; `loop` (Foxi sleep) loops until release.
    canBox() {
      const S = global.PetSprites; const d = S && S.petDef(this.animal);
      if (!d || !d.hold) return false;
      const fr = S.frameAt(d, d.hold.state, 0, this.skin);
      return !!(fr && fr.sheet);
    }
    enterBox() {
      const S = global.PetSprites; const d = S && S.petDef(this.animal);
      if (!d || !d.hold) return false;            // pet has no hold animation
      this.holding = true; this.holdHeld = true;
      this.holdState = d.hold.state; this.holdMode = d.hold.mode || 'once';
      this.holdT0 = performance.now() / 1000; this.holdFrame = 0;
      this.state = 'hold'; this.stepping = false; this.mood = 'idle';
      this.vy = 0; this.y = 0; this.squash = 0;
      this.spawn(this.holdMode === 'loop' ? 'z' : '!', 1);
      return true;
    }
    // release: `once` finishes its current play-through; `loop` pops out now.
    exitBox() { this.holdHeld = false; }
    endHold() { this.holding = false; this.state = 'idle'; this.idleTimer = rand(0.6, 1.6); this.spawnHearts(2); }

    // notice a click somewhere on the page (cx = page fraction 0..1)
    noticePoke(frac) {
      if (this.boxing) return;
      if (this.mood === 'sleep') { this.wake(); return; }
      this.facing = frac >= this.frac ? 1 : -1;
      this.hop(110);
      this.spawnSparkle(2);
      if (Math.abs(frac - this.frac) > 0.06 && Math.random() < 0.6) {
        this.state = 'walk';
        this.targetFrac = clamp(frac, 0.04, 0.96);
      }
    }

    grab() { this.held = true; this.mood = 'idle'; this.spawn('?', 1); this.stepping = false; }
    release() { this.held = false; this.vy = Math.min(this.vy, 0); this.state = 'idle'; this.idleTimer = rand(1, 2.5); }

    celebrate() {
      this.beHappy(3.5);
      this.hop(230);
      this.spawnSparkle(18);
      this.spawnHearts(4);
      this.state = 'cheer';
      this.idleTimer = 1.4;
    }

    // ---- update --------------------------------------------------------
    update(dt, viewportW) {
      dt = Math.min(dt, 0.05);
      // level change detection (xp may have been bumped elsewhere)
      const lv = levelFromXp(this.xp);
      if (lv !== this.level) {
        const grew = lv > this.level;
        this.level = lv;
        if (grew) this.celebrate();
      }

      // mood timing
      if (this.moodTimer > 0) { this.moodTimer -= dt; if (this.moodTimer <= 0 && this.mood === 'happy') this.mood = 'idle'; }
      this.sleepiness += dt * (this.state === 'idle' || this.state === 'sit' ? 0.12 : 0.02);

      // blink
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) { this.blink = 1; if (this.blinkTimer < -0.13) { this.blink = 0; this.blinkTimer = rand(2.5, 6); } }

      // vertical physics (hop / fall after drag)
      if (!this.held) {
        this.vy -= 620 * dt;
        this.y += this.vy * dt;
        if (this.y < 0) {
          if (this.vy < -120) this.squash = clamp(-this.vy / 600, 0.1, 0.45);
          this.y = 0; this.vy = 0;
        }
      } else {
        this.heldWiggle += dt * 8;
        this.y = lerp(this.y, 26, Math.min(1, dt * 10)); // lift toward cursor grip
      }
      this.squash *= Math.pow(0.0008, dt); // fast decay

      // behaviour
      if (this.held) {
        this.stepping = false;
      } else if (this.holding) {
        this.stepping = false;
        const S = global.PetSprites; const d = S && S.petDef(this.animal);
        const frames = (S && d) ? S.frameCount(d, this.holdState, this.skin) : 4;
        const fps = ((S && d) ? S.clipFps(d, this.holdState, this.skin) : 0) || 5;
        const f = Math.floor((performance.now() / 1000 - this.holdT0) * fps);
        if (this.holdMode === 'loop') {
          this.holdFrame = ((f % frames) + frames) % frames;
          if (Math.random() < dt * 1.4) this.spawn('z', 1);   // sleepy z's
          if (!this.holdHeld) this.endHold();                  // release pops out now
        } else {                                               // 'once'
          this.holdFrame = Math.min(f, frames - 1);
          if (f >= frames - 1 && !this.holdHeld) this.endHold();
        }
      } else if (this.state === 'walk') {
        const dir = this.targetFrac > this.frac ? 1 : -1;
        this.facing = dir;
        const spd = SPEED_PXS[this.speedMode] || SPEED_PXS.normal;
        const fracPerSec = spd / Math.max(320, viewportW);
        this.frac += dir * fracPerSec * dt;
        this.stepping = true;
        this.gait += dt * (CADENCE[this.speedMode] || CADENCE.normal);
        if ((dir > 0 && this.frac >= this.targetFrac) || (dir < 0 && this.frac <= this.targetFrac)) {
          this.frac = this.targetFrac; this.state = 'idle'; this.idleTimer = rand(1, 3); this.stepping = false;
        }
      } else {
        this.stepping = false;
        this.idleTimer -= dt;
        if (this.idleTimer <= 0) this.pickIntent();
      }
      this.frac = clamp(this.frac, 0.02, 0.98);

      this.updateParticles(dt);
      if (this.mood === 'sleep' && Math.random() < dt * 1.2) this.spawn('z', 1);
    }

    // ---- particles -----------------------------------------------------
    spawn(kind, n) { for (let i = 0; i < n; i++) this.particles.push(mkParticle(kind)); }
    spawnHearts(n) { for (let i = 0; i < n; i++) this.particles.push(mkParticle('heart')); }
    spawnSparkle(n) { for (let i = 0; i < n; i++) this.particles.push(mkParticle('spark')); }
    updateParticles(dt) {
      const ps = this.particles;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt;
        p.rot += p.vr * dt;
        if (p.life <= 0) ps.splice(i, 1);
      }
      // ambient sparkle aura for evolved pets
      if (this.growth.sparkle && Math.random() < dt * 6 && ps.length < 40) {
        const a = Math.random() * Math.PI * 2, r = rand(16, 30);
        ps.push({ kind: 'aura', x: Math.cos(a) * r, y: -28 + Math.sin(a) * r * 0.7, vx: 0, vy: -6, g: 0, life: rand(0.5, 1), maxLife: 1, rot: 0, vr: 0, size: rand(1, 2.4) });
      }
    }

    // ---- render --------------------------------------------------------
    draw(buf) {
      const o = {
        level: this.level, facing: 1, // facing handled by canvas flip
        walk: this.gait % 1, stepping: this.stepping,
        blink: this.blink, mood: this.mood, t: performance.now() / 1000,
        cx: BUF_W >> 1, groundY: GROUND_Y,
      };
      buf.clear();
      return Critters.draw(buf, this.animal, o);
    }

    render(ctx, w, h, now) {
      const px = this.px;
      const baseY = h - 6;
      const bob = this.stepping ? Math.abs(Math.sin(this.gait * Math.PI * 2)) * 3 : 0;
      const breathe = Math.sin(now / 700) * (this.state === 'sleep' ? 1.6 : 0.8);
      const lift = this.y;                 // hop / drag height
      const feetY = baseY - bob - lift;

      const cx = w / 2;
      const growth = Critters.growth(this.level);
      const Sprites = global.PetSprites;
      const spriteDef = Sprites && Sprites.isSpritePet(this.animal) ? Sprites.petDef(this.animal) : null;

      // squash & stretch. `flipX` sprites (Biscuit / Vampire Biscuit) have their
      // art mirrored relative to the right-facing convention, so invert the flip
      // to keep them facing — tail trailing — the direction they walk.
      const artFlip = spriteDef && spriteDef.flipX ? -1 : 1;
      const stretch = clamp(this.vy * 0.0009, -0.18, 0.22);
      const sx = (1 + this.squash * 0.85 - stretch) * this.facing * artFlip;
      const sy = 1 - this.squash * 0.85 + stretch + breathe * 0.004;

      ctx.clearRect(0, 0, w, h);

      // ground shadow (shrinks as the pet lifts off)
      const shScale = clamp(1 - lift / 120, 0.45, 1);
      ctx.save();
      ctx.globalAlpha = 0.22 * shScale;
      ctx.fillStyle = '#1a1622';
      ctx.beginPath();
      ctx.ellipse(cx, baseY + 1, BUF_W * px * 0.28 * shScale, 4.5 * shScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // resolve body colours (procedural draws its buffer here too)
      let colors, drawBody;
      if (spriteDef) {
        const glow = spriteDef.skins ? Sprites.glowFor(this.animal, this.skin) : spriteDef.glow;
        colors = { glow, ink: spriteDef.ink };
        let fr;
        if (this.holding) {                          // press-and-hold play (box / sleep loop)
          fr = Sprites.frameAt(spriteDef, this.holdState, this.holdFrame, this.skin);
        } else if (this.state === 'hurt') {          // double-click clip, anchored to play once from frame 0
          const fps = Sprites.clipFps(spriteDef, 'hurt', this.skin) || 10;
          const n = Sprites.frameCount(spriteDef, 'hurt', this.skin);
          const local = Math.min(n - 1, Math.floor((now / 1000 - this.hurtT0) * fps)); // hold last frame
          fr = Sprites.frameAt(spriteDef, 'hurt', local, this.skin);
        } else {
          const eff = this.held ? 'held' : (this.mood === 'sleep' ? 'sleep' : this.state);
          fr = Sprites.frameFor(spriteDef, eff, now / 1000, this.skin);
        }
        const zoom = spriteDef.zoom || SPRITE_ZOOM;
        const size = Math.min(BUF_H * px - 6, fr.frame * px * zoom * growth.scale);
        drawBody = () => Sprites.drawInto(ctx, fr.sheet, fr.sx, fr.sy, size, spriteDef.footInset, fr.frame);
        this._bodyTop = feetY - size * (spriteDef.crownFrac || 0.82);
      } else {
        const buf = this.buf;
        const meta = this.draw(buf);
        colors = meta.colors;
        this.ensureOffscreen();
        const off = this.off;
        off.ctx.putImageData(new ImageData(buf.toRGBA(), BUF_W, BUF_H), 0, 0);
        drawBody = () => ctx.drawImage(off.canvas, -meta.cx * px, -GROUND_Y * px, BUF_W * px, BUF_H * px);
        this._bodyTop = feetY - (GROUND_Y - meta.headY + meta.headR) * px;
      }

      // aura glow for evolved pets (common)
      if (growth.aura) {
        const g = colors.glow;
        const cyAura = feetY - GROUND_Y * px * 0.5;
        const pulse = 0.5 + Math.sin(now / 380) * 0.18;
        const rad = BUF_W * px * 0.5;
        const grd = ctx.createRadialGradient(cx, cyAura, 2, cx, cyAura, rad);
        grd.addColorStop(0, `rgba(${g[0]},${g[1]},${g[2]},${0.35 * pulse})`);
        grd.addColorStop(1, `rgba(${g[0]},${g[1]},${g[2]},0)`);
        ctx.fillStyle = grd;
        ctx.fillRect(cx - rad, cyAura - rad, rad * 2, rad * 2);
      }

      // blit body, pivoting on the feet so squash reads right
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(cx, feetY);
      ctx.scale(sx, sy);
      drawBody();
      ctx.restore();

      // mythic crown overlay for sprite pets (procedural pets bake it in)
      if (spriteDef && growth.crown) drawCanvasCrown(ctx, cx, this._bodyTop, px);

      this.renderParticles(ctx, cx, feetY - GROUND_Y * px * 0.5, colors);
    }

    ensureOffscreen() {
      if (this.off) return;
      const c = document.createElement('canvas');
      c.width = BUF_W; c.height = BUF_H;
      this.off = { canvas: c, ctx: c.getContext('2d') };
    }

    renderParticles(ctx, ox, oy, colors) {
      for (const p of this.particles) {
        const a = clamp(p.life / p.maxLife, 0, 1);
        const x = ox + p.x, y = oy + p.y;
        ctx.save();
        ctx.globalAlpha = a;
        if (p.kind === 'heart') { drawHeart(ctx, x, y, p.size, p.rot); }
        else if (p.kind === 'spark' || p.kind === 'aura') { drawSpark(ctx, x, y, p.size, colors.glow); }
        else { drawGlyph(ctx, x, y, p.kind, p.size, colors.ink); }
        ctx.restore();
      }
    }
  }

  // ---- particle factory ------------------------------------------------
  function mkParticle(kind) {
    if (kind === 'heart') return { kind, x: rand(-8, 8), y: rand(-30, -18), vx: rand(-6, 6), vy: rand(-26, -16), g: 6, life: rand(0.9, 1.5), maxLife: 1.5, rot: rand(-0.3, 0.3), vr: rand(-1, 1), size: rand(3, 4.5) };
    if (kind === 'spark') return { kind, x: rand(-14, 14), y: rand(-34, -10), vx: rand(-30, 30), vy: rand(-40, -8), g: 30, life: rand(0.4, 0.9), maxLife: 0.9, rot: 0, vr: 0, size: rand(1.5, 3) };
    // glyphs: 'z' sleepy, '!' surprise, '?' confused
    return { kind, x: rand(2, 12), y: rand(-32, -24), vx: rand(2, 8), vy: rand(-16, -10), g: 0, life: rand(1, 1.8), maxLife: 1.8, rot: 0, vr: 0, size: rand(6, 9) };
  }

  function drawCanvasCrown(ctx, cx, topY, px) {
    const u = px * 1.1, x = cx, y = topY - u * 2;
    ctx.save();
    ctx.fillStyle = '#ffce54';
    ctx.strokeStyle = '#b4821e';
    ctx.lineWidth = Math.max(1, px * 0.4);
    ctx.beginPath();
    ctx.moveTo(x - u * 2.2, y + u * 1.6);
    ctx.lineTo(x - u * 2.2, y);
    ctx.lineTo(x - u, y + u);
    ctx.lineTo(x, y - u * 0.6);
    ctx.lineTo(x + u, y + u);
    ctx.lineTo(x + u * 2.2, y);
    ctx.lineTo(x + u * 2.2, y + u * 1.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ff5d86';
    ctx.beginPath();
    ctx.arc(x, y + u * 0.7, u * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHeart(ctx, x, y, s, rot) {
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s / 4, s / 4);
    ctx.fillStyle = '#ff5d86';
    ctx.beginPath();
    ctx.moveTo(0, 1.5);
    ctx.bezierCurveTo(-2.2, -1.4, -4.4, 1.2, 0, 4.2);
    ctx.bezierCurveTo(4.4, 1.2, 2.2, -1.4, 0, 1.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fillRect(-1.6, -0.2, 1, 1);
  }
  function drawSpark(ctx, x, y, s, col) {
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-s, -s * 0.18, s * 2, s * 0.36);
    ctx.fillRect(-s * 0.18, -s, s * 0.36, s * 2);
  }
  function drawGlyph(ctx, x, y, ch, s, ink) {
    ctx.fillStyle = `rgb(${ink[0]},${ink[1]},${ink[2]})`;
    ctx.font = `700 ${Math.round(s + 4)}px ui-rounded, "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch === 'z' ? 'z' : ch, x, y);
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function levelFromXp(xp) {
    // mirror of storage.levelForXp without a hard dependency at import time
    const MAX = (global.PetStore && global.PetStore.MAX_LEVEL) || 12;
    const reach = (global.PetStore && global.PetStore.xpToReach) || ((l) => 16 * Math.pow(l - 1, 1.65));
    let lvl = 1; while (lvl < MAX && xp >= reach(lvl + 1)) lvl++; return lvl;
  }

  const Engine = { Pet, BUF_W, BUF_H, PX_BY_SIZE };
  global.PetEngine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
