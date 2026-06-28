/*
 * petsfx.js — the pets' voices. Each companion gets a short, synthesized "blip"
 * built from a Web Audio oscillator with a pitch contour + amplitude envelope
 * (plus a noise layer for the Dino's growl). Nothing is loaded from disk, so
 * there are no audio assets to ship or license — matching the rest of the
 * codebase's all-procedural approach.
 *
 * A per-pet recorded-clip override hook lives in CLIPS: drop a file in
 * src/assets/sfx/, point the pet's entry at it (and add it to the manifest's
 * web_accessible_resources), and play() will use the recording instead of the
 * synth voice. Call setResolver(chrome.runtime.getURL) so clip paths resolve.
 *
 * The AudioContext is created lazily on the first play(), which only ever
 * happens from a click/tap — a user gesture — so we never trip the browser's
 * autoplay policy.
 */
(function (global) {
  'use strict';

  let actx = null;       // lazily-created AudioContext
  let master = null;     // master gain -> destination
  let muted = false;
  let resolveUrl = null; // maps a packaged path to a loadable URL
  const clipBuffers = {};// animal -> decoded AudioBuffer (clip override cache)

  // ---- per-pet recorded-clip overrides (empty by default) -------------
  // animal -> packaged asset path. Leave commented to use the synth voice.
  const CLIPS = {
    // kitten: 'src/assets/sfx/biscuit.ogg',
    // dino:   'src/assets/sfx/dino.ogg',
  };

  // ---- synthesized voices ---------------------------------------------
  // contour: frequency (Hz) waypoints swept across `dur` seconds.
  // type: oscillator wave. gain: peak amplitude. vib/vibDepth: detune wobble
  // (cents). noise/noiseFreq: optional band-passed noise layer for texture.
  const VOICES = {
    cat:     { type: 'triangle', contour: [520, 760, 600, 470], dur: 0.28, gain: 0.45 }, // Inka — soft meow
    owl:     { type: 'sine',     contour: [360, 392, 348, 330], dur: 0.46, gain: 0.42, vib: 7, vibDepth: 28 }, // Owly — hoot
    kitten:  { type: 'triangle', contour: [780, 1010, 840],     dur: 0.16, gain: 0.42 }, // Biscuit — squeaky mrp
    vampire: { type: 'sawtooth', contour: [430, 320, 250],      dur: 0.34, gain: 0.34, vib: 5, vibDepth: 14 }, // spooky meow
    dino:    { type: 'sawtooth', contour: [155, 220, 185, 110], dur: 0.44, gain: 0.85, attack: 0.06, lowpass: 900, noise: 0.3, noiseType: 'lowpass', noiseFreq: 760 }, // natural mini roar: warm low-passed body + breathy rumble (no vibrato)
    fox:     { type: 'triangle', contour: [900, 1220, 720],     dur: 0.13, gain: 0.38 }, // Amber — quick yip
  };

  function ensureCtx() {
    if (actx) return actx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try {
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 0.78;
      const lp = actx.createBiquadFilter();   // gentle top-end roll-off keeps it warm
      lp.type = 'lowpass'; lp.frequency.value = 6500;
      master.connect(lp); lp.connect(actx.destination);
    } catch (_) { actx = null; }
    return actx;
  }

  function noiseBuffer(ctx, dur) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Play one synthesized voice. `jitter` slightly retunes each call so repeated
  // pats don't sound robotic.
  function tone(v) {
    const ctx = ensureCtx(); if (!ctx) return;
    const now = ctx.currentTime + 0.001;
    const d = v.dur, peak = v.gain;
    const j = 0.96 + Math.random() * 0.08;

    const atk = v.attack || 0.012;          // longer attack = a swell, not a click
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + atk);
    g.gain.setValueAtTime(peak, now + d * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0008, now + d);
    g.connect(master);

    const osc = ctx.createOscillator();
    osc.type = v.type || 'triangle';
    osc.frequency.setValueCurveAtTime(Float32Array.from(v.contour, (f) => f * j), now, d);
    // vibrato rides on detune (a separate param) so it doesn't clash with the
    // frequency curve above.
    if (v.vib) {
      const lfo = ctx.createOscillator(); const lg = ctx.createGain();
      lfo.frequency.value = v.vib; lg.gain.value = v.vibDepth || 12;
      lfo.connect(lg); lg.connect(osc.detune);
      lfo.start(now); lfo.stop(now + d + 0.02);
    }
    // optional low-pass tames bright/metallic harmonics into a warm body
    let voiceOut = osc;
    if (v.lowpass) {
      const tf = ctx.createBiquadFilter(); tf.type = 'lowpass';
      tf.frequency.value = v.lowpass; tf.Q.value = v.lowpassQ || 0.7;
      osc.connect(tf); voiceOut = tf;
    }
    voiceOut.connect(g);
    osc.start(now); osc.stop(now + d + 0.03);

    if (v.noise) {                              // growl/breath texture (Dino)
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuffer(ctx, d);
      const nf = ctx.createBiquadFilter(); nf.type = v.noiseType || 'bandpass';
      nf.frequency.value = v.noiseFreq || 700; nf.Q.value = v.noiseQ || 0.8;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.linearRampToValueAtTime(v.noise, now + atk);
      ng.gain.exponentialRampToValueAtTime(0.0008, now + d);
      ns.connect(nf); nf.connect(ng); ng.connect(master);
      ns.start(now); ns.stop(now + d + 0.02);
    }
  }

  function startBuffer(buf) {
    const ctx = ensureCtx(); if (!ctx) return;
    const s = ctx.createBufferSource(); s.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.85;
    s.connect(g); g.connect(master); s.start();
  }
  function playClip(animal) {
    if (clipBuffers[animal]) { startBuffer(clipBuffers[animal]); return; }
    if (!resolveUrl) return;
    const ctx = ensureCtx(); if (!ctx) return;
    fetch(resolveUrl(CLIPS[animal]))
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => { clipBuffers[animal] = buf; startBuffer(buf); })
      .catch(() => {/* fall silent if the clip can't load */});
  }

  // ---- public API -----------------------------------------------------
  function play(animal) {
    if (muted) return;
    const ctx = ensureCtx(); if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    if (CLIPS[animal]) { playClip(animal); return; }
    tone(VOICES[animal] || VOICES.cat);
  }
  function setMuted(m) { muted = !!m; }
  function isMuted() { return muted; }
  function setResolver(fn) { resolveUrl = fn; }

  const Sfx = { play, setMuted, isMuted, setResolver, VOICES, CLIPS };
  global.PetSfx = Sfx;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sfx;
})(typeof globalThis !== 'undefined' ? globalThis : this);
