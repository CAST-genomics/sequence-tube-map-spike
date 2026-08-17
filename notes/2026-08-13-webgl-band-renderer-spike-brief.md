# Spike brief — WebGL band renderer

Settled 2026-08-13 by grilling interview. Decision recorded in ADR
[`0001`](../docs/adr/0001-webgl-band-renderer.md); the facts it rests on are in
[`2026-08-13-svg-rendering-hits-its-ceiling.md`](./2026-08-13-svg-rendering-hits-its-ceiling.md)
and [`2026-08-13-api-fetch-ceiling.md`](./2026-08-13-api-fetch-ceiling.md).

## The question

**Does a GPU renderer that reconstructs the map from parsed band geometry look as
good as the SVG, and make strand highlighting instant?**

Not "can we use three.js." The renderer is not in doubt; the *fidelity* is, and one
specific thing about it is: at fit scale a band is **0.6 CSS px** tall and 464 of
them are stacked. The PCLAI banding in the colours is real structure and must survive
rasterization. That is the risk this spike exists to retire.

## Where it lives

**In this repo, not a new one.** ~1,700 lines of dependency-free TypeScript, nothing
antagonistic to three.js, and — decisively — the fidelity question can only be
answered by running both renderers on the same fixture under the same camera. A
second repo would mean comparing screenshots across two apps with two viewport
implementations.

`mountTubeMapSurface(container, { renderer })` grows one option; both surfaces sit
behind one internal interface and consume the same `{x, y, scale}` and the same
parsed document. `?renderer=webgl` in the harness, beside `?feeler`. **The SVG
surface is not legacy — it is the control and the fallback.**

## Kill criteria, fixed before building

Stated now so they cannot be rationalised later.

1. **Fit-scale fidelity.** Banding structure must remain visually readable at fit
   scale. If sub-pixel bands alias into noise, the spike **fails** and the answer is
   viewport-sized re-rendering inside the DOM instead.
2. **Highlight under 8 ms** — parity with the measured pan/zoom budget, not merely
   better than the ~28 ms wall.
3. **Parse + upload under 500 ms** for a fetched document. Note this budget is small
   next to a 69 s download; it is about not making transport worse.

Judged by a **committed** pixel-diff harness, not by eye. The Playwright harness that
produced the 2026-08-13 diagnosis was ephemeral and evaporated; this one gets re-run
dozens of times, so it goes in `devDependencies` with a `scripts/render-diff.ts` that
boots both surfaces on one camera and reports differing-pixel percentage and max
channel delta.

## Steps

**0. Node survey — DONE 2026-08-13** (`scripts/survey_nodes.py`,
`data/nodeSurvey.json`). All 30 nodes attempted; **17 returned**. Results:

- **Band grammar: 127,101 / 127,101 conforming — 100.0000%, zero offenders.**
- Thickness always **15**; rect heights always **15**.
- Control point always within **u ∈ [0.30, 0.70]** of the span, so `x(t)` stays
  monotone and per-pixel coverage remains well defined.
- **Zero** strokes in `g.track`; **zero** text, gradients, clip paths or filters
  anywhere. Text was the failure mode with no good answer; it does not occur.
- Strand counts **369 / 378 / 464** — varies by node, so nothing may hard-code it.
- **Confirmed only over spans of 1 bp – 7,967 bp.** 13 nodes could not be fetched;
  see the fetch-ceiling note. The largest nodes are untested, not tested and passing.

**1. Promote the fixture.** `5520+` (4,150 bp, 14.2 MB, 464 strands, 274 segments,
**40,442 bands**) becomes the spike fixture — the largest band count the API would
return, 3.9× the current one. Keep the 600 bp fixture as the fast inner-loop case.
Consider `5514+` (7,967 bp, **767 segments**) as a second case: it has the most
segments, so it stresses the DOM overlay of step 3 hardest. Under the current renderer
these strips are millions of pixels wide, so the SVG surface is expected to fail on
them — a useful control result, not a bug to fix.

**2. Parse and gate.** Regex the six floats per band out of `g.track`; reject the
whole document loudly on any non-conforming element and fall back to the SVG surface.
Written against `g.track` specifically, since `g.node`'s 75 stroked, translucent boxes
are the expected exception.

**3. Render.** `three@^0.176.0`, pinned to PGB's version.
`InstancedBufferGeometry` over a shared ladder mesh; `OrthographicCamera` driven by
the existing `viewportTransform`, vertex shader emitting `-y` so SVG's downward y
agrees with three.js without flipping handedness. No controls object is constructed.
Segment boxes as a DOM SVG overlay above the canvas.

Rung count **N = 64**, then measured, not assumed: render at `MAX_SCALE` with
N ∈ {16, 32, 64, 128} and pixel-diff each against the SVG control; take the smallest
N that is indistinguishable. Adaptive tessellation (bucketing instances by rise) is a
real option but premature before N=64 is shown not to be free.

**4. Highlight.** `trackID` as an instanced attribute; a `DataTexture` holding one
texel of appearance per strand — RGB colour, alpha as dim factor. Highlighting writes
the table and sets `needsUpdate`. **Size the table from the parsed document**: strand
counts of 369, 378 and 464 all occur across the surveyed nodes, so no count may be
hard-coded. Note this is also what makes highlighting operate on *haplotypes* rather
than fragments — a strand is ~28–87 separate shapes, and `trackID` is what unites them.

**5. Picking — last, and only if 1 and 2 pass.** GPU colour picking: second pass
writing `trackID` as colour to a 1×1 scissored target, read one pixel. ~40 lines given
the attribute already exists. Cut it without regret if fidelity fails. Segment
tooltips need nothing, since the overlay is real DOM.

## Explicitly out of scope

- **Transport.** The largest nodes cannot be fetched and no renderer decision changes
  that. Fenced off deliberately so the spike stays falsifiable. The compact-geometry
  request to UCSD is the follow-on, and it is stronger once a renderer exists that
  consumes exactly six floats per band.
- **A span-based eligibility gate in PGB.** Plausibly needed, but the threshold is
  unknown and guessing one is worse than measuring it.
