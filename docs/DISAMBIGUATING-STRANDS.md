# Strategies for disambiguating sequence tube map strands

**Status: open. Nothing here is decided.** This is the toolkit, the constraints each tool
has to survive, and what is known versus assumed about each. Started 2026-08-14, from
ideas raised while working through the renderer tickets; expected to grow as strategies
are tried and as some of them fail.

The problem itself is pinned in **#32**, which measured it and deliberately stopped there.
This document is the layer above the tickets that build pieces of an answer — **#38**
(strand picking: which haplotype is under the cursor) and **#39** (highlighting and feeler
mode) — and it exists so those get built against a strategy rather than each inventing
one.

## The observation

Strands that run in proximity — parallel, in clusters, which is most of the strip — are
often close enough in color that they cannot be told apart, and where the colors cannot be
separated the strands cannot be either. `SPEC.md` story 28 asks for the opposite:
*"separate one haplotype from its neighbours even when they are nearly the same color."*

That is the whole of it. A few details shape what an answer can look like:

- **Sometimes the colors are not merely close, they are equal.** On `5520+`, 464 strands
  carry 108 distinct colors and at least 356 share one with another strand exactly (#32).
  Where that happens, magnification does not help — so a strategy that assumes the picture
  resolves once a band is a few pixels tall is answering a different question.
- **At fit there is no room to draw a distinction.** 464 strands land on ~177 device rows,
  2.6 strands per pixel row (`RENDERING.md`). Below one pixel per band only low-frequency
  cues survive.
- **A strand does not fit on the screen.** The strip is 14:1 to 28:1, so following one
  haplotype means following it across tens of screens. Identifying a strand only where the
  cursor sits answers a smaller question than the one being asked.
- **Crossings are where the eye loses the thread**, and where the picture offers least:
  abutting bands of the same color.

## Why the colors collide

The tube map does not choose its strand colors and should not start. They arrive in the
`RGB` field beside each PCLAI coordinate, computed upstream as a visual encoding of the
haplotype's position in PCA space; PGB's 3D graph and its PCLAI chart read the same field.
PGB's own note is explicit: *"The colors in PCLAI are not chosen — they ship with the
data … the model's own visual encoding of each point's PCA location (so that two points
close in PCA space are also close in color); the visualization reads them, it does not
interpret."*

That encoding was designed for the PCLAI chart, and works there. The chart is a 2D
scatter of PCA space against the reference-panel backdrop, where **position** does the
separating: every point sits at its own coordinate, and color is a supporting cue tying a
dot to the same haplotype elsewhere. "Close in PCA → close in color" is a feature when
position already tells the points apart.

The tube map inherits that encoding into a picture with no position channel to spare.
Vertical order here is layout — where the server routed a ribbon so the bundle reads —
not identity, and it changes along the strip. Color is left carrying the discrimination
on its own, which is not what it was derived to do. That is the source of the
observation above.

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

**Why this matters for what gets built.** If the collisions were simply the honest signal
of genetic similarity, there would be nothing to do about them. They are not: they are one
encoding of a coordinate, chosen for a picture where position did the separating. So the
tube map can add back a channel the chart did not need — a data visualization question,
with data visualization answers, which is what the strategies below are for.

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
changing which strand is emphasized is a buffer or uniform write, and the shader already
runs per fragment regardless.

**Measured 2026-08-14, and the constraint lifted** (#39): moving the emphasis is a 2 KB table
upload, under 100 µs of CPU, and a sweep's worst frame is indistinguishable from the same
pointer moves with no key held. Strategies below may now assume that *changing appearance per
pointer move is affordable on this surface* — but nothing more than that. (The SVG surface
the 28 ms was measured on was deleted 2026-08-16, #40. The number is still what any
DOM-restyle proposal here has to answer to; there is simply no longer a surface it
describes.)

What has *not* changed is the part of that note that was never about performance: a
highlight wired to pointer position is also a **design** choice, and the note deliberately
kept the two reasons apart because they have different expiry dates. If direct
manipulation comes back, it comes back because it was measured and because it reads well —
not because the old obstacle was removed.

## Strategy A — hold a modifier, emphasize one, recede the rest

*Raised originally for the SVG surface; blocked there by the 28 ms restyle. Re-opened
because the renderer changed.*

Hold `Shift` (or another modifier), move over a strand, that strand stays fully drawn and
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
3. What is being pointed *at* — the strand under the cursor needs picking. GPU colour
   picking was the plan (`CONTEXT.md` #6); it is not built, and it is **#38**. Note that
   picking answers a different question from disambiguation: it says which strand is under
   the cursor, not which strand you are looking at three screens to the right. A strategy
   that only works where the cursor is has not solved this.
4. Does the emphasis persist along the whole strand, including the parts off screen
   (story 34)? If yes, the navigator should show it too — which is an argument for the
   thumbnail being re-rendered on selection, cheap because it is one render.

### Built and measured, 2026-08-14 (#39) — three of those four answered

Record: [`notes/2026-08-14-feeler-mode-on-the-gpu.md`](../notes/2026-08-14-feeler-mode-on-the-gpu.md).
Rerun it with `node scripts/verify_highlight.mjs '<url>'`.

1. **Fast enough, measured, at pointer rate on `5520+`.** Emphasis moved into an appearance
   table — one texel per strand, RGB plus an emphasis byte — so moving it writes one byte per
   *strand* and the frame uploads 2 KB. Over a sweep that moved the emphasis **198 times across
   198 of 464 strands**: median write 0.000 ms and worst 0.100 ms **in every window of the
   sweep** — flat, and below what the page timer resolves, so read it as under 100 µs. Worst
   frame while sweeping 9.4 ms, against 9.4 ms for the identical moves with the key released:
   inside a frame, and a third of the ~28 ms the DOM spent per swap. The mechanism at the
   bottom of this document under *Not yet discussed* is no longer a proposal; it is what this
   is built on.

   **The emphasis follows the cursor: one strand at a time, not an accumulating set.** The
   user's decision, 2026-08-14, reversing #39 and `SPEC.md` story 29 on looking at it built —
   a trail of lit strands behind a sweep makes the strand being pointed at one of dozens at
   full colour, which is this document's whole problem restated. A comparison set still wants
   a deliberate gesture, and this table supports one unchanged.
2. **It does not survive the sub-pixel regime, and the affordance is now honest about it.**
   Unmistakable from ~1 css pixel per band upward; at fit on `5520+` — 0.19 css pixels per
   band, 5.7 strands per device pixel row — the emphasized strand cannot be found among the
   receded ones by eye. **This is constraint 3 and it is a pixel budget, not a treatment that
   needs tuning.**

   *Tried and removed:* drawing the emphasized band as though it were at least one pixel
   thick, so a sub-pixel band would not composite at a fraction of its own colour. It turned
   a 59%-alpha hairline into a solid one on the fixture, did **not** make the strand findable
   at fit on `5520+`, and is brightening the one rather than dimming the others — which #39
   and story 30 both forbid, whatever the mechanism. The candidates that remain are a
   screen-space minimum thickness or an outline: both below, both making the emphasized strand
   wider than the map says it is, and that trade is still undiscussed.
3. **Picking is built** (#38) and it is what the feeler touches. Its own caveat stands
   unchanged: it answers what is under the cursor, not what you are looking at three screens
   to the right.
4. **Open.** Emphasis does persist along the whole strand — it is a property of the strand,
   not of the bands on screen — but the navigator's thumbnail is baked once per document, so
   the emphasized strand does not appear in it. One render would fix it and it was left alone.

**Which treatment won, of the four in the table:** translucent. A receded band keeps its
colour and drops its alpha, so it is a ghost of itself and whatever is behind it — the
ground, or the emphasized strand it crosses — shows through. Desaturation was rejected because grey
already means `pclaiX="None"`; removal because a haplotype's path is read against its
neighbours. The fear recorded against translucency, that dimming the crowd leaves nothing
to sit against, did not materialise at working zooms: the bundle's envelope stays legible at
8% and the emphasized strand sits inside it.

## Strategy B — use depth, now that we are in 3D

*Raised 2026-08-14. New: it was not available on the SVG surface at all.*

The observation behind it: strands disambiguate themselves in their **excursions** — a
strand crossing others is the moment it becomes distinct, and crossing is a depth relation
we currently throw away. The renderer already has this information and discards it:
instance order carries z-order where two strands overlap, and that is the only sense in
which the map has depth today.

Candidate forms:

- **Lift the selected strand in z.** Give the emphasized strand its own depth level so it
  passes *over* everything it crosses rather than being interleaved.
- **Drop shadow / contact shadow.** A soft dark offset under the lifted strand. This is the
  cue that actually makes lift visible, and it works at small scale — a shadow is a
  low-frequency signal, which is exactly what survives when the strand itself is
  sub-pixel.
- **Depth as a continuous channel.** Not one lifted strand but every strand at its own
  level, so crossings are consistently resolved everywhere rather than only at a
  selection. Closer to the physical intuition of ribbons in a bundle.

**The hard constraints this runs into, all of them in the current renderer:**

- **The camera is orthographic and will stay that way.** There is no parallax and no
  perspective foreshortening, so translating a strand in z produces *no image change at
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
  Anything that reorders or re-levels strands is changing what the picture asserts about
  overlaps, so it needs to be a deliberate claim rather than a side effect.

The version of this that looks most promising on paper — and it is only on paper — is
**one lifted strand plus its shadow, composited, with the depth buffer left off**: draw the
map, then draw the selected strand again over it with an offset dark pass beneath. That is
two extra draw calls for one instance's worth of geometry, costs nothing per frame, and
needs no change to how the other 463 strands are drawn.

## Constraints any strategy has to survive

Written once here so each proposal can be checked against them rather than re-arguing:

1. **Color stays undistorted** (story 31). PCLAI is the map's primary channel.
2. **The whole strand, not the visible part** (story 34).
3. **Legibility at fit is bounded by pixels, not by cleverness.** Below one pixel per
   band, the honest answers are low-frequency cues (shadow, envelope, position) or
   telling the researcher to zoom — not a subtler shade.

   *Qualified 2026-08-15.* The pixel bound is real, but part of what makes fit unreadable is
   not the bound — it is that abutting bands composite over the white ground and wash the map
   out, measured at ~25% of the background showing through every seam and 100% of rows below
   one pixel per band (`notes/2026-08-15-how-much-shows-through.md`). Normalising by total
   coverage removes that term (#51). It does not repeal the pixel budget, and no strategy here
   may assume it does — but the fit regime is dimmer than it has to be, and that is fixable
   without touching what the map asserts.
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

- An **outline or halo** on the selected strand — a screen-space stroke reads at any zoom
  and does not touch the fill color. **Promoted from idle to the obvious next move by the
  2026-08-14 measurement**, together with its blunter cousin, a minimum *screen-space*
  thickness for the lit strand: both are the only things on this list that address the one
  regime Strategy A demonstrably fails, and both trade the map's honesty about how thick a
  band is for being able to find it. That trade has not been discussed.
- ~~**Appearance as a lookup table**~~ — **built 2026-08-14** (#39, `src/strandAppearance.ts`),
  and it is what Strategy A above rests on: one texel per strand, RGB plus an emphasis byte,
  2 KB uploaded however many strands are lit. Kept in this list because the mechanism is
  available to any strategy that needs per-strand appearance, not only to A — including the
  indirect selection below, which is now the obvious home for the comparison set that feeling
  one strand at a time gave up.
- **Indirect selection**, which the 2026-08-13 note already argues for: a strand list, a
  search on `sample#haplotype#contig`, a palette assigning colors to samples, or selection
  arriving from PGB, which already knows which sample the researcher came in caring about.
  **Written up as #50, 2026-08-15** — a column of pills down the left of the panel, one per
  haplotype, click to emphasize. Not a ticket yet, deliberately: where it lives, whether the
  viewer or PGB owns selection, and how 464 rows are navigated all need deciding first. Two
  things make it stronger than a convenience. It is the natural home for the comparison set
  #39 gave up when the feeler stopped accumulating; and **it makes depth order a non-issue**,
  because naming a haplotype reaches one the cursor cannot single out. It needs `trackName`,
  which the band parser does not read.
- **Motion.** A slow animated flow along one strand distinguishes it with no static ink at
  all, and motion is the one channel that survives at sub-pixel scale. It also risks being
  the strobing distraction story 25 rules out.
- **Exploded / spread view** — temporarily separating strands vertically so crossings
  resolve, at the cost of the layout the server gave us.

## Where this gets decided

Not here. This document is the shared vocabulary; each strategy that gets tried gets a
dated note with what was rendered and what was seen, the way the renderer decisions were
settled, and the outcome comes back here as a line under the strategy it belongs to.
