# Feeler mode, rebuilt on the appearance table — what it costs and where it reads

**Date:** 2026-08-14. **Ticket:** #39, over #38, against the problem measured in #32.
**Reproduce:** `npm run dev`, then

```
node scripts/verify_highlight.mjs                       # the committed 600 bp fixture
node scripts/verify_highlight.mjs '<a live node url>'   # the numbers below are 5520+
```

The strategy this belongs to is A in [`docs/DISAMBIGUATING-TRACKS.md`](../docs/DISAMBIGUATING-TRACKS.md);
what follows is the dated record that document asks for.

## What was built

`Shift` held turns the cursor into a feeler: the track under it lights, touches accumulate,
everything else recedes, releasing clears, and pan and zoom are suppressed for the duration.
Hover without `Shift` still does nothing.

The mechanism is the one #32 deferred out of the renderer spike. Track appearance moved off
the per-instance colour attribute into a `DataTexture` of one texel per track — RGB plus an
emphasis byte — which the vertex shader fetches by `trackID`. Lighting a track is one byte
per *track* in that table, nothing per band and nothing per already-lit track, and the frame
that follows uploads 2 KB. `src/trackAppearance.ts` carries the reasoning;
`src/__tests__/trackAppearance.test.ts` pins the parts that could be silently wrong.

## The cost, on `5520+` — 464 tracks, 40,442 bands, fetched live

A 260-move sweep down the middle of the map, at ~6× fit so the sweep actually crosses the
bundle, lighting **198 of 464 tracks**:

| | |
|---|---|
| median table write, 1–24 tracks lit | 0.000 ms |
| median table write, 25–49 · 50–99 · 100–199 lit | 0.000 · 0.000 · 0.000 ms |
| worst table write over the whole sweep | 0.7 ms |
| pick, the other half of one touch (median · worst) | 6.1 ms · 12.3 ms |
| **worst frame during the sweep** | **18.0 ms** |
| **worst frame over the same 260 moves without `Shift`** | **17.9 ms** |

And the fixture, 369 tracks and 10,270 bands, 104 lit: table write worst 0.3 ms, pick median
2.7 ms, worst frame 17.8 ms against a 17.7 ms baseline.

Three things this says, in order of how load-bearing they are:

1. **The cost does not depend on how many tracks are lit.** The median write is flat — and
   below what the page timer resolves, which clamps to 0.1 ms — from the first track lit to
   the hundred-and-ninety-eighth. The worst figure is monotone by construction, so both are
   reported: a single 0.7 ms outlier is what makes the worst column look like it grows.
2. **Highlighting is not what the frame costs.** The worst frame while sweeping and the worst
   frame over the identical moves with `Shift` released are the same number to within the
   noise. Both sit at ~18 ms because each pointer move runs a pick, and a pick is a
   synchronous readback that stalls the pipeline (#38 measured this); the table write and its
   upload are not visible in the frame at all.
3. **The ~28 ms wall is gone, and it was a fact about the DOM.** `CONTEXT.md` #15 measured a
   single highlight swap on the SVG surface at ~28 ms of style invalidation across ~10,000
   elements, with 190 of 582 frames dropped during a sweep, and concluded that *changing the
   appearance of the strand set from pointer position will not perform*. That conclusion is
   retired for the WebGL surface. Feeler mode therefore ships **on** here, where it ships off
   and stays off on the SVG surface.

## Where it reads, and where it does not

Judged by looking, per `docs/DISAMBIGUATING-TRACKS.md` constraint 5. All four screenshots are
`notes/highlight-*.png`, written by the script.

- **At a working zoom it is unmistakable.** `highlight-5520-one-zoomed.png`: one lit strand
  traced across the full width of the window, its 463 neighbours ghosted behind it, the
  bundle's envelope still legible. This is the picture #32 asked for and could not have.
- **At fit-to-width it does not locate anything.** `highlight-5520-one-at-fit.png`: a band is
  0.19 css pixels tall there and 5.7 tracks share every device pixel row, and the lit strand
  cannot be picked out of the receded crowd by eye. This is
  `docs/DISAMBIGUATING-TRACKS.md` constraint 3 happening exactly as written — *legibility at
  fit is bounded by pixels, not by cleverness* — and it is the honest answer to that
  document's open question 2 for this treatment: **feeler mode works from about one css pixel
  per band upward.**

  The fragment shader does draw a touched band as though it were at least one pixel thick,
  which is what keeps a sub-pixel lit strand from compositing at 39% of its own colour and
  disappearing on the fixture. It buys a solid hairline; it does not buy a hairline that can
  be found among hundreds of others. What would is a *screen-space* minimum thickness or an
  outline on the lit track — both listed as undiscussed in that document, and neither in
  scope here, because both make the lit track wider than the map says it is.

## Choices worth knowing about

- **Emphasis is alpha, and colour is never written.** A receded track is a ghost of itself
  rather than a repainted one, so whatever is behind it shows through, including a lit track
  it crosses over. PCLAI colour is shared vocabulary with PGB's 3D graph and its chart
  (constraint 1), so highlighting does not touch it.
- **Three emphasis states, not two.** A plain map is not "every track lit": with nothing lit,
  nothing recedes and no band is given a floor of ink. So the map with no key held is drawn by
  exactly the arithmetic that drew it before any of this landed, from the same 8-bit colours —
  `highlight-5520-plain.png`, put beside the previous renderer's output and looked at.
- **The pick pass ignores emphasis.** A receded track is exactly what the feeler is reaching
  for next, so dimming what can be touched would make a sweep progressively harder.
- **The navigator is not re-rendered on selection.** Its thumbnail is baked once per document,
  so a highlight does not appear in it. `docs/DISAMBIGUATING-TRACKS.md` raises this under
  Strategy A question 4 — the whole strand, including the parts off screen — and it stays
  open.
- **Leaving the canvas does not clear the selection.** Only releasing `Shift` does. Sweeping
  off one edge and back is part of following a strand across a 14:1 strip.

## Two things the SVG surface's feeler had and this one does not

Both are `SPEC.md` stories, both deliberate, and neither is a tuning question:

- **The highlight change is instant, not smooth** (story 33). The SVG surface got this from
  a 120 ms CSS opacity transition it paid ~28 ms a frame to run. Here it would mean animating
  emphasis per track and drawing every frame while it animates, and this surface draws on
  demand — a mounted map nobody is touching costs no frames at all. Left instant.
- **Nothing names the strand under the cursor** (story 35). The band parser reads geometry,
  colour and `trackID`; `trackName` is in the document and is not parsed, so the harness's
  `?pick` readout can only say `track 135`. A feeler that lights a haplotype without naming
  it is half of what story 35 asks for, and the missing half is a parser field and a tooltip.
