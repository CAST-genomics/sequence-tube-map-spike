# How much of the background shows through the bundle

**Date:** 2026-08-15. **Reproduce:** `npm run dev`, add the temporary hook described at the top
of [`2026-08-15-probe-transmittance.mjs`](./2026-08-15-probe-transmittance.mjs), then
`node notes/2026-08-15-probe-transmittance.mjs`.

Raised by the user against a claim I had made while explaining where alpha comes from: that at
one device pixel per band and above, a band's interior is opaque and the map is therefore
essentially opaque. Two screenshots said otherwise — a strand passing *behind* several
foreground strands was plainly visible through them, at a zoom where every foreground band was
two or three pixels tall. **The claim was wrong as a description of the picture, and this is
what is actually true.**

## Method

Transmittance `T` is the fraction of the background surviving at a pixel. Render the same view
twice, once over a white ground and once over a black ground, and subtract: `T = (white −
black) / 255`. It is independent of what colour the bands themselves are, which is what makes
it usable on a map of 369 pastel strands. `T = 0` is opaque; `T = 0.25` means a quarter of
whatever is behind is showing.

Sampled down the middle column of a 1400 × 900 viewport on the committed fixture, over the rows
the bundle occupies. **Empty sky measures `T = 1.000`**, which is the control that says the
method is measuring what it claims to.

## What it says

| band height | rows opaque (`T` ≤ 0.01) | rows leaking > 5% | `T` where it leaks |
|---|---|---|---|
| 0.6 css px | 0 % | **100 %** | median 0.251 |
| 1.5 css px | 33 % | **67 %** | median 0.184 |
| 3 css px | 67 % | **33 %** | p90 0.251 |
| 8 css px | 87 % | 12 % | p90 0.149 |
| 30 css px | 99 % | 0.8 % | — |

**The interior of a band is opaque — exactly `T = 0.000`.** That part of the claim holds. What
it misses is that a band three pixels tall has only about one interior row in three. The other
two are *boundary* rows, and those are 25%-transparent windows onto whatever is behind them. A
third of every row in the bundle, at the zoom in the screenshots.

## Why 25%, exactly

Two abutting bands split a boundary pixel between them, so their coverages sum to 1. But they
are composited **independently**, one after the other, so the background left showing is

    (1 − a)(1 − (1 − a)) = a(1 − a)

which peaks at **exactly 0.25** when the boundary falls at a pixel centre. Measured p90 at
3 css px per band: **0.251**. The prediction and the measurement agree to a thousandth.

Two details follow from the layout rather than the arithmetic:

- **The seams are all in phase.** Strands are stacked at a regular pitch, so every boundary
  falls at the same offset within its pixel and every seam leaks the same amount at the same
  time. That is why this reads as a coherent ghost of the strand behind rather than as noise —
  and why it was spotted by eye before it was measured.
- **The worst rows are not seams at all.** `T` of 0.5–0.8 shows up where the layout leaves a
  genuine gap between groups of strands. That is real empty space and is supposed to show
  through.

## What this corrects, and what it does not

`docs/RENDERING.md` already names the cause — *"independent alpha compositing of abutting
shapes is the classic conflation artifact"* — and says SVG has it identically, so this is
inherited rather than introduced. Two of its conclusions were drawn too narrowly, and the file
is corrected:

1. That the coverage question is *"confined to the zoom range where 464 strands are decimated
   onto ~177 rows and no technique can render them legibly anyway."* The **MSAA-versus-analytic
   difference** is indeed confined there — 6.18% of pixels at 40× zoom, all on band edges. The
   **conflation** is not: it lives at every seam at every zoom, and a seam exists at every band
   boundary.
2. That the unbuilt third option improves *"a regime that cannot be read regardless."* It also
   fixes a third of the rows at 3 px per band, which is a regime that reads perfectly well.

What is *not* affected: the choice of analytic coverage over MSAA, and the performance of it.
This is a compositing question about what happens between two bands, not about how a band is
drawn, and nothing here argues for changing the shader that draws one.

## Consequences

- **The fix is the third option already in `docs/RENDERING.md`**: normalise by total coverage
  instead of compositing over white. At a seam the two coverages sum to 1, so the result is a
  weighted average of the two band colours with no background term at all. Filed as its own
  ticket, because its cost — order-independence where strands genuinely overlap — lands on a
  property that was deliberately kept.
- **It explains why an obscured strand looks selectable.** A strand visible through a third of
  the rows above it looks like something you could point at, and picking answers with the
  front-most band. That was considered and left alone on 2026-08-15: whatever is in front should
  win, because that is what the cursor is pointing at. See
  `notes/2026-08-14-feeler-mode-on-the-gpu.md`. Reaching a haplotype the cursor cannot single
  out is answered from the other direction, by selecting it by name (#50).
- **It is part of why the feeler cannot find a strand at fit.** At 0.6 px per band every row
  leaks ~25%, which is the wash toward white that leaves an emphasized strand nothing to sit
  against. Normalisation would attack that at its source, where a floor of ink — tried and
  removed in #39 — only painted over it.
