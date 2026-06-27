/*
 * popup.js — control panel. The big preview is a real instance of the pet
 * engine so it looks identical to what walks your pages; the chooser thumbnails
 * are static critter renders. Everything writes through PetStore so the live
 * pets on open tabs update instantly.
 */
(function () {
  'use strict';
  const Store = window.PetStore;
  const Engine = window.PetEngine;
  const Critters = window.PetCritters;
  const Raster = window.PetRaster;
  const Sprites = window.PetSprites;

  const LABELS = { cat: 'Inka', owl: 'Owl', kitten: 'Biscuit', vampire: 'Vampire Biscuit', dino: 'Dino', fox: 'Foxi' };
  const ALL_ANIMALS = [...Critters.ANIMALS, ...(Sprites ? Sprites.list() : [])];
  const pendingThumbs = [];   // sprite thumbs waiting for their image to load

  const $ = (id) => document.getElementById(id);
  let state = null;
  let preview = null;          // Engine.Pet
  let pctx, pw, ph, ppx = 2.4;
  let lastT = performance.now();

  // ---- preview loop ---------------------------------------------------
  function initPreview() {
    const c = $('preview');
    pctx = c.getContext('2d');
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    pw = c.clientWidth || 276; ph = 180;
    c.width = pw * dpr; c.height = ph * dpr;
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pctx.imageSmoothingEnabled = false;
    c.addEventListener('click', () => { preview && preview.pat(); });
    c.addEventListener('dblclick', () => { preview && preview.hurt(); });
    requestAnimationFrame(loop);
  }
  function loop(t) {
    const dt = (t - lastT) / 1000; lastT = t;
    // sprite thumbnails can only be drawn once their image has loaded
    for (let i = pendingThumbs.length - 1; i >= 0; i--) {
      if (paintSpriteThumb(pendingThumbs[i].canvas, pendingThumbs[i].animal)) pendingThumbs.splice(i, 1);
    }
    if (preview) {
      preview.frac = 0.5;                 // keep centred in the stage
      preview.update(dt, 600);
      preview.frac = 0.5; preview.targetFrac = 0.5;
      // draw centred: temporarily render into full canvas, pet feet near bottom
      preview.px = ppx;
      preview.render(pctx, pw, ph, t);
    }
    requestAnimationFrame(loop);
  }

  // ---- chooser -------------------------------------------------------
  function buildChooser() {
    const root = document.getElementById('chooser');
    root.textContent = '';
    for (const animal of ALL_ANIMALS) {
      const b = document.createElement('button');
      b.className = 'pick'; b.dataset.animal = animal;
      const cv = document.createElement('canvas'); cv.width = 48; cv.height = 48;
      const sp = document.createElement('span'); sp.textContent = LABELS[animal] || animal;
      b.append(cv, sp);
      b.addEventListener('click', () => mutate({ animal }));
      root.appendChild(b);
      if (Sprites && Sprites.isSpritePet(animal)) {
        if (!paintSpriteThumb(cv, animal)) pendingThumbs.push({ canvas: cv, animal });
      } else {
        paintProceduralThumb(cv, animal);
      }
    }
  }

  function paintProceduralThumb(canvas, animal) {
    const buf = new Raster.PixelBuffer(Engine.BUF_W, Engine.BUF_H);
    Critters.draw(buf, animal, { level: 5, facing: 1, mood: 'happy', stepping: false, t: 0, cx: Engine.BUF_W >> 1, groundY: Engine.BUF_H - 5 });
    const off = document.createElement('canvas');
    off.width = Engine.BUF_W; off.height = Engine.BUF_H;
    off.getContext('2d').putImageData(new ImageData(buf.toRGBA(), Engine.BUF_W, Engine.BUF_H), 0, 0);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = Math.min(canvas.width / Engine.BUF_W, canvas.height / Engine.BUF_H) * 0.92;
    const dw = Engine.BUF_W * s, dh = Engine.BUF_H * s;
    ctx.drawImage(off, (canvas.width - dw) / 2, canvas.height - dh - 2, dw, dh);
  }

  function paintSpriteThumb(canvas, animal) {
    const def = Sprites && Sprites.petDef(animal);
    if (!def) return true;
    // multi-skin pets show their currently-selected colour in the chooser tile
    const skin = (state && state.animal === animal) ? state.skin : (def.defaultSkin || null);
    const fr = Sprites.frameFor(def, 'idle', 0, skin);
    if (!fr.sheet || !fr.sheet.ready || !fr.sheet.img) return false;
    const F = fr.frame;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = Math.min(canvas.width / F, canvas.height / F);
    const dw = F * s, dh = F * s;
    ctx.drawImage(fr.sheet.img, fr.sx, fr.sy, F, F, (canvas.width - dw) / 2, canvas.height - dh, dw, dh);
    return true;
  }

  // ---- skin / colour picker (shown only for multi-skin pets) ----------
  let skinsBuiltFor = null;
  function buildSkins() {
    const root = $('skins');
    root.textContent = '';
    const sk = Sprites && Sprites.skins(state.animal);
    if (!sk) { root.hidden = true; return; }
    root.hidden = false;
    for (const s of sk) {
      const b = document.createElement('button');
      b.className = 'skin'; b.dataset.skin = s.id; b.title = s.label;
      const sw = document.createElement('span'); sw.className = 'sw';
      sw.style.background = `rgb(${s.glow[0]},${s.glow[1]},${s.glow[2]})`;
      const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = s.label;
      b.append(sw, lbl);
      b.addEventListener('click', () => mutate({ skin: s.id }));
      root.appendChild(b);
    }
  }
  function updateSkins() {
    if (skinsBuiltFor !== state.animal) { buildSkins(); skinsBuiltFor = state.animal; }
    document.querySelectorAll('.skin').forEach((b) => b.classList.toggle('sel', b.dataset.skin === state.skin));
  }

  // ---- render UI from state ------------------------------------------
  function syncUI() {
    const prog = Store.xpProgress(state.xp);
    $('name').value = state.name;
    $('level').textContent = prog.level;
    $('stage').textContent = Critters.stageLabel(prog.level);
    $('xp-fill').style.width = (prog.maxed ? 100 : prog.frac * 100).toFixed(1) + '%';
    $('xp-text').textContent = prog.maxed ? 'MAX — Mythic!' : `${prog.into} / ${prog.span} XP`;
    $('treats').textContent = `🍪 ${state.treats || 0} treats`;
    document.querySelectorAll('.pick').forEach((b) => b.classList.toggle('sel', b.dataset.animal === state.animal));
    updateSkins();
    // keep the chooser tile of a multi-skin pet in sync with its chosen colour
    if (Sprites && Sprites.skins(state.animal)) {
      const tile = document.querySelector(`.pick[data-animal="${state.animal}"] canvas`);
      if (tile) paintSpriteThumb(tile, state.animal);
    }
    setSeg('size', state.size);
    setSeg('speed', state.speed);
    const vis = state.visible !== false;
    const vb = $('visible');
    vb.setAttribute('aria-pressed', String(vis));
    vb.textContent = vis ? '👁 Showing' : '🚫 Hidden';
  }
  function setSeg(id, val) {
    $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === val));
  }

  async function mutate(partial) {
    state = await Store.patch(partial);
    syncUI();
    if (preview) preview.apply(state);
  }

  function sendToActiveTab(msg) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, msg, () => void chrome.runtime.lastError);
    });
  }

  // ---- wire controls --------------------------------------------------
  function wire() {
    buildChooser();

    $('feed').addEventListener('click', async () => {
      const s = await Store.get();
      await mutate({ xp: (s.xp || 0) + 6, treats: (s.treats || 0) + 1 });
      preview && preview.feed();
      sendToActiveTab({ type: 'feed' });
    });
    $('pet').addEventListener('click', async () => {
      const s = await Store.get();
      await mutate({ xp: (s.xp || 0) + 1 });
      preview && preview.pat();
      sendToActiveTab({ type: 'come' });
    });
    $('visible').addEventListener('click', () => mutate({ visible: !(state.visible !== false) }));

    const nameEl = $('name');
    $('edit').addEventListener('click', () => { nameEl.focus(); nameEl.select(); });
    nameEl.addEventListener('change', () => { const v = nameEl.value.trim() || 'Pixel'; mutate({ name: v }); });
    nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameEl.blur(); });

    $('size').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => mutate({ size: b.dataset.v })));
    $('speed').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => mutate({ speed: b.dataset.v })));

    $('reset').addEventListener('click', async () => {
      if (!confirm('Start over with a fresh pet? Your level and treats will be lost.')) return;
      const fresh = Object.assign({}, Store.DEFAULTS, { born: Date.now(), onboarded: true, animal: state.animal, skin: state.skin });
      await Store.set(fresh);
      state = fresh; syncUI(); preview && preview.apply(state);
    });

    // reflect changes made elsewhere (e.g. xp gained on a page)
    Store.subscribe((next) => { if (next) { state = next; syncUI(); preview && preview.apply(next); } });
  }

  // ---- boot -----------------------------------------------------------
  (async function () {
    if (Sprites) Sprites.start((p) => chrome.runtime.getURL(p));
    state = await Store.get();
    preview = new Engine.Pet(state);
    initPreview();
    wire();
    syncUI();
  })();
})();
