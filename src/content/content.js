/*
 * content.js — hosts the pet on every page.
 *
 * Layout: a transparent full-pet canvas (pointer-events: none, never blocks the
 * page) plus a small hit-area div that follows the pet for petting/dragging.
 * The canvas slides horizontally via CSS transform; all in-canvas motion is the
 * pet engine's job. State lives in chrome.storage so every tab shows the same
 * companion and reacts to popup changes live.
 */
(function () {
  'use strict';

  if (window.top !== window) return;            // only the top frame gets a pet
  if (window.__petCompanionLoaded) return;
  window.__petCompanionLoaded = true;

  const Store = window.PetStore;
  const Engine = window.PetEngine;
  const Critters = window.PetCritters;
  if (!Store || !Engine || !Critters) return;

  const BUF_W = Engine.BUF_W, BUF_H = Engine.BUF_H;

  let pet = null;
  let canvas, ctx, hit, bubble;
  let cw = 0, ch = 0, px = 2.7, dpr = Math.max(1, window.devicePixelRatio || 1);
  let last = performance.now();
  let running = true;
  let pendingXp = 0, xpFlushAt = 0;
  let savePosAt = 0;

  // ---- DOM ------------------------------------------------------------
  function build() {
    canvas = document.createElement('canvas');
    canvas.id = 'petc-canvas';
    hit = document.createElement('div');
    hit.id = 'petc-hit';
    document.documentElement.appendChild(canvas);
    document.documentElement.appendChild(hit);
    ctx = canvas.getContext('2d');
    resize();
    wireInput();
  }

  function resize() {
    px = Engine.PX_BY_SIZE[pet ? pet.size : 'medium'] || 2.7;
    dpr = Math.max(1, window.devicePixelRatio || 1);
    cw = Math.round(BUF_W * px);
    ch = Math.round(BUF_H * px);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // hit area roughly covers the pet body, not the whole canvas
    const hw = Math.round(cw * 0.55), hh = Math.round(ch * 0.8);
    hit.style.width = hw + 'px';
    hit.style.height = hh + 'px';
  }

  function place() {
    if (!pet) return;
    const vw = window.innerWidth;
    const x = clamp(pet.frac * vw - cw / 2, -cw * 0.15, vw - cw * 0.85);
    canvas.style.transform = `translate3d(${x}px,0,0)`;
    const hw = parseFloat(hit.style.width);
    hit.style.transform = `translate3d(${x + (cw - hw) / 2}px,0,0)`;
  }

  // ---- input ----------------------------------------------------------
  function wireInput() {
    let downX = 0, downY = 0, dragging = false, pid = null, boxMode = false, holdTimer = null;
    const HOLD_MS = 320; // press-and-hold longer than this triggers the box (if supported)
    const DBL_MS = 280;  // two taps within this window = double-click (flinch)

    // single tap = pet; double tap = hurt/flinch. We only defer the pet (to wait
    // for a possible second tap) on pets that actually have a flinch, so petting
    // the cat/owl stays instant.
    let tapTimer = null, lastTapAt = 0;
    function onTap() {
      dismissBubble();
      if (!(pet.hasAnim && pet.hasAnim('hurt'))) { pet.pat(); addXp(2, 60000); return; }
      const now = performance.now();
      if (tapTimer && now - lastTapAt < DBL_MS) {  // second tap -> double-click
        clearTimeout(tapTimer); tapTimer = null; lastTapAt = 0;
        if (pet.hurt() === 'hurt') addXp(-6);       // a real flinch (Dino/Amber) costs 6 XP
        return;
      }
      lastTapAt = now;
      tapTimer = setTimeout(() => { tapTimer = null; pet.pat(); addXp(2, 60000); }, DBL_MS);
    }

    hit.addEventListener('pointerdown', (e) => {
      pid = e.pointerId; downX = e.clientX; downY = e.clientY; dragging = false; boxMode = false;
      try { hit.setPointerCapture(pid); } catch (_) {}
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        if (pid === null || dragging) return;
        if (pet.enterBox()) { boxMode = true; dismissBubble(); } // hold = hop into the box
      }, HOLD_MS);
      e.preventDefault();
    });
    hit.addEventListener('pointermove', (e) => {
      if (pid === null) return;
      if (!boxMode && !dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > 6) {
        clearTimeout(holdTimer);
        dragging = true; hit.classList.add('petc-grabbing'); pet.grab();
        dismissBubble();
      }
      if (dragging) { pet.frac = clamp(e.clientX / window.innerWidth, 0.02, 0.98); place(); }
    });
    const end = () => {
      if (pid === null) return;
      clearTimeout(holdTimer);
      try { hit.releasePointerCapture(pid); } catch (_) {}
      pid = null; hit.classList.remove('petc-grabbing');
      if (dragging) { pet.release(); queueSavePos(true); }
      else if (boxMode) { pet.exitBox(); }          // let the box animation finish all frames
      else { onTap(); }                             // single tap = pet, double tap = flinch
      boxMode = false;
    };
    hit.addEventListener('pointerup', end);
    hit.addEventListener('pointercancel', end);

    // clicks anywhere else on the page get the pet's attention
    let lastNotice = 0;
    window.addEventListener('pointerdown', (e) => {
      if (!pet || e.target === hit || hit.contains(e.target)) return;
      const t = performance.now();
      if (t - lastNotice < 350) return;
      lastNotice = t;
      pet.noticePoke(clamp(e.clientX / window.innerWidth, 0, 1));
    }, true);

    window.addEventListener('resize', () => { resize(); place(); });
    document.addEventListener('fullscreenchange', () => {
      const fs = !!document.fullscreenElement;
      canvas.classList.toggle('petc-hidden', fs);
      hit.classList.toggle('petc-hidden', fs);
    });
    window.addEventListener('pagehide', () => queueSavePos(true), { passive: true });
    document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { last = performance.now(); loop(last); } });
  }

  // ---- xp + persistence ----------------------------------------------
  // Coalesce xp writes; `cooldownKey` throttles repeatable sources (petting).
  let patCooldown = 0;
  function addXp(amount, cooldownMs) {
    if (cooldownMs) { const now = Date.now(); if (now < patCooldown) return; patCooldown = now + cooldownMs; }
    pet.xp = Math.max(0, pet.xp + amount);   // instant local feedback (never below zero)
    pendingXp += amount;
    if (!xpFlushAt) xpFlushAt = performance.now() + 400;
  }
  async function flushXp() {
    if (!pendingXp) return;
    const add = pendingXp; pendingXp = 0; xpFlushAt = 0;
    const s = await Store.get();
    s.xp = Math.max(0, (s.xp || 0) + add);
    await Store.set(s);
  }
  function queueSavePos(now) {
    if (now) { Store.patch({ xPos: pet.frac }); savePosAt = 0; return; }
    if (!savePosAt) savePosAt = performance.now() + 4000;
  }

  // ---- loop -----------------------------------------------------------
  // After a dev reload this content script is orphaned; chrome.runtime.id goes
  // undefined. Detect that and remove our DOM so we don't animate (or throw) forever.
  function extAlive() { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } }

  function loop(t) {
    if (!running) return;
    if (!extAlive()) { running = false; canvas && canvas.remove(); hit && hit.remove(); bubble && bubble.remove(); return; }
    const dt = (t - last) / 1000; last = t;
    pet.update(dt, window.innerWidth);
    pet.render(ctx, cw, ch, t);
    place();
    if (xpFlushAt && t >= xpFlushAt) flushXp();
    if (savePosAt && t >= savePosAt) queueSavePos(true);
    followBubble();
    requestAnimationFrame(loop);
  }

  // ---- onboarding bubble ---------------------------------------------
  // Build with DOM nodes (not innerHTML) so we don't trip Trusted Types on
  // strict sites like GitHub.
  function showBubble(content, sticky) {
    if (bubble) bubble.remove();
    bubble = document.createElement('div');
    bubble.id = 'petc-bubble';
    bubble.append(content);
    document.documentElement.appendChild(bubble);
    bubble.addEventListener('click', dismissBubble);
    if (!sticky) setTimeout(dismissBubble, 9000);
  }
  // Assemble a fragment from parts: plain strings stay text; {b:'x'} → bold.
  function buildFrag(parts) {
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (typeof p === 'string') frag.append(p);
      else { const b = document.createElement('b'); b.textContent = p.b; frag.append(b); }
    }
    return frag;
  }
  // A short, character-specific tutorial: shared gestures plus the moves that are
  // unique to the chosen companion (Biscuit naps, Dino flinches, Amber both).
  const TIP_EMOJI = { kitten: '🐾', cat: '🐾', owl: '🦉', vampire: '🦇', dino: '🦖', fox: '🦊' };
  function characterTip(animal, name) {
    const parts = ["Hi! I'm ", { b: name }, ` ${TIP_EMOJI[animal] || '🐾'} — click me to pet, `,
      { b: 'drag' }, ' to carry me around'];
    if (animal === 'kitten') parts.push(', and ', { b: 'press & hold' }, ' me for a cozy nap');
    else if (animal === 'dino') parts.push(', and ', { b: 'double-click' }, ' to give me a fright');
    else if (animal === 'fox') parts.push(', ', { b: 'press & hold' }, ' for a nap, and ', { b: 'double-click' }, ' to spook me');
    parts.push('. Feed me from the toolbar to help me grow!');
    return buildFrag(parts);
  }
  function followBubble() {
    if (!bubble || !pet) return;
    const vw = window.innerWidth;
    const x = clamp(pet.frac * vw - cw / 2, 4, vw - 240);
    bubble.style.transform = `translate3d(${x}px,0,0)`;
    bubble.style.bottom = (ch - 6) + 'px';
  }
  function dismissBubble() {
    if (!bubble) return;
    const b = bubble; bubble = null;
    b.classList.add('petc-fade');
    setTimeout(() => b.remove(), 280);
    Store.patch({ onboarded: true });
  }

  // ---- messages from popup -------------------------------------------
  chrome.runtime.onMessage.addListener((msg) => {
    if (!pet || !msg) return;
    if (msg.type === 'feed') { pet.feed(); addXp(6); }
    else if (msg.type === 'celebrate') pet.celebrate();
    else if (msg.type === 'come') pet.noticePoke(0.5);
  });

  // ---- react to state changes from other tabs / popup ----------------
  Store.subscribe((next) => {
    if (!next || !pet) return;
    const animalChanged = next.animal !== pet.animal;
    const sizeChanged = next.size !== pet.size;
    const wasVisible = !canvas.classList.contains('petc-hidden');
    pet.apply(next);
    if (animalChanged) { pet.celebrate(); showBubble(characterTip(next.animal, next.name), false); } // poof + how-to for the new friend
    if (sizeChanged) { resize(); place(); }
    const show = next.visible !== false;
    canvas.classList.toggle('petc-hidden', !show);
    hit.classList.toggle('petc-hidden', !show);
    if (show && !wasVisible) place();
  });

  // ---- boot -----------------------------------------------------------
  async function boot() {
    if (window.PetSprites) window.PetSprites.start((p) => chrome.runtime.getURL(p));
    if (window.PetSfx) window.PetSfx.setResolver((p) => chrome.runtime.getURL(p));
    const state = await Store.get();
    pet = new Engine.Pet(state);
    build();
    place();
    if (state.visible === false) { canvas.classList.add('petc-hidden'); hit.classList.add('petc-hidden'); }
    if (!state.onboarded) {
      setTimeout(() => showBubble(characterTip(state.animal, state.name), false), 1200);
    }
    requestAnimationFrame((t) => { last = t; loop(t); });
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
