---
status: accepted
date: 2026-08-13
---

# The viewer interprets the server's geometry, and draws it with WebGL

Two independent failures on 2026-08-12/13 — style invalidation at ~28 ms per hover,
and unpainted bands from a 900-megapixel composited layer — proved that this data
cannot be drawn through the DOM at any element count we will actually receive. We
are replacing the SVG surface with a three.js renderer that **parses the server's
SVG into geometry and rasterizes it on the GPU**, rather than displaying it.

This reverses three decisions recorded in `CONTEXT.md`, which is why it is written
down here rather than left as a bullet.

## The trade being made

`CONTEXT.md` #1 held that **the SVG is opaque and immutable** — the server sends a
picture and the viewer displays it. That is the single most load-bearing property of
the old design and it is what we are giving up. The viewer now *interprets* drawing
primitives: it reads `d` attributes, recognises a specific path grammar, and rebuilds
the image from numbers it inferred. UCSD becomes an upstream we are coupled to at the
level of drawing commands. A change on their side that an SVG viewer would absorb
silently — a text label, a stroke, a gradient — becomes a rendering bug for us.

We accept this because the alternative is not "keep the pure viewer." The pure viewer
does not work on this data. The choice was between interpreting the geometry and
restructuring the DOM renderer to re-draw a viewport-sized window on every navigation,
which is comparable work and leaves the ~28 ms interaction wall standing.

## What makes it tractable

The price is bounded by a fact measured, not assumed: **127,101 of 127,101 track paths
across 17 documents conform to one grammar, with zero exceptions.** (Originally
established on the fixture's 5,667 paths; confirmed 2026-08-13 across every node the
API would return — spans of 1 bp to 7,967 bp, 369 to 464 tracks. Larger nodes are
untested because they cannot be fetched.)

```
M x0 y0  C cx y0  cx y1  x1 y1   V y1+15  C dx y1+15  dx y0+15  x0 y0+15  Z
```

Both control points of each cubic share an x, so `x(t)` is strictly monotone and each
edge is a true function of x. The y profile expands to `y0 + (y1-y0)·(3t² − 2t³)` —
literally `smoothstep`. Band thickness is **15** for every band in the map, and the
4,603 `<rect>` elements are the same primitive degenerate.

So a band is six floats, and the renderer needs no path parser and no tessellator.

**A band is a fragment, not a ribbon.** One haplotype is drawn as many pieces — a
median of 28 in the fixture, ~87 in `5520+` — alternating between segment-crossing
rectangles and inter-segment curves. That fragmentation is *why* the grammar is
uniform: the server has already decomposed every track into elementary smoothstep
transitions, which is the reason there are no arbitrary beziers left to tessellate.
Two further consequences, both measured:

- **The pieces are lapped, not butted.** Every one of 9,883 joins overlaps by exactly
  **1.0 unit** with identical y on both sides. Abutting shapes under analytic coverage
  would seam; lapped ones do not, and since lapped pieces share a track and therefore a
  colour, the double-blend is a no-op. The seam problem is solved upstream.
- **The instance count is irreducible.** Merging consecutive collinear pieces saves
  **0%** — a track never has two horizontal pieces in a row at the same y, because the
  two kinds strictly alternate.

## Consequences

- **One instanced draw call.** A shared parametric "ladder" mesh, replicated per band
  via `InstancedBufferGeometry`. The vertex shader places rungs on the curve; the
  fragment shader computes exact vertical coverage against both edges. Chosen over
  bounding-box quads (measured 9.2× wasted fragments) and over plain MSAA
  tessellation, because at fit scale a band is **0.6 CSS px** tall and MSAA's
  quantised coverage would alias 464 stacked sub-pixel ribbons into noise. Analytic
  coverage is what makes the SVG look right, so it is what we reproduce.
- **A validation gate, and the SVG surface kept as its fallback.** Anything in
  `g.track` that does not match the grammar rejects the **whole** document, loudly,
  and falls back. Partial rendering is not offered: this API already returns
  200-with-plausible-nonsense for an unknown `minigraphnode`, and a half-drawn map is
  a silently wrong map. The 75 stroked, translucent segment boxes in `g.node` are a
  whitelisted exception — they stay as DOM SVG in an overlay, which also keeps
  segment hit-testing free.
- **Appearance becomes a table, not a stylesheet.** Each instance carries its
  `trackID`; a `DataTexture` holds one texel of appearance per track. Highlighting is
  a ~2 KB upload whose cost is independent of how many strands are lit — retiring the
  ~28 ms wall that `CONTEXT.md` #15 ran into, and reviving feeler mode.
- **The canvas is viewport-sized.** The 2026-08-13 rendering failure is not fixed but
  made structurally impossible: there is no oversized composited layer to tile.
- **`viewportTransform.ts` survives untouched** and drives an `OrthographicCamera`. No
  `MapControls` object is constructed — `CONTEXT.md` #8 is about gesture feel, which
  the existing pointer handling already replicates and unit-tests.
- **`CONTEXT.md` #5's rationale inverts.** "No three.js, zero dependency overlap with
  PGB's 3D stack" was a virtue; the overlap is now the point, and the version is
  pinned to PGB's `^0.176.0`.
- **This does not address transport.** The largest catalogued nodes cannot be fetched
  at all — see [`notes/2026-08-13-api-fetch-ceiling.md`](../../notes/2026-08-13-api-fetch-ceiling.md).
  A compact geometry format from UCSD is the natural follow-on, and this decision is
  what makes that request specific enough to be worth making.
