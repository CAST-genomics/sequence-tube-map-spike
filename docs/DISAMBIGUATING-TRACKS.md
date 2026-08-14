# Strategies for disambiguating sequence tube map tracks

**Status: open. Nothing here is decided.** This is the toolkit, the constraints each tool
has to survive, and what is known versus assumed about each. Started 2026-08-14, from
ideas raised while working through the renderer tickets; expected to grow as strategies
are tried and as some of them fail.

The problem itself is pinned in **#32**, which measured it and deliberately stopped there.
This document is the layer above the tickets that build pieces of an answer — **#38**
(track picking: which haplotype is under the cursor) and **#39** (highlighting and feeler
mode) — and it exists so those get built against a strategy rather than each inventing
one.

## What this panel is, so the scope is not overstated

This is the **sequence tube map** panel: one visualization of one thing, reached by
clicking a minigraph node in the PGB browser and asking to see inside it. It is not the
application, and the problem below is not the application's problem. It is this
visualization's central problem, and it has to be solved in this visualization's own terms.

## Why this is the problem, and not one feature among many

`SPEC.md` story 28: *"separate one haplotype from its neighbours even when they are nearly
the same color, so that genetic similarity does not prevent me from reading individual
paths."*

Everything else in this panel — pan, zoom, the navigator, the band renderer — exists to
put the data on screen. This is the part that makes it *readable*, and it is the part we
have not seen solved anywhere. The reason it is hard is specific:

- **The palette is inherited, and it was derived for a different picture.** See below;
  this is the crux and it is not a property of the data so much as of the encoding.
- **Tracks share colors outright, not merely nearly.** On the tube map's own `5520+`,
  464 tracks carry 108 distinct colors and at least 356 share a color with another track
  *exactly* (#32). **No amount of magnification separates them** — this is not a
  resolution problem with a zoom-shaped fix, and any strategy resting on "it resolves
  once a band is several pixels tall" is answering the decimation problem instead of
  this one.
- **The scale is against us.** 464 tracks on `5520+`, 40,442 bands. At fit, 464 tracks
  land on ~177 device rows — 2.6 tracks per pixel row (`RENDERING.md`). Below one pixel
  per band, *no* appearance strategy is legible, because there is no pixel to spend on it.
- **A strand does not fit on the screen.** The strip is 14:1 to 28:1. Following one
  haplotype means following it across tens of screens, so anything that identifies a
  strand only where the cursor is has answered a smaller question than the one asked.
- **Crossings are the moment of ambiguity.** Two same-colored tracks that swap vertical
  position are exactly where the eye loses the thread, and exactly where the picture
  offers the least — abutting bands of the same color.

So the target is not "make the selected one visible". It is **make one path followable
across the whole node, without lying about color, at zoom levels where the strand is
thinner than a pixel.**

## Where the palette comes from, and what it was built to do

This panel does not choose its track colors and should not start. They arrive in the
`RGB` field beside each PCLAI coordinate, computed upstream as a visual encoding of the
haplotype's position in PCA space; PGB's 3D graph and its PCLAI chart read the same field.
PGB's own note is explicit: *"The colors in PCLAI are not chosen — they ship with the
data … the model's own visual encoding of each point's PCA location (so that two points
close in PCA space are also close in color); the visualization reads them, it does not
interpret."*

**That encoding was designed for the PCLAI chart, and it is good there.** The chart is a
2D scatter of PCA space against the reference-panel backdrop, where **position** does the
separating: every point sits at its own coordinate, and color is a redundant, supporting
cue that ties a dot to the same haplotype elsewhere. "Close in PCA → close in color" is a
feature when position already tells the points apart.

**The tube map inherits that encoding into a picture with no position channel to spare.**
Vertical order here is layout — where the server routed a ribbon so the bundle reads —
not identity, and it changes along the strip. Color is left carrying the entire
discrimination burden, and it was never built to bear it. So the limitation the tube map
runs into is the chart's color derivation, arriving in a context the derivation was not
designed for.

Measured in PGB's own datasets rather than downstream of them
(`scripts/pclai_color_collisions.py`, run over `pgb/public/datasets/api-v3`), for the node
carrying the most placed haplotypes in each:

| Dataset | Placed haplotypes | Distinct colors | Share a color exactly | Distinct colors within 1/255 of another |
|---|---|---|---|---|
| `cici.json` | 460 | 117 | 398 | 95 |
| `chr6-160531482-160664275.json` | 463 | 149 | 383 | 128 |
| `egfr.json` | 455 | 145 | 372 | 115 |
| `il7.json` | 461 | 137 | 388 | 109 |
| `PCBD1-pca-chart-dot-issue.json` | 459 | 129 | 386 | 101 |
| `small-graph-chr2-879500-880000.json` | 452 | 128 | 374 | 95 |

Roughly **460 haplotypes are being encoded into 120–150 distinct colors**, four in five of
them sharing a color exactly with another haplotype, and most of the distinct colors
having a neighbour **one part in 255** away. This is systemic across every dataset, not a
quirk of one locus.

And the collapse is not confined to haplotypes that are genuinely alike. At `cici.json`'s
busiest node, two haplotypes **8% of the PCA cloud's diameter apart** receive the *same*
RGB. Closeness in color does carry meaning; **equality of color does not** — that is
quantisation, not a claim that two haplotypes are the same.

**Why this framing matters for what gets built.** If the colors were simply the honest
signal of genetic similarity, the only answer would be resignation. They are not: they are
one encoding of a coordinate, chosen for a chart where position did the separating. The
tube map's job is therefore to **add back a channel the chart never needed** — which is a
data visualization problem with data visualization answers, and it is what the strategies
below are for.

Two constraints survive from this, and they pull in opposite directions:

- **Do not recolor arbitrarily.** The color is shared vocabulary with the chart and the
  3D graph; a researcher crossing between panels reads them together (`SPEC.md` story 31).
- **Do not treat the shipped encoding as sufficient.** It demonstrably is not, and
  deferring to it is how this problem stays unsolved.

## What changed, and what did not

`notes/2026-08-13-direct-strand-interaction-is-not-viable.md` measured the first attempt
and produced a rule: *appearance changes must be discrete, user-initiated events, budgeted
at ~28 ms each; nothing wired to pointer position.*

**That number is a fact about the SVG DOM, not about this problem.** The 28 ms was style
invalidation across ~10,000 elements. The WebGL surface has one mesh and one draw call;
changing which track is emphasized is a buffer or uniform write, and the shader already
runs per fragment regardless. There is every reason to expect the constraint to lift, and
**it has not been measured**, so no strategy below may be justified by assuming it has.

What has *not* changed is the part of that note that was never about performance: a
highlight wired to pointer position is also a **design** choice, and the note deliberately
kept the two reasons apart because they have different expiry dates. If direct
manipulation comes back, it comes back because it was measured and because it reads well —
not because the old obstacle was removed.

## Strategy A — hold a modifier, emphasize one, recede the rest

*Raised originally for the SVG surface; blocked there by the 28 ms restyle. Re-opened
because the renderer changed.*

Hold `Shift` (or another modifier), move over a track, that track stays fully drawn and
the others recede. What "recede" means is the open question, and the candidates are not
equivalent:

| Treatment | What it costs | What it risks |
|---|---|---|
| Translucent — drop alpha on the others | one multiply in the fragment shader | at fit the map is already washed toward white by coverage compositing (`RENDERING.md`); dimming the crowd may leave nothing to sit against |
| Desaturate toward gray | one line, keeps the shape of the map | gray already *means* something — `pclaiX="None"`, including `GRCh38#0#chr1` |
| Remove entirely | cheapest to read; the strand is alone on the page | destroys the context that makes a path meaningful — a haplotype's position relative to its neighbours is the thing being read |
| Dim but keep the envelope | preserves where the crowd is without competing | needs a real design, not a constant |

`SPEC.md` story 30 already settled the direction — *recede the others rather than brighten
the one* — because at hundreds of saturated neighbours, brightening does not read. That
holds regardless of which treatment above wins.

**What has to be answered before this is built:**

1. Is it fast enough now, measured rather than assumed, at pointer rate on `5520+`?
2. Does it survive the sub-pixel regime? At fit there may be no pixel in which "receded"
   and "not receded" can differ. If the answer is that this only works past some zoom, say
   so and make the affordance honest about it.
3. What is being pointed *at* — the track under the cursor needs picking. GPU colour
   picking was the plan (`CONTEXT.md` #6); it is not built, and it is **#38**. Note that
   picking answers a different question from disambiguation: it says which track is under
   the cursor, not which track you are looking at three screens to the right. A strategy
   that only works where the cursor is has not solved this.
4. Does the emphasis persist along the whole strand, including the parts off screen
   (story 34)? If yes, the navigator should show it too — which is an argument for the
   thumbnail being re-rendered on selection, cheap because it is one render.

## Strategy B — use depth, now that we are in 3D

*Raised 2026-08-14. New: it was not available on the SVG surface at all.*

The observation behind it: tracks disambiguate themselves in their **excursions** — a
track crossing others is the moment it becomes distinct, and crossing is a depth relation
we currently throw away. The renderer already has this information and discards it:
instance order carries z-order where two tracks overlap, and that is the only sense in
which the map has depth today.

Candidate forms:

- **Lift the selected track in z.** Give the emphasized track its own depth level so it
  passes *over* everything it crosses rather than being interleaved.
- **Drop shadow / contact shadow.** A soft dark offset under the lifted track. This is the
  cue that actually makes lift visible, and it works at small scale — a shadow is a
  low-frequency signal, which is exactly what survives when the strand itself is
  sub-pixel.
- **Depth as a continuous channel.** Not one lifted track but every track at its own
  level, so crossings are consistently resolved everywhere rather than only at a
  selection. Closer to the physical intuition of ribbons in a bundle.

**The hard constraints this runs into, all of them in the current renderer:**

- **The camera is orthographic and will stay that way.** There is no parallax and no
  perspective foreshortening, so translating a track in z produces *no image change at
  all* on its own. Depth in this renderer reads only through cues we draw: occlusion
  order, shadow, outline, or a deliberate screen-space offset. That is not a reason to
  drop the strategy — it is the reason the shadow is the substance of it, and "translate
  it in z" alone is not.
- **There is no depth buffer.** `depthTest` and `depthWrite` are both off, on purpose:
  coverage arrives as alpha and bands are painted in instance order. Turning on depth
  testing to get real occlusion conflicts with sub-pixel alpha coverage — a depth-tested
  fragment wins or loses outright, which is precisely the "MSAA discards rather than
  dissolves" failure the renderer already rejected once. **A depth strategy therefore
  has to be a compositing strategy, not a z-buffer strategy**, or it has to give up
  analytic coverage at small scale.
- **Order is already meaningful.** Instance order is document order is paint order.
  Anything that reorders or re-levels tracks is changing what the picture asserts about
  overlaps, so it needs to be a deliberate claim rather than a side effect.

The version of this that looks most promising on paper — and it is only on paper — is
**one lifted track plus its shadow, composited, with the depth buffer left off**: draw the
map, then draw the selected track again over it with an offset dark pass beneath. That is
two extra draw calls for one instance's worth of geometry, costs nothing per frame, and
needs no change to how the other 463 tracks are drawn.

## Constraints any strategy has to survive

Written once here so each proposal can be checked against them rather than re-arguing:

1. **Color stays undistorted** (story 31). PCLAI is the map's primary channel.
2. **The whole strand, not the visible part** (story 34).
3. **Legibility at fit is bounded by pixels, not by cleverness.** Below one pixel per
   band, the honest answers are low-frequency cues (shadow, envelope, position) or
   telling the researcher to zoom — not a subtler shade.
4. **No chrome inside the viewing surface** (`SPEC.md`, Solution). Legends and axes are
   out; the navigator is the standing exception and it sits over the map, not in it.
5. **Judged by looking.** Every rendering decision in this repo has been settled by
   putting it on screen against `5520+`, not by reasoning about it. These will be too.
6. **Whatever is measured, measure it on a real document.** The 600 bp fixture has
   misled this project twice — the 4× zoom cap and the navigator's 360 px width were both
   calibrated against it.

## Not yet discussed — parked so they are not lost

Listed for completeness, from the same problem rather than from the conversation that
started this document. None of these have been thought through:

- An **outline or halo** on the selected track — a screen-space stroke reads at any zoom
  and does not touch the fill color.
- **Appearance as a lookup table** — one texel per track, RGB plus a dim factor, so
  emphasis costs a ~2 KB upload regardless of how many tracks are lit (#32). This is a
  mechanism rather than a strategy, but it is the mechanism most of Strategy A would be
  built on, and it was deliberately deferred out of the spike for exactly this.
- **Indirect selection**, which the 2026-08-13 note already argues for: a strand list, a
  search on `sample#haplotype#contig`, a palette assigning colors to samples, or selection
  arriving from PGB, which already knows which sample the researcher came in caring about.
- **Motion.** A slow animated flow along one strand distinguishes it with no static ink at
  all, and motion is the one channel that survives at sub-pixel scale. It also risks being
  the strobing distraction story 25 rules out.
- **Exploded / spread view** — temporarily separating tracks vertically so crossings
  resolve, at the cost of the layout the server gave us.

## Where this gets decided

Not here. This document is the shared vocabulary; each strategy that gets tried gets a
dated note with what was rendered and what was seen, the way the renderer decisions were
settled, and the outcome comes back here as a line under the strategy it belongs to.
