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
    animal: 'cat',        // 'cat' | 'dog' | 'owl'
    name: 'Pixel',
    xp: 0,
    visible: true,
    size: 'medium',       // 'small' | 'medium' | 'large'
    speed: 'normal',      // 'calm' | 'normal' | 'zoomies'
    xPos: 0.12,           // last horizontal position as a fraction of viewport
    lastPat: 0,
    born: 0,
    treats: 0,
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

  function get() {
    return new Promise((resolve) => {
      chrome.storage.local.get(KEY, (res) => {
        const s = Object.assign({}, DEFAULTS, res && res[KEY]);
        if (!s.born) s.born = Date.now();
        resolve(s);
      });
    });
  }
  function set(state) {
    return new Promise((resolve) => chrome.storage.local.set({ [KEY]: state }, resolve));
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
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  const Store = { KEY, DEFAULTS, MAX_LEVEL, xpToReach, levelForXp, xpProgress, get, set, patch, subscribe };
  global.PetStore = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
