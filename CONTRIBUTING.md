# Contributing to Pet Companion 🐾

Thanks for wanting to help! The single most fun contribution is **adding your own
pet** — the engine is animal-agnostic, so a new sprite companion is mostly data
and a sprite sheet. This guide walks you through it, plus the ground rules.

## Table of contents

- [Getting set up](#getting-set-up)
- [How the project is put together](#how-the-project-is-put-together)
- [Add a sprite pet (the fun part)](#add-a-sprite-pet-the-fun-part)
- [Colour skins (optional)](#colour-skins-optional)
- [Adding a voice (optional)](#adding-a-voice-optional)
- [Procedural pets](#procedural-pets)
- [Code style](#code-style)
- [Pull-request checklist](#pull-request-checklist)
- [Asset licensing — please read](#asset-licensing--please-read)

## Getting set up

There's **no build step and no dependencies** — it's vanilla JS. To run it:

1. Open `chrome://extensions` (Chrome/Edge/Brave), enable **Developer mode**.
2. **Load unpacked** → select the repo folder (the one with `manifest.json`).
3. Edit files, then hit the **reload** ↻ button on the extension card and
   **refresh the page** you're testing on to see your changes.

Node (any recent version) is handy for the icon/preview scripts and for the
`node --check` lint used in the PR checklist. No `npm install` required.

## How the project is put together

One engine drives every pet; individual pets only differ in how their body frame
is drawn.

| File | Responsibility |
| --- | --- |
| `src/lib/pet.js` | Behaviour state-machine, physics, particles, renderer |
| `src/lib/spritecat.js` | **Sprite pets live here** — sheet + animation data |
| `src/lib/critters.js` | Procedural pets (Inka, Owly) + growth model |
| `src/lib/storage.js` | Saved state + XP↔level curve |
| `src/lib/petsfx.js` | Per-pet synthesized voices |
| `src/popup/` | The control-panel popup |
| `src/content/content.js` | Hosts the pet on every page |

The engine drives pets through a small set of **states**: `idle`, `walk`, `sit`,
`cheer` (feed / level-up), `hurt` (double-click flinch), `sleep`, `held` (being
carried), and an optional press-and-hold animation. You only have to supply the
ones you have art for — everything falls back to `idle`.

## Add a sprite pet (the fun part)

We'll add a made-up **Bunny** whose sheet is a grid of 32×32 frames (rows =
animations). There are three supported sheet formats — a **grid** (like Amber),
a **single strip with frame sub-ranges** (like the Dino), and **one strip per
animation used whole** (like Biscuit). This example uses the grid; the other two
are documented inline in `spritecat.js`.

### 1. Drop in the sprite sheet

Put your PNG under `src/assets/`, e.g. `src/assets/bunny/bunny.png`.
Use a transparent background and keep frames on a consistent grid.

### 2. Register the sheet

In `src/lib/spritecat.js`, add an entry to `SHEETS` (the `frame` is the source
frame size in pixels):

```js
bunny: { file: 'src/assets/bunny/bunny.png', frames: 12, frame: 32 },
```

### 3. Describe the pet

Add an entry to `PETS`. `glow`/`ink` are `[r, g, b]` accent colours (the glow is
what tints the level-up aura, so pick your pet's signature colour):

```js
bunny: {
  label: 'Bun-bun',          // shown in the popup chooser
  glow: [255, 200, 220], ink: [110, 80, 95],
  sheet: 'bunny',            // single grid sheet
  frame: 32,
  footInset: 0,              // empty px below the feet in each frame (seats it on the ground)
  zoom: 1.4,                 // scale so it matches the other pets' height
  // grid clips: state -> { row, from, count, fps }
  clips: {
    idle:  { row: 0, from: 0, count: 4, fps: 5 },
    walk:  { row: 1, from: 0, count: 8, fps: 12 },
    cheer: { row: 2, from: 0, count: 6, fps: 12 },  // played on feed / level-up
    hurt:  { row: 3, from: 0, count: 4, fps: 10 },  // double-click flinch (optional; costs XP)
    sleep: { row: 4, from: 0, count: 4, fps: 3 },
  },
  // optional: press-and-hold behaviour
  // hold: { state: 'sleep', mode: 'loop' }, // 'loop' holds until release; 'once' plays through
},
```

Handy knobs you'll likely touch:

- **`footInset`** — if your pet floats above or sinks into the ground, adjust this.
- **`zoom`** — overall size relative to other pets.
- **`flipX: true`** — set this if your art faces left / its tail ends up on the
  wrong side when walking (Biscuit and Vampire Biscuit use it).
- **`hold`** — `{ state, mode }` for press-and-hold; `'once'` plays through
  (Biscuit's box), `'loop'` repeats until release (Amber's nap).

### 4. Allow the asset to load

In `manifest.json`, add your folder to `web_accessible_resources.resources`:

```json
"resources": ["src/assets/cat/*.png", "src/assets/dino/*.png", "src/assets/fox/*.png", "src/assets/sfx/*", "src/assets/bunny/*.png"],
```

### 5. Test it

Reload the extension and refresh a page. Your pet appears automatically in the
popup chooser (the display name comes from your `label`) — no popup code to edit.
Pick it and check: it walks, sits, sleeps, cheers on feed, and (if you gave it a
`hurt` clip) flinches on double-click.

That's it — a new companion in five steps.

## Colour skins (optional)

To offer colour variants (like the Dino's Blue/Red/Yellow/Green), give the pet a
`skins` array and a `defaultSkin`, where each skin points at its own sheet:

```js
skins: [
  { id: 'grey',  label: 'Grey',  sheet: 'bunny',      glow: [220, 220, 230] },
  { id: 'brown', label: 'Brown', sheet: 'bunny-brown', glow: [190, 150, 120] },
],
defaultSkin: 'grey',
```

Register each skin's sheet in `SHEETS`, and the popup grows a colour row for you.

## Adding a voice (optional)

Every pet gets a synthesized voice by default (a generic one if you don't specify).
To give yours a distinct sound, add an entry to `VOICES` in `src/lib/petsfx.js` —
`contour` is a list of frequency waypoints (Hz) swept over `dur` seconds:

```js
bunny: { type: 'triangle', contour: [700, 900, 780], dur: 0.14, gain: 0.4 },
```

Prefer a real recording? Drop a short clip in `src/assets/sfx/`, add its path to
`CLIPS` in `petsfx.js`, and it overrides the synth voice.

## Procedural pets

Pets like Inka and Owly are drawn from raster primitives in `src/lib/critters.js`
and re-proportion themselves as they grow. This is more involved than a sprite
pet — read the file header, copy an existing `draw*` function, and add your animal
to `THEMES` and `ANIMALS`. Happy to review a work-in-progress if you open a draft PR.

## Code style

- **Vanilla JS, no build, no dependencies.** Each module is an IIFE that attaches
  to a global (e.g. `global.PetSprites`) and also exports for Node.
- Match the surrounding style: concise, commented where intent isn't obvious, and
  the same naming/idiom as the file you're editing.
- Keep the extension **private by default** — no network calls, no analytics.
  State belongs in `chrome.storage.local` via `storage.js`.
- Guard `chrome.*` calls so an orphaned content script (after a dev reload) fails
  quietly rather than throwing.

## Pull-request checklist

- [ ] `node --check` passes on any `.js` you touched.
- [ ] Loaded unpacked and verified the behaviour in-browser (mention what you tested).
- [ ] No new dependencies, no build step, no network requests.
- [ ] Any new art has a **redistributable license** and attribution (see below).
- [ ] Updated the README/credits if you added a pet or a user-facing feature.
- [ ] Keep PRs focused — one pet or one feature per PR is easiest to review.

A screenshot or short GIF of your pet in action makes review (and merging) much
faster — and it's great launch material.

## Asset licensing — please read

Only contribute art you have the right to redistribute. Because these files ship
inside a public repo **and** a published extension, "free to use in a game" is not
always enough — some packs forbid redistributing the raw assets.

- Prefer **CC0 / public-domain** or your own original art.
- Include the source URL and license in your PR, and keep a `LICENSE.txt` (or
  equivalent) alongside the asset folder.
- If a license requires attribution, add it to the README **Credits** section.

When in doubt, ask in the PR — we'd rather sort it out before merging than pull it
later.
