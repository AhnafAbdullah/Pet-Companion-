/*
 * background.js — service worker. Grants a trickle of passive XP while the
 * browser is in use so the pet keeps growing just by being around, and seeds
 * default state on install. All real interaction XP comes from the page/popup.
 */
importScripts('../lib/storage.js');
const Store = self.PetStore;

const TICK = 'petc.tick';
const PASSIVE_DAILY_CAP = 40; // keep passive growth gentle; real play does the rest

chrome.runtime.onInstalled.addListener(async () => {
  const s = await Store.get();          // applies DEFAULTS + born timestamp
  await Store.set(s);
  chrome.alarms.create(TICK, { periodInMinutes: 2, delayInMinutes: 2 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(TICK, { periodInMinutes: 2, delayInMinutes: 2 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TICK) return;
  const s = await Store.get();
  const today = new Date().toDateString();
  if (s._passiveDay !== today) { s._passiveDay = today; s._passiveToday = 0; }
  if ((s._passiveToday || 0) >= PASSIVE_DAILY_CAP) { await Store.set(s); return; }
  s.xp = (s.xp || 0) + 1;
  s._passiveToday = (s._passiveToday || 0) + 1;
  await Store.set(s);
});
