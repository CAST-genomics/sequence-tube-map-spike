# Feeler mode, rebuilt on the appearance table — what it costs and where it reads

**Date:** 2026-08-14. **Ticket:** #39, over #38, against the problem measured in #32.
**Reproduce:** `npm run dev`, then

```
node scripts/verify_highlight.mjs                       # the committed 600 bp fixture
node scripts/verify_highlight.mjs '<a live node url>'   # the numbers below are 5520+
```

The strategy this belongs to is A in [`docs/DISAMBIGUATING-STRANDS.md`](../docs/DISAMBIGUATING-STRANDS.md);
what follows is the dated record that document asks for.

## What was built

`Shift` held turns the cursor into a feeler. The map recedes on the key alone, the strand under
the cursor is drawn as the document drew it, moving the cursor hands the emphasis to the next
strand, and releasing brings the whole map back. Hover without `Shift` does nothing, and pan
and zoom are suppressed while the key is down.

The mechanism is the one #32 deferred out of the renderer spike. Strand appearance moved off
the per-instance colour attribute into a `DataTexture` of one texel per strand — RGB plus an
emphasis byte — which the vertex shader fetches by `trackID`. Moving the emphasis is one byte
per *strand* in that table, nothing per band, and the frame that follows uploads 2 KB.
`src/strandAppearance.ts` carries the reasoning; `src/__tests__/strandAppearance.test.ts` pins
the parts that could be silently wrong; `src/feelerKey.ts` is what `Shift` means, shared with
the SVG surface so that the key is defined once.

## The correction that shaped it: the emphasis follows, it does not accumulate

**#39 asked for accumulation** — "tracks highlight on contact and **accumulate**" — as do
`SPEC.md` story 29 and `CONTEXT.md` #14. It was built that way, looked at, and **the user
reversed it on the evidence**: swept across the bundle, accumulation leaves a widening trail
of lit strands behind the cursor, and the one strand being pointed at ends up as one of dozens
at full colour. That is the opposite of telling it apart from its neighbours, which is the
whole point of #32.

So exactly one strand is emphasized at a time. A comparison set is still a real want — it now
needs a deliberate gesture rather than the side effect of a sweep, and the table already
supports one, because it holds a byte per strand and has no opinion about how many are lit.

Two smaller decisions fell out of the same reversal:

- **The map recedes on the key alone**, before the cursor has touched anything. The mode is
  legible the instant it is entered rather than after a nudge.
- **Over empty space, nothing is emphasized and the map stays receded.** A sweep crosses gaps
  between bands constantly; springing back to full colour in each of them would strobe, and
  would read as the mode switching itself off.

## The cost, on `5520+` — 464 strands, 40,442 bands, fetched live

A 260-move sweep down the middle of the map at ~6× fit, during which the emphasis moved
**198 times across 198 distinct strands**:

| cost of moving the emphasis, by how many moves had already happened | median | worst |
|---|---|---|
| moves 0–9 | 0.000 ms | 0.100 ms |
| moves 10–24 | 0.000 ms | 0.100 ms |
| moves 25–49 | 0.000 ms | 0.100 ms |
| moves 50–99 | 0.000 ms | 0.100 ms |
| moves 100–end | 0.000 ms | 0.100 ms |

| | |
|---|---|
| worst table write over the whole sweep | 0.100 ms |
| **worst frame during the sweep** | **9.4 ms** |
| **worst frame over the same 260 moves without `Shift`** | **9.4 ms** |

The fixture — 369 strands, 10,270 bands, 75 moves across 76 strands — gives the same picture:
worst table write 0.200 ms, worst frame 9.3 ms against a 9.4 ms baseline.

Four things this says, in order of how load-bearing they are:

1. **The cost does not drift.** Both the median and the worst are flat across every window of
   the sweep, so this is not a monotone worst-so-far figure hiding a trend. The write is a
   fixed loop over the strand count and the measurement agrees.
2. **0.000 ms is below what the page timer resolves.** `performance.now()` in this browser
   quantises to 0.1 ms, so the honest reading is *under 100 µs*, not *zero*. The per-window
   worsts are what carry the claim; the structural argument — one byte per strand, nothing per
   band — is in `strandAppearance.test.ts`, which counts the texels a write touches.
3. **Highlighting is not what the frame costs, and the frame is inside budget.** 9.4 ms worst
   while sweeping is the same number as 9.4 ms worst over the identical moves with `Shift`
   released, comfortably inside a 16.67 ms frame and a third of the ~28 ms the DOM version
   spent per swap. What is in that 9.4 ms is mostly the pick pass, which is a synchronous
   readback (#38); the table write and its upload are not visible in it.
4. **The ~28 ms wall was a fact about the DOM.** `CONTEXT.md` #15 measured a single highlight
   swap on the SVG surface at ~28 ms of style invalidation across ~10,000 elements, with 190
   of 582 frames dropped during a sweep, and concluded that *changing the appearance of the
   strand set from pointer position will not perform*. That conclusion is retired for the
   WebGL surface, which is why feeler mode ships **on** here and stays off on the SVG surface.

## Where it reads, and where it does not

Judged by looking, per `docs/DISAMBIGUATING-STRANDS.md` constraint 5. The screenshots are
`notes/highlight-*.png`, written by the script.

- **At a working zoom it is unmistakable.** `highlight-5520-one-zoomed.png`: one strand at
  full colour traced across the whole window, its 463 neighbours ghosted behind it, the
  bundle's envelope still legible. This is the picture #32 asked for and could not have.
- **After a 260-move sweep, exactly one strand is lit.** `highlight-fixture-swept.png` is the
  reversal above, in a picture: 76 strands were crossed and one is at full colour.
- **At fit-to-width it does not locate anything.** `highlight-5520-one-at-fit.png`: a band is
  0.19 css pixels tall there and 5.7 strands share every device pixel row, and the emphasized
  strand cannot be picked out of the receded crowd by eye. This is
  `docs/DISAMBIGUATING-STRANDS.md` constraint 3 happening exactly as written — *legibility at
  fit is bounded by pixels, not by cleverness* — and it is the honest answer to that
  document's open question 2 for this treatment: **feeler mode works from about one css pixel
  per band upward.**

### A floor of ink was tried here, and removed

The emphasized band was briefly drawn *as though it were at least one pixel thick*, so that a
sub-pixel band would not composite at a fraction of its own colour. Removed, for two reasons
and in that order:

1. **It brightens the one instead of dimming the others**, which #39 forbids in as many words
   and `SPEC.md` story 30 asks for. It never touched colour — but a band emitting more ink
   than the document gave it is brightening by any observable test, and the defence that it
   only ever reached the ink a pixel-tall band would have had is an argument about the
   mechanism, not about what the eye sees.
2. **It bought nothing where it was supposed to.** On the fixture it turned a 59%-alpha
   hairline into a solid one; on `5520+` at fit, the regime it was added for, the strand still
   could not be found.

What it was reaching for is real and is a pixel budget, not a treatment to tune. The
candidates — a screen-space minimum thickness, or an outline on the emphasized strand — are in
`docs/DISAMBIGUATING-STRANDS.md`, and both trade the map's honesty about how thick a band is
for being able to find it. That trade has not been discussed.

## Choices worth knowing about

- **Emphasis is alpha, and colour is never written.** A receded strand is a ghost of itself
  rather than a repainted one, so whatever is behind it shows through, including the
  emphasized strand it crosses over. PCLAI colour is shared vocabulary with PGB's 3D graph and
  its chart (constraint 1), so highlighting does not touch it.
- **Two emphasis states, and a plain map is not "everything emphasized".** With the feeler
  away nothing recedes and the emphasis byte is 1 for every strand, so the map with no key held
  is drawn by exactly the arithmetic that drew it before any of this landed, from the same
  8-bit colours.
- **The pick pass ignores emphasis.** A receded strand is exactly what the feeler is reaching
  for next, so dimming what can be touched would make a sweep progressively harder.
- **The pick runs at most once per frame** (#38), so a fast sweep passes over strands without
  ever emphasizing them — the emphasis lands wherever the cursor is when the frame runs. That
  was a real limitation while touches accumulated into a set; with the emphasis following the
  cursor, a strand that was never emphasized is simply one the cursor was never on at the
  moment a frame ran.
- **Where strands overlap, the pick answers the front-most band, and that was left alone.**
  Raised 2026-08-15: the map is see-through at every band boundary — a quarter of the background
  shows through a seam, and a third of the rows are seams at 3 css px per band
  (`notes/2026-08-15-how-much-shows-through.md`) — so a strand behind another is plainly visible
  and looks selectable. It is not: the pick pass has no blending and no depth buffer, so the last
  fragment written wins, and instance order is paint order. Weighting the band by how much ink it
  put in the pixel, and peeling down the paint stack on a gesture, were both weighed.
  **Decided against, by the user: whatever is in front should win, because that is what the
  cursor is pointing at.** Recorded here so it is not rediscovered as a defect. Reaching a
  haplotype the cursor cannot single out is answered from the other direction, by name (#50).
- **The navigator is not re-rendered on selection.** Its thumbnail is baked once per document,
  so the emphasized strand does not appear in it. `docs/DISAMBIGUATING-STRANDS.md` raises this
  under Strategy A question 4 — the whole strand, including the parts off screen — and it
  stays open.

## Two things the SVG surface's feeler had and this one does not

Both are `SPEC.md` stories, both deliberate, and neither is a tuning question:

- **The emphasis moves instantly, not smoothly** (story 33). The SVG surface got its
  transition from a 120 ms CSS opacity animation it paid ~28 ms a frame to run. Here it would
  mean animating emphasis per strand and drawing every frame while it animates, and this
  surface draws on demand — a mounted map nobody is touching costs no frames at all. Left
  instant.
- **Nothing names the strand under the cursor** (story 35). The band parser reads geometry,
  colour and `trackID`; `trackName` is in the document and is not parsed, so the harness's
  `?pick` readout can only say `strand 135`. A feeler that emphasizes a haplotype without
  naming it is half of what story 35 asks for, and the missing half is a parser field and a
  tooltip.
