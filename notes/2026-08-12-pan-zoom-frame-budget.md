# Pan and zoom frame budget — measured 2026-08-12

Ticket #5 carries the project's main open performance risk: does a compositing
transform over ~10,345 live SVG elements stay smooth? **It does, with room to spare.**
No fallback from the ladder (reduce transition work → `content-visibility` →
reconsider) was needed.

## Method

Headless-driven Google Chrome (Playwright `channel: 'chrome'`), 1400×850 viewport,
dev server on `localhost:5173`, the committed fixture
(`chr1:25,331,046–25,331,646`, `minigraphnode=5519`). A `requestAnimationFrame`
sampler recorded inter-frame intervals while synthetic pointer and wheel events drove
the surface; the first two frames of each run are discarded. The display refreshes at
120 Hz, so **8.3 ms is a full frame rate, not a budget overrun** — the 60 Hz budget is
16.7 ms.

## Result

| Gesture | Frames | Median | p95 | Worst |
|---|---|---|---|---|
| Drag-pan at fit scale (whole map on screen) | 131 | 8.3 ms | 9.1 ms | 16.8 ms |
| Drag-pan at detail scale (~25× fit) | 124 | 8.3 ms | 8.9 ms | 9.2 ms |
| Wheel zoom burst, 40 notches in and out | 122 | 8.3 ms | 9.1 ms | 9.3 ms |

One dropped frame across the whole session, at fit scale, where every element is
inside the viewport at once. Detail scale is cheaper, as expected: the compositor
culls what is off-screen.

## What the measurement leans on

- The map moves by a CSS `transform` on a wrapping div, so a pan re-uses the existing
  composited layer instead of touching the DOM. Mutating `viewBox` instead would
  invalidate and re-lay-out all ~10,345 elements per frame.
- Hit-testing is suppressed for the duration of a drag
  (`.stm-root.is-panning .stm-content { pointer-events: none }`). This is what a drag
  *is* — a grip on the whole map rather than a pointer at anything inside it — so
  nothing is given up; the frames it spares are a side effect, not the reason.

## Sharpness is not traded away for this

Smooth-because-upscaled would be a fair suspicion of any composited-layer scheme, so
it was checked rather than assumed: at the 4× ceiling — a 100× magnification over this
fixture's fit scale of 0.0394 — diagonal strand edges render clean and straight, with
antialiasing confined to a single pixel. A layer rasterized at fit scale and scaled up
would be unrecognizable mush at that magnification. The browser re-rasterizes the SVG
at the live scale; the transform buys cheap movement, not a frozen bitmap. This is
issue #5's "stays vector-sharp at every zoom level" criterion, and it holds.

## Scope of this result

It covers **movement only**. Panning and zooming change one `transform` on one
composited layer, so the 10,345 elements are never revisited — that is precisely why
this is cheap. Anything that changes how those elements are *styled* pays a different
bill entirely, and pays it per change:
[`2026-08-13-direct-strand-interaction-is-not-viable.md`](./2026-08-13-direct-strand-interaction-is-not-viable.md)
measures the same map restyling at ~28 ms per highlight change. Do not read "pan and
zoom are cheap over 10,345 elements" as "10,345 elements are cheap."

## Caveat

This is a fast Apple-silicon Mac with a 120 Hz display, one map, one browser tab. It
establishes that the approach is not inherently expensive; it does not establish a
floor for older hardware. Re-measure if the element count rises by an order of
magnitude.
