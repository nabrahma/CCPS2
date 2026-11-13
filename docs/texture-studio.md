# Texture Studio (Part 2, M13)

PS2CC paints textures in [Material Painter](https://github.com/alla2001/material-painter), a free, open-source PBR texture painter. It has brushes with pen pressure, projection and stencils, layers, masks, smart masks, fills and a path tool. PS2CC sends it what to paint and takes the paint back. DECISIONS D-115 records why and how.

## Setting up

1. Install Material Painter from its [releases page](https://github.com/alla2001/material-painter/releases), using the installer or the zip. PS2CC looks for `MaterialPainter.exe` in `Program Files\Material Painter` and in your user `Programs\Material Painter` folder. If it's somewhere else, press **Locate Material Painter…**.
2. Turn on agent control. PS2CC drives Material Painter through its local agent server, which is off by default. The first time you press **Paint in Material Painter**, PS2CC offers **Turn on agent control**, which switches it on in Material Painter's preferences. You can also switch it on in Material Painter under Preferences → Agents. The server listens on 127.0.0.1 only.

## Painting the skin

Open **Skin → Texture Studio** and press **Paint in Material Painter**. Material Painter opens with:

- the character's body at its current shape, with MakeHuman's skin UVs;
- **PS2CC reference (do not paint)**, a fill layer holding the skin as PS2CC composites it now;
- **Paint**, an empty layer for you. Add any layers, masks or smart materials you like above the reference.

When you're done, press **Bring paint back**. PS2CC takes the base colour and keeps only the texels you changed, as a layer called *Painted in Material Painter* at the top of the skin stack. That's one undo step.

The paint is in the skin's own UV space, so it stays put whatever the body's shape. The layers under it stay live: change the base skin, the tone or the baked occlusion and the paint still sits on top.

**Paint again** reopens your Material Painter project, so all your layers are still there. The reference is refreshed with the skin as it is now, minus your painted layer, so nothing gets painted twice.

## Painting a garment

Select a worn garment in the viewport and use **Paint in Material Painter** in the inspector. The reference is the garment's own texture. The result comes back as the garment's paint texture over it, keeping the garment's own transparency. **Remove paint** goes back to the plain texture.

## Where things are

Each target has a folder under `Documents\PS2CC\paint\<character>\<skin or garment_slot>\` containing:
- `mesh.obj`: what was sent;
- `reference.png`: the texture you painted over;
- `project.mpp`: your Material Painter project;
- `export/`: Material Painter's last export.

Painted results go into the library (`overlays` for skin, `garment-textures` for garments) like any imported image.

## Tests

- `packages/core/test/m13.test.ts`:
  - paint comes back exactly;
  - it composites back to Material Painter's texture texel for texel;
  - it survives 20 random slider changes;
  - each import is one undo step.
- `app/backend/materialpainter` (Go):
  - the session's calls, against a stand-in server;
  - `PS2CC_MP_LIVE=1 go test -run TestLive ./backend/materialpainter/` runs a session against the real Material Painter.
- `pnpm test:painter`: the whole round trip in the desktop app with the real Material Painter, for the skin, a reopened session and a garment. It's skipped when Material Painter isn't installed.
