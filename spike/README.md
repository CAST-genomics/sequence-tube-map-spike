# The three.js spike

**This code is meant to die.** It exists to answer one question, and when it has, it is
either deleted or rewritten as a real module — never promoted as-is. Nothing else in the
repo may come to depend on it.

## The question

Does a three.js renderer of the tube map **look good and feel right under pan and zoom**?

Not "does it match the SVG." We are replacing the SVG surface, not impersonating it — a
renderer that is *better* than the SVG would score badly against a diff with it.

Panning and zooming is the whole rationale for the visualization. Highlighting,
hit-testing, the navigator and the segment boxes are all out of scope until there is a
verdict.

## What counts as failure

Fixed 2026-08-14, before any code existed. All three count, and they apply to the **best
technique tried, not the first**.

1. **Mush at fit scale** — the banding smears into a uniform field, or crawls and moirés
   when panned one pixel at a time.
2. **Stutter or tearing** during pan or zoom.
3. **Zoom cannot reach** a point where a haplotype is resolvable.

## The partition

| | |
|---|---|
| `src/` | the SVG viewer. Untouched, still runs, still the fallback. |
| `spike/` | this. Self-contained. |
| `public/` | fixtures — shared, but that is data, not code. |

1. **`spike/` imports nothing from `src/`.** The parser is *copied* here, not imported.
   Enforced by `importGuard.test.ts`, so it cannot erode silently.
2. **`src/` imports nothing from `spike/`.** Ever.
3. **Separate entry points.** Either runs without the other existing.
4. **No shared vocabulary.** This code says mesh, camera, instance, zoom. It does not say
   surface, viewBox, transform or scale.

## Running it

```
npm run dev     →  http://localhost:5173/spike/
```

`?fixture=small` (600 bp, the fast inner loop), `?fixture=5520` (the fixture every
judgment is made on), `?fixture=5514` (the widest strip).

## Design

Settled by interview, recorded in `notes/2026-08-14-three-js-spike-restarted.md`. The
technique derivation the shaders implement is `notes/2026-08-13-six-floats-per-band.html`.
