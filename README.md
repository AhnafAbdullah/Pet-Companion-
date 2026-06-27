# 🐾 Pet Companion

A tiny pixel-art pet — pick from **Inka** (cat), **owl**, **Dino**, **Foxi**,
and more — that lives at the bottom of your browser, walks across the page,
reacts when you click, lets you carry it around, and **grows** the more you
play with it.

Two kinds of companion share one engine: **procedural** pets (Inka, owl) are
drawn from code and literally re-pixel themselves as they level up — a
big-headed pastel baby gradually becomes a balanced adult and then a larger,
richer-coloured elder with a glowing aura and a crown. **Sprite** pets (Biscuit,
Vampire Biscuit, Dino, Foxi) are animated from real sprite sheets but reuse all
the same behaviour, physics, XP and growth scaling.

![preview](tools/preview.png)

## Features

- **Six companions** — two drawn procedurally (**Inka** the cat, owl) plus four
  pixel-sprite friends (**Biscuit**, **Vampire Biscuit**, the **Dino**, and
  **Foxi**) animated from real sprite sheets. Each has its own quirks (Inka's
  tail curl, owl wing-tuck; Biscuit tail-swishes and curls up in a **box** when
  it sleeps; Foxi trots, naps and gets spooked).
- **Dino colour skins** — the Dino comes in four colours (**Blue**, **Red**,
  **Yellow**, **Green**); pick one from the colour row in the popup and it swaps
  live on every open tab.
- **Lives on the page** — strolls along the bottom, pauses to sit, looks around,
  gets sleepy, blinks, and dozes off with little `z`'s.
- **Reacts to you** — click anywhere and it perks up and hops toward the click;
  **click** the pet to pet it (hearts!), or **drag** it anywhere on screen.
- **Gestures** — a **double-click** makes the pet flinch: the Dino plays its
  hurt animation, Foxi does a frightened rear-up. **Press and hold** triggers a
  pet's hold animation: Biscuit hops into a box (plays once), and Foxi curls up
  and **sleeps in a loop** until you let go.
- **Grows up** — earn XP by petting, feeding treats, and just browsing. Twelve
  levels from *Baby* → *Young* → *Adult* → *Elder* → *Mythic*, each visibly
  changing the pet's size, proportions, colours, aura, and sparkles.
- **Procedural motion** — physics-driven gait, vertical hops with
  squash-and-stretch, tail/ear sway, particle hearts & sparkles. No CSS
  keyframes; it's all `requestAnimationFrame`.
- **Popup control panel** — pick your friend, rename it, watch a live animated
  preview, feed treats, toggle visibility, and tune size & pace.
- **Never in your way** — the pet canvas never intercepts page clicks; only a
  small hit-area around the pet's body is interactive.

## Install (developer / unpacked)

1. Open `chrome://extensions` in Chrome (or Edge/Brave).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder (the one with `manifest.json`).
4. Open any normal web page — your companion appears at the bottom-left. Click
   the toolbar icon to choose your animal and feed treats.

> Content scripts don't run on `chrome://` pages, the Chrome Web Store, or the
> PDF viewer, so the pet won't show there — that's expected.

## How growth works

| Source        | XP    | Notes                                   |
| ------------- | ----- | --------------------------------------- |
| Pet the pet   | +2    | once per minute                         |
| Feed a treat  | +6    | from the popup                          |
| Passive       | +1    | every couple of minutes browsing, capped daily |

XP is stored in `chrome.storage.local`, so your pet is the same across every tab
and syncs instantly when you change something in the popup.

## Project layout

```
manifest.json              MV3 manifest
src/lib/raster.js          indexed-palette pixel buffer + drawing primitives
src/lib/critters.js        procedural cat (Inka) / owl art + growth model
src/lib/spritecat.js       sprite-sheet companions (Biscuit / Vampire Biscuit / Dino / Foxi) + loader
src/lib/storage.js         saved state + XP↔level curve (shared everywhere)
src/lib/pet.js             behaviour state-machine, physics, particles, renderer
src/assets/cat/            cat sprite sheets (Idle / drculacat / Box3, 32x32 strips)
src/assets/dino/           dino colour strips (doux / mort / tard / vita, 24-frame 24x24)
src/assets/fox/            Foxi sheet (fox.png, a 14x7 grid of 32x32 frames)
src/content/content.js     injects & hosts the pet on every page
src/content/content.css    overlay styling (canvas + hit-area + speech bubble)
src/popup/                 control panel (HTML/CSS/JS)
src/background/background.js  service worker — passive XP via alarms
tools/gen-icons.js         renders toolbar icons from the same critter art
tools/preview.js           dev: render an art sheet to tools/preview.png
icons/                     generated PNG icons (16/48/128)
```

## Development

Regenerate the icons or the art preview after tweaking the critters:

```bash
node tools/gen-icons.js     # -> icons/icon{16,48,128}.png
node tools/preview.js       # -> tools/preview.png
```

Both reuse the *exact* same `raster.js` + `critters.js` the extension runs, so
the preview is a faithful render of what walks your pages.

## Credits

The Biscuit and Vampire Biscuit companions use sprites from the **CatPackFree**
asset pack (`src/assets/cat/`). The Dino uses **Arks' "DinoSprites"** pack
(`src/assets/dino/`). Foxi uses a free **fox sprite sheet** (`src/assets/fox/`).
Inka (cat) and the owl are original procedural art.

## Roadmap ideas

- Colour skins for more of the sprite pets (like the Dino's)
- More animals (bunny, dragon)
- Mini-interactions: throw a toy, the pet chases the cursor
- Optional name-tag and accessories unlocked by level
