# SVG rendering hits its ceiling — diagnosed 2026-08-13

Second failure of the day, unrelated in symptom to the feeler and identical in root
cause: **this data is too big for the DOM to draw.** Recorded here because it is the
reason the renderer is being reconsidered, and because the facts gathered while
diagnosing it are most of the brief for what replaces it.

## Symptom

Zoom in, then zoom back out, and the surface comes apart: large rectangular bands of
the map simply absent, shuddering during navigation, and occasionally the harness
picker scrolling out of view. The navigator stayed correct throughout.

## Diagnosis

**Confirmed by the user in devtools: unticking `will-change: transform` on
`.stm-content` heals the rendering immediately.**

The evidence that pointed there, in order:

1. **The transform math is not at fault.** A Playwright harness drove the real app
   through ten scenarios — zoom round-trips to `MAX_SCALE` and back, off-centre
   cursors, interleaved pans, ctrl+wheel pinch, 400 tiny trackpad deltas, resize
   while zoomed in both directions, navigator jump, reload-after-zoom. Every one
   returned `{x, y, scale}` to bit-identical fit values. Painted-pixel checks agreed:
   28.5% ink at fit, 28.5% after a full round trip.

2. **The user's screenshot, measured against a control render** at the identical
   viewport (1415×938, dpr 2):

   ```
   control   body spans columns  0..77   rows 662..1150
   broken    body spans columns 17..56   rows 662..1150
   ```

   The vertical extent is *exactly* right and only a horizontal band is missing. A
   wrong scale shrinks both axes together, so this was never geometry — a rectangular
   region of the picture was never painted.

3. **The navigator's immunity was the tell.** It bakes the SVG into a ~510 px
   `<canvas>` once at load (`navigator.ts`), so it is a small fixed bitmap with no
   display list and no re-rasterization. It cannot fail this way. The surface can.

## Mechanism

`will-change: transform` promotes `.stm-content` to its own composited layer. That
layer is the whole strip:

| | |
|---|---|
| Layer, CSS px | 35,562 × 6,325 |
| At dpr 2 | 71,125 × 12,650 device px — **900 megapixels** |
| At `MAX_SCALE` 4 | **14.4 gigapixels** |
| GPU max texture dimension | 16,384 |

The browser tiles such a layer and rasterizes only tiles near the viewport, which is
why it works at all. Zooming changes the raster scale, forcing re-rasterization of
new tiles from the display list; the blank bands are tiles that should have been
rasterized and were not. Two properties of this document make that expensive:

- The display list is a flat sequence of ~10,345 drawing commands with no spatial
  index.
- 369 ribbons each span the entire 35,562-unit width, so a large fraction of the
  list genuinely intersects every tile in its band.

**Note the symmetry with the feeler.** Both failures are the same data defeating a
different stage of the browser's pipeline — the feeler at *style* (invalidating
10,270 elements per hover, ~28 ms), this at *raster/composite*. Pan and zoom stay
cheap (8.3 ms) only because they touch neither: they hand the compositor a new matrix
for a bitmap it already has. See
[`2026-08-12-pan-zoom-frame-budget.md`](./2026-08-12-pan-zoom-frame-budget.md) and
[`2026-08-13-direct-strand-interaction-is-not-viable.md`](./2026-08-13-direct-strand-interaction-is-not-viable.md).

## Available fixes within SVG, and why they were not taken

- **Drop `will-change: transform`.** Heals it, but forfeits the composited layer that
  makes panning 8.3 ms. Cost unmeasured — the run was cut short in favour of changing
  renderer.
- **Cap `MAX_SCALE`.** Shrinks the worst case (14.4 GP is a function of 4×). A
  one-line stopgap, not a fix.
- **Size the layer to the viewport** and re-render the visible window on navigation.
  The principled answer within the DOM, and a genuine restructuring.

Decision, 2026-08-13: **spike a three.js renderer instead.** The two failures above
are both consequences of drawing this data through the DOM, and one renderer change
addresses both, rather than working around each separately.

## Facts for the renderer spike

Measured from the committed fixture, not assumed:

| | |
|---|---|
| `g.track` — `<rect>` | 4,603 |
| `g.track` — `<path>` | 5,667 |
| `g.node` — `<path>` (segment boxes) | 75 |
| Path commands present | `M` 5,742 · `C` 11,334 · `V` 5,667 · `Z` 5,667 · `Q` 300 · `L` 204 |
| Strokes | **75** — every segment box, `stroke-width: 2px` |
| Text elements | **none** |
| Gradients, clip paths, filters | **none** |

**Correction, 2026-08-13 (same day).** The line above originally read
"Strokes: **none** — every shape is a flat fill," and the element counts split
`<rect>`/`<path>` without regard to group. Both were wrong, and the stroke claim was
load-bearing for the "easy case" argument below. The 75 segment boxes live in
`g.node` and every one is `fill: rgb(255,255,255); fill-opacity: 0.4; stroke:
rgb(0,0,0); stroke-width: 2px` — rounded rects built from `Q` corners, translucent
**and** stroked. The `Q 300` and `L 204` counts are these. It remains a small,
special-cased population (75 elements, handled as a DOM overlay), but the fixture was
not stroke-free and the validation gate must be written against `g.track`
specifically.

A representative ribbon: `M 67 20 C … V 80 C … Z` — a closed band bounded by two
cubics with vertical ends. Within `g.track` this is the easy case for GPU conversion:
no stroke joins or caps, no dash patterns, no fill-rule ambiguity, and no text, which
is the hardest thing to render in WebGL.

**Rough sizing — superseded 2026-08-13.** The estimate below assumed general cubic
tessellation. Re-measuring the fixture showed **all 5,667 strand paths conform to one
grammar with zero exceptions**, with both control points of each cubic sharing an x
and a constant band thickness of 15. A band is therefore six floats, needs no
tessellator, and the map is ~10,270 instances of a single parametric shape in one
draw call — not 380k triangles. See
[`2026-08-13-webgl-band-renderer-spike-brief.md`](./2026-08-13-webgl-band-renderer-spike-brief.md)
and ADR [`0001`](../docs/adr/0001-webgl-band-renderer.md).

~~Sampling each cubic at 16–32 points makes every ribbon a small triangle strip: on
the order of 380k triangles for the whole map, mergeable into one buffer and one draw
call. Trivial for a GPU.~~

**What this buys beyond fixing the bug.** Highlighting stops being a style
invalidation and becomes a per-strand attribute or lookup-texture update — effectively
free — which retires the ~28 ms wall and would likely make direct hover interaction
viable again. Per-element hit-testing returns via GPU colour picking (render ids to
an offscreen buffer, read the pixel under the cursor). PGB already ships three.js, so
the dependency is free at the destination and `MapControls` parity comes with it.

**What it costs, and which settled decisions it overturns.**

- `CONTEXT.md` #1, *"the SVG is opaque and immutable"* — **this is the real price.**
  The viewer would begin *interpreting* the server's picture rather than displaying
  it. If UCSD later emits text labels, strokes, or gradients, an SVG viewer keeps
  working and a converter does not. Wants a validation check or a fallback path.
- `CONTEXT.md` #6, *"canvas forfeits per-element hit-testing, which the whole
  interaction model depends on"* — **premise already collapsed.** DOM hit-testing at
  pointer rate is precisely what does not work at this element count.
- `CONTEXT.md` #5, *"no three.js, zero dependency overlap with PGB's 3D stack"* —
  deliberately reversed; the overlap is now the point.
- Antialiasing is analytic in SVG and MSAA in WebGL. At fit scale 369 ribbons occupy
  ~249 px, so thin-feature quality must be **checked, not assumed**.
- `viewportTransform.ts`, the loader, and the navigator survive largely intact. The
  surface is what changes.

**Spike should answer:** does a tessellated render look as good as the SVG at fit
scale and at full zoom; does hover-highlight-a-strand feel instant; and how faithful
is the conversion against the fixture.
