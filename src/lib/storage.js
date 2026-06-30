/*
 * storage.js — single source of truth for the pet's saved state plus the
 * XP→level curve. Shared by the content script, the popup and the background
 * service worker (worker pulls it in via importScripts).
 */
(function (global) {
  'use strict';

  const KEY = 'petc.state';
  const MAX_LEVEL = 12;

  const DEFAULTS = {
    animal: 'kitten',     // 'cat' | 'owl' | 'kitten' | 'vampire' | 'dino' | 'fox' — Biscuit is the default

    skin: 'doux',         // colour variant for multi-skin pets (the Dino)
    name: 'Pixel',
    xp: 0,
    visible: true,
    size: 'medium',       // 'small' | 'medium' | 'large'
    speed: 'normal',      // 'calm' | 'normal' | 'zoomies'
    xPos: 0.12,           // last horizontal position as a fraction of viewport
    lastPat: 0,
    born: 0,
    treats: 0,
    sound: true,          // play the pet's voice when you pat it
    movement: true,       // false = pet stays put (drag to reposition); no wandering
    onboarded: false,
  };

  // Cumulative XP required to *reach* a level. Gentle early, steeper later.
  function xpToReach(level) {
    if (level <= 1) return 0;
    return Math.round(16 * Math.pow(level - 1, 1.65));
  }
  function levelForXp(xp) {
    let lvl = 1;
    while (lvl < MAX_LEVEL && xp >= xpToReach(lvl + 1)) lvl++;
    return lvl;
  }
  // {level, into, span, frac} — progress through the current level.
  function xpProgress(xp) {
    const level = levelForXp(xp);
    if (level >= MAX_LEVEL) return { level, into: 1, span: 1, frac: 1, maxed: true };
    const base = xpToReach(level), next = xpToReach(level + 1);
    const into = xp - base, span = next - base;
    return { level, into, span, frac: Math.max(0, Math.min(1, into / span)), maxed: false };
  }

  // True while this context can still reach the extension APIs. After a dev
  // reload, an orphaned content script's chrome.runtime.id goes undefined and
  // any chrome.* call throws "Extension context invalidated" — we guard on this.
  function alive() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
  }
  // Swallow a benign post-reload error; surface anything unexpected.
  function lastErr() {
    try { return chrome.runtime && chrome.runtime.lastError; } catch (_) { return null; }
  }

  function get() {
    return new Promise((resolve) => {
      const fallback = () => { const s = Object.assign({}, DEFAULTS); s.born = Date.now(); resolve(s); };
      if (!alive()) return fallback();
      try {
        chrome.storage.local.get(KEY, (res) => {
          if (lastErr()) return fallback();
          const s = Object.assign({}, DEFAULTS, res && res[KEY]);
          if (!s.born) s.born = Date.now();
          resolve(s);
        });
      } catch (_) { fallback(); }
    });
  }
  function set(state) {
    return new Promise((resolve) => {
      if (!alive()) return resolve();
      try { chrome.storage.local.set({ [KEY]: state }, () => { void lastErr(); resolve(); }); }
      catch (_) { resolve(); }
    });
  }
  async function patch(partial) {
    const cur = await get();
    const next = Object.assign(cur, partial);
    await set(next);
    return next;
  }
  function subscribe(cb) {
    const handler = (changes, area) => {
      if (area === 'local' && changes[KEY]) cb(changes[KEY].newValue, changes[KEY].oldValue);
    };
    if (!alive()) return () => {};
    try { chrome.storage.onChanged.addListener(handler); } catch (_) { return () => {}; }
    return () => { try { chrome.storage.onChanged.removeListener(handler); } catch (_) {} };
  }

  const Store = { KEY, DEFAULTS, MAX_LEVEL, xpToReach, levelForXp, xpProgress, get, set, patch, subscribe };
  global.PetStore = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
