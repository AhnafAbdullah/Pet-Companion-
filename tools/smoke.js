/*
 * smoke.js — headless runtime check for pet.js. Mocks the bits of the browser
 * the renderer touches (canvas 2d ctx, ImageData, document, performance) and
 * runs every animal through many frames + every interaction, asserting no throw
 * and that the physics/particle state stays finite. Run: node tools/smoke.js
 */
const grad = { addColorStop() {} };
function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createRadialGradient') return () => grad;
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const fakeCanvas = () => ({ width: 0, height: 0, getContext: makeCtx });
global.document = { createElement: fakeCanvas };
global.ImageData = function (data, w, h) { this.data = data; this.width = w; this.height = h; };
global.performance = { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 };

require('../src/lib/raster.js');
require('../src/lib/storage.js');
require('../src/lib/critters.js');
require('../src/lib/spritecat.js');
require('../src/lib/pet.js');
const { Pet } = global.PetEngine;
global.PetSprites.start((p) => p); // Image() unavailable in node -> sheets stay "not ready" (drawInto no-ops)

const xpForLevel = (l) => Math.round(16 * Math.pow(l - 1, 1.65));
const finite = (...vs) => vs.every((v) => Number.isFinite(v));

let frames = 0, checks = 0;
for (const animal of ['cat', 'owl', 'kitten', 'vampire']) {
  for (const startLevel of [1, 5, 12]) {
    const pet = new Pet({ animal, xp: xpForLevel(startLevel), size: 'medium', speed: 'normal' });
    const ctx = makeCtx();
    // scripted interactions sprinkled across a long run
    for (let i = 0; i < 1500; i++) {
      const dt = 0.016 + (Math.random() - 0.5) * 0.004;
      pet.update(dt, 1280);
      pet.render(ctx, 160, 150, performance.now());
      frames++;
      if (i === 100) pet.pat();
      if (i === 200) pet.feed();
      if (i === 300) pet.noticePoke(Math.random());
      if (i === 400) pet.grab();
      if (i === 420) pet.release();
      if (i === 600) { pet.xp = xpForLevel(Math.min(12, pet.level + 1)); } // force level-up -> celebrate
      if (i === 700) pet.enterBox();   // press-and-hold box (no-op for non-box pets)
      if (i === 780) pet.exitBox();    // release -> finish all frames then pop out
      if (i === 900) pet.celebrate();
      if (i === 1100) pet.sleep();

      if (!finite(pet.frac, pet.y, pet.vy, pet.gait, pet.squash, pet.blink)) {
        throw new Error(`non-finite state for ${animal} L${startLevel} at frame ${i}: ` +
          JSON.stringify({ frac: pet.frac, y: pet.y, vy: pet.vy, gait: pet.gait, squash: pet.squash }));
      }
      if (pet.frac < 0 || pet.frac > 1) throw new Error(`frac out of bounds: ${pet.frac}`);
      if (pet.particles.length > 200) throw new Error(`particle leak: ${pet.particles.length}`);
      checks++;
    }
  }
}
console.log(`OK — ${frames} frames rendered, ${checks} state assertions passed, no exceptions.`);
