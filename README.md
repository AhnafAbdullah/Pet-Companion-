# 🐾 Pet Companion

> A tiny pixel-art pet that lives at the bottom of your browser — it walks across
> the page, reacts when you click, purrs when you pet it, and **grows up** the more
> you play with it.

Pick your friend — **Biscuit** (the default kitten), **Vampire Biscuit**, the
**Dino** (in four colours), **Amber** the fox, or the two hand-coded critters
**Inka** the cat and **Owly** the owl — then get back to browsing while they
potter around at your feet.

![preview](tools/preview.png)

Two kinds of companion share one engine. **Procedural** pets (Inka, Owly) are
drawn entirely from code and literally re-pixel themselves as they level up — a
big-headed pastel baby gradually becomes a balanced adult and then a larger,
richer-coloured elder with a glowing aura and a crown. **Sprite** pets (Biscuit,
Vampire Biscuit, Dino, Amber) are animated from real sprite sheets but reuse all
the same behaviour, physics, XP and growth scaling.

## ✨ Highlights

- **Six companions, one engine** — two drawn procedurally, four from sprite
  sheets, all sharing the same physics, XP and growth.
- **It lives on the page** — strolls along the bottom, pauses to sit, looks
  around, gets sleepy, blinks, and dozes off with little `z`'s.
- **It reacts to you** — pet it, carry it, double-click it, or press-and-hold it;
  each pet responds differently (see the cheat-sheet below).
- **Every pet has a voice** — a soft, synthesized sound plays when you pet it
  (a meow, a hoot, a squeak, a little roar…), generated in code — no audio files.
  Mute it any time.
- **Grows up** — twelve levels from *Baby* → *Young* → *Adult* → *Elder* →
  *Mythic*, each visibly changing the pet's size, proportions, colours, aura and
  sparkles.
- **Stays out of your way** — a **Movement** toggle pins the pet in place so it
  never wanders over your content, and the canvas never intercepts page clicks.
- **100% local & private** — everything is stored in `chrome.storage.local`.
  No accounts, no network requests, no telemetry.

## 🎮 How to play

Everything happens through the pet on the page, or the toolbar **popup**.

### Interactions cheat-sheet

| Gesture | What happens |
| --- | --- |
| **Click** the pet | Pet it — hearts + its voice · **+2 XP** (once/min) |
| **Double-click** the pet | **Dino** flinches, **Amber** gets spooked · **−6 XP**. Other pets just get petted |
| **Press & hold** the pet | **Biscuit** curls into its box for a nap · **Amber** sleeps until you let go |
| **Drag** the pet | Pick it up and drop it anywhere on screen |
| **Click elsewhere** on the page | The pet perks up and hops toward the click *(when Movement is on)* |
| **Feed a treat** (popup) | A happy cheer · **+6 XP** and a treat 🍪 |

New here? Your pet greets you with a short, per-character tip the first time it
appears (and again whenever you switch friends), so you learn each one's moves.

### Popup control panel

Choose your companion, pick a **Dino colour skin**, rename your pet, and watch a
live animated preview. From here you can also:

- **🍪 Feed treat** / **💗 Pet** — earn XP and shower it with affection
- **👁 Showing / 🚫 Hidden** — hide the pet entirely
- **Size** (S / M / L) and **Pace** (Calm / Normal / Zoomies)
- **Movement** (🐾 On / 📌 Stay) — let it roam, or keep it put where you drop it
- **Sound** (🔊 On / 🔇 Off) — mute the pet's voice

## 📈 How growth works

| Source | XP | Notes |
| --- | --- | --- |
| Pet the pet | **+2** | once per minute |
| Feed a treat | **+6** | from the popup |
| Passive | **+1** | every couple of minutes browsing, capped daily |
| Hurt (double-click Dino / Amber) | **−6** | flinching costs a little XP — be gentle! |

XP is stored in `chrome.storage.local`, so your pet is the same across every tab
and syncs instantly when you change something in the popup.

## 🚀 Install (developer / unpacked)

1. Open `chrome://extensions` in Chrome (or Edge/Brave).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder (the one with `manifest.json`).
4. Open any normal web page — your companion appears at the bottom-left. Click
   the toolbar icon to choose your friend and feed treats.

> Content scripts don't run on `chrome://` pages, the Chrome Web Store, or the
> PDF viewer, so the pet won't show there — that's expected.

## 🗂 Project layout

```
manifest.json                MV3 manifest
src/lib/raster.js            indexed-palette pixel buffer + drawing primitives
src/lib/critters.js          procedural cat (Inka) / owl (Owly) art + growth model
src/lib/spritecat.js         sprite-sheet companions (Biscuit / Vampire Biscuit / Dino / Amber) + loader
src/lib/petsfx.js            per-pet synthesized voices (Web Audio) + clip-override hook
src/lib/storage.js           saved state + XP↔level curve (shared everywhere)
src/lib/pet.js               behaviour state-machine, physics, particles, renderer
src/assets/cat/              cat sprite sheets (Idle / drculacat / Box3, 32×32 strips)
src/assets/dino/             dino colour strips (doux / mort / tard / vita, 24-frame 24×24)
src/assets/fox/              Amber's sheet (fox.png, a 14×7 grid of 32×32 frames)
src/content/content.js       injects & hosts the pet on every page
src/content/content.css      overlay styling (canvas + hit-area + speech bubble)
src/popup/                   control panel (HTML/CSS/JS)
src/background/background.js service worker — passive XP via alarms
tools/gen-icons.js           renders toolbar icons from the same critter art
tools/preview.js             dev: render an art sheet to tools/preview.png
icons/                       generated PNG icons (16/48/128)
```

## 🛠 Development

Regenerate the icons or the art preview after tweaking the critters:

```bash
node tools/gen-icons.js     # -> icons/icon{16,48,128}.png
node tools/preview.js       # -> tools/preview.png
```

Both reuse the *exact* same `raster.js` + `critters.js` the extension runs, so
the preview is a faithful render of what walks your pages.

## 🤝 Contributing

Adding your own pet is the whole point — the engine is animal-agnostic, so a new
sprite companion is mostly data. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for
a step-by-step "add a pet in a few minutes" guide, plus the code style and PR
checklist.

## 🎨 Credits

The **Biscuit** and **Vampire Biscuit** companions use sprites from the
**CatPackFree** asset pack (`src/assets/cat/`). The **Dino** uses **Arks'
"DinoSprites"** pack (`src/assets/dino/`). **Amber** uses a free **fox sprite
sheet** (`src/assets/fox/`). **Inka** (cat) and **Owly** (owl) are original
procedural art, and every pet's voice is synthesized from code.

> **Note for contributors/redistributors:** each third-party sprite pack keeps
> its own license — check the source before redistributing the raw assets, and
> keep attribution intact.

## 🗺 Roadmap ideas

- Colour skins for more of the sprite pets (like the Dino's)
- More animals (bunny, dragon)
- Mini-interactions: throw a toy, the pet chases the cursor
- Optional name-tag and accessories unlocked by level
- Recorded-clip voices via the `petsfx.js` override hook
