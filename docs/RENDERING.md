# How a band gets drawn

Reference for the shader in [`../src/bandSurface.ts`](../src/bandSurface.ts). Written for
`spike/bandSurface.ts` and carried here when the spike was rewritten into `src/`; forked
2026-08-14 from §03 of
[`../notes/2026-08-13-six-floats-per-band.html`](../notes/2026-08-13-six-floats-per-band.html),
which derives the geometry in full. **Only the technique comparison is carried here**; that
document's architecture sections — a camera driven by an `{x, y, scale}` object, no controls
library, segment boxes in a DOM **SVG** overlay — are superseded and deliberately left behind.

**Corrected 2026-08-15 on the last of those.** What was superseded is the *SVG*, not the
*DOM*: the boxes are HTML divs under a wrapper carrying the camera's transform. The band
population is what may never go back to the DOM, and it is the population — 127,101 bands
against 767 boxes — that carries the argument, not the medium. See `adr/0001`.

Predictions in the original are replaced below by what was measured.

## A band is six floats

Every band path in every document the API returns matches one grammar — 127,101 of 127,101
across 17 documents:

```
M x0 y0  C cx y0  cx y1  x1 y1   V y1+15  C dx y1+15  dx y0+15  x0 y0+15  Z
```

Both control points of each cubic share an abscissa. Normalised by the span, with `u` that
abscissa as a fraction:

```
x(t) = 3u·t·(1-t) + t³            y(t) = y0 + (y1-y0)·(3t² - 2t³)
```

The y expansion is literally `smoothstep`, because the cubic's control ordinates are copies
of its endpoints. So no path parser and no tessellator: a band is `x0, y0, width, y1` plus
the two edges' control abscissae.

**`x(0) = 0` and `x(1) = 1` for every `u`.** The two edges therefore meet at both ends
however much their control abscissae differ. This is what makes the ladder work.

## Three techniques

They differ in where the curve is evaluated, and that sets both cost and antialiasing.

| | technique | curve evaluated | overdraw | coverage |
|---|---|---|---|---|
| **A** | Ladder mesh | vertex shader | 0.87× | quantised (MSAA) |
| **B** | Bounding quad | fragment shader | 8.07× | analytic |
| **C** | Fitted strip | both | 0.87× | analytic |

**C is what ships.** A and C were both built in the spike, sharing geometry and one shader
behind an `ANALYTIC` define and swapped live with `space`, so the two could be judged on the
same frame; the comparison below is that judgment, and the losing arm went with the spike —
`src/bandSurface.ts` has no define and no MSAA path. **B was never built.** It was rejected
originally for overdraw —
a haplotype that jumps most of the map's height does so over a narrow horizontal span, so
its bounding box is enormous and the band inside is a sliver. Worth recording that the
rejection was never *priced*: 8.07× on a 2.5-megapixel canvas is ~20 megapixels of fill per
frame, which is unremarkable here. B remains the answer if A and C ever facet at high zoom.

## The ladder

One mesh: `RUNGS` quads spanning the curve parameter 0→1, two rows deep, carrying no
positions — only `t` and a side flag. Instanced once per band. The vertex shader places
every rung from the instance's six floats, so **zooming touches no geometry at all**.

Rungs sit at even **`t`**, not even **`x`**. Even-x would require inverting `x(t)` per
vertex, because the two edges have different `u` and so do not share an x at equal `t`.
Even-t removes the question, and since both edges reach `x0` at `t=0` and `x1` at `t=1`, the
result is a closed polygon inscribed in the true band with vertical ends. Rungs then sit
unevenly in x, by no more than ~3×, which affects nothing: tessellation error follows
curvature, not spacing.

**Measured.** `RUNGS = 64` gives a worst-case chord error of **0.41 px in x, 0.06 px in y**
at 200× zoom on the widest piece in `5520+`. A sweep of 16/32/64/128 at 200× showed **flat
frame time**, so rung count is free in this range. The pixel comparison across that sweep was
**inconclusive** — all three differed from 128 by the same ~0.14%, which is camera
reproducibility across page loads rather than tessellation, since wheel-driven
zoom-to-cursor does not land bit-identically. No evidence 64 is insufficient. The spike
swept it from `?rungs=`; the sweep is settled, so `RUNGS` is a constant in
`src/bandSurface.ts` rather than a parameter nobody passes.

## Coverage: what was predicted, and what happened

The original predicted that four-sample MSAA would *"dissolve 464 stacked sub-pixel ribbons
into noise."*

**It does not dissolve. It discards.** Each of four samples is won outright by a single
band, so no background survives and the result looks saturated and crisp — but at most four
of the bands covering a pixel can be represented, and the rest are simply lost.

Measured at fit on `5520+`, 1400×900 at dpr 2, over a 600×155 device-pixel sample well
inside the map. 464 tracks land on **177 device rows**, so 2.6 tracks share every pixel row:

| | saturation | min channel | distinct colours | distinct per column |
|---|---|---|---|---|
| **A · msaa** | 0.560 | 102.6 | 1,052 | 101 / 464 |
| **C · analytic** | 0.394 | 145.2 | **11,137** | **119 / 464** |

Analytic carries ~10× more distinct colour and 18% more distinct values per column — the
banding structure the renderer exists to preserve. But it is visibly **washed toward white**,
and the cause is arithmetic rather than a bug: bands abut exactly, and compositing 2.6
independently-covered opaque bands per pixel leaves `1 − (1−0.38)^2.6` ≈ **30% of the white
background showing through**.

**SVG has the same defect** — independent alpha compositing of abutting shapes is the classic
conflation artifact — so analytic is *faithful*, and faithful is not automatically better.

**And the difference only exists below one pixel per band.** At 40× zoom, where a band is
7.74 CSS px, the two arms differ by **6.18% of pixels at a mean channel delta of 2.32/255**,
concentrated entirely on band edges. Saturation 0.821 versus 0.812. They are the same
picture.

So the coverage question, which the original treats as the central design risk, turns out to
be confined to the zoom range where 464 tracks are decimated onto ~177 rows and no technique
can render them legibly anyway.

**Corrected 2026-08-15 — that last sentence conflates two things, and only one of them is
confined.** The *MSAA-versus-analytic difference* is confined below one pixel per band, as
measured above. The *conflation artifact* is not: it lives at every band boundary at every zoom,
because a boundary pixel is always split between two abutting bands. Measured by rendering the
same view over a white ground and a black ground and subtracting — the difference is the
fraction of the background surviving, whatever colour the bands are:

| band height | rows opaque | rows leaking > 5% | transmittance where it leaks |
|---|---|---|---|
| 0.6 css px | 0 % | 100 % | median 0.251 |
| 1.5 css px | 33 % | 67 % | median 0.184 |
| 3 css px | 67 % | 33 % | p90 0.251 |
| 8 css px | 87 % | 12 % | p90 0.149 |
| 30 css px | 99 % | 0.8 % | — |

A band's interior is opaque — exactly zero transmittance. But a band three pixels tall has one
interior row in three, and the other two leak a quarter of what is behind them, because
`(1 − a)(1 − (1 − a))` peaks at exactly 0.25 when a boundary falls at a pixel centre. Tracks are
stacked at a regular pitch, so every seam is in phase and they all leak at once: a coherent
ghost of the track behind, visible by eye at ordinary working zooms.

Full record, method and consequences:
[`notes/2026-08-15-how-much-shows-through.md`](../notes/2026-08-15-how-much-shows-through.md).

## A third option, not built

Because bands abut and are opaque, the *correct* result at sub-pixel scale is a
coverage-weighted average of the covering bands with **no background term** — normalise by
total coverage rather than compositing over white. That would give full saturation *and*
exact proportions: better than SVG rather than equal to it.

Not built, because it costs order-independence — where two tracks genuinely overlap, the
painter's-algorithm z-order that instance order currently carries would be lost — and
because the regime it improves is one that cannot be read regardless.

**The second half of that reason is withdrawn, 2026-08-15.** It improves a third of the rows at
3 css px per band, which reads perfectly well — see the correction above. The first half stands
and is now the whole of the objection, and it is a sharper objection than it was: front-most
wins where tracks cross is a property that was deliberately kept when picking was reconsidered
on the same day. Normalising averages the two instead. Filed as its own ticket rather than
folded into a rendering tidy-up.

## The same shader at thumbnail scale

The navigator renders this scene into a `WebGLRenderTarget` at 720 px wide — one camera
change, once per document. That puts the coverage path at the far end of the regime the
table above measures: a device pixel is ~300 world units and a band is 15, so ~20 tracks
share every pixel row instead of 2.6.

Two consequences follow, both of them the arithmetic behaving as designed rather than
anything new. `uPad` is doing real work — without a band grown to cover a pixel, a 0.05 px
band falls between sample rows and the thumbnail becomes a picture of whichever tracks
happened to land on one. And the wash toward white is stronger still, for the reason given
above: twenty independently-composited 0.05-coverage bands leave most of the background
showing. The thumbnail is pale, and it is pale in proportion to what is there, which is
what a thumbnail is for. The unbuilt third option — normalising by total coverage instead
of compositing over white — would help here more than anywhere.

## What the renderer corrects, and what it leaves alone

**A feature's size is corrected only where scale destroys information the feature carries.**
Everything else is drawn at the scale the camera says, and the server's numbers survive
the trip unmodified.

Two corrections qualify, and they are the same correction at two ends of one problem:

- **`uPad`** grows a band to cover a device pixel. A band thinner than a sample row falls
  between rows and disappears, and its *colour* is the information — a band that isn't
  drawn is a haplotype that isn't there. The correction is a floor, never a fixed size:
  above one pixel `uPad` does nothing and thickness 15 scales freely, 0.19 css px at fit
  to 38 at 200×.
- **The segment-box visibility threshold** hides a box until it is ~1.5 css px wide. A box
  narrower than that carries nothing — it is an outline with no readable interior and no
  hoverable area — so the honest correction is to withhold it rather than to inflate it.

**A stroke width is not one of them, decided 2026-08-15.** A segment box's 2-unit stroke
was going to be pinned at 2 css px, on the reasoning that a border should stay crisp. The
number behind that was wrong: `zoom` is css px per world unit and runs 0.0079 → 1.57, so a
scaling stroke spans 0.016 px at fit to **3.1 px at 200×** — there was never anything to
fix. And the consistency argument stands on its own: a 15-unit band scales across three
orders of magnitude with nothing correcting it, so a 2-unit stroke may too. Pinning it
would have cost a custom property rewritten every frame and a `calc()` on every box, to
defend against a problem that does not occur.

The same test retires the fade-in transition the threshold was going to need. A box
arriving at 1.5 px already has a 0.17 px stroke the browser antialiases to a faint line,
thickening on its own as the camera closes — the geometry fades by itself, so nothing
animates it.

## What would break any of this

- **A band that isn't the canonical shape.** The parser recognises one grammar and rejects
  the whole document otherwise, loudly. Partial rendering is never offered: a half-drawn map
  looks like a correct map of different data.
- **Text.** There is none in any of the 17 documents. It would need a genuinely different
  answer, not an extension of this one.
- **A control abscissa outside the span.** `x(t)` would stop being monotone and a pixel's x
  would map to two points on the curve. Measured at `u ∈ [0.30, 0.70]` everywhere, so there
  is real margin — but it is margin, not a guarantee.
- **A thickness other than 15.** Harmless; it becomes a seventh float.
