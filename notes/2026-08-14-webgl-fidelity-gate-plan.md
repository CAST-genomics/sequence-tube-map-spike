# The fidelity gate — how it will be measured

Settled 2026-08-14 by grilling interview. This is the operational plan for step 2 of
[`the spike brief`](./2026-08-13-webgl-band-renderer-spike-brief.md) — the step the
brief calls "the gate" — and it **reorders** that brief. Decision context in ADR
[`0001`](../docs/adr/0001-webgl-band-renderer.md).

## What changed from the brief, and why

**The order is inverted.** The brief builds the parser, validation gate, fallback and
surface seam (step 1) before rendering a pixel (step 2). Those are all *integration*
concerns and integration is worthless if the picture is wrong, so the fidelity answer
comes first, from a disposable spike, and step 1 gets built afterward with the
shader's real requirements known.

**The fidelity fixture changed, because band height at fit scale is not invariant.**
The brief treats the 600 bp fixture as representative and `5520+` as a throughput
case. Strand count is invariant to span; **strip width is not**, and band height at fit
falls as `viewportWidth × contentHeight / stripWidth ÷ strands`:

| fixture | strip width | content height | strands | band height at fit, 1400 px |
|---|---|---|---|---|
| 600 bp (`stm-chr1-25331046-25331646.svg`) | 35,562 | 6,325 | 369 | **0.675 CSS px** ← the ADR's "0.6 px" |
| `5520+` | 108,983 | 7,785 | 464 | **0.216 CSS px** |
| `5514+` | 177,994 | 6,360 | 378 | **0.132 CSS px** |

Measured from the fetched documents, 2026-08-14, not estimated.

The risk this spike exists to retire is **3× worse** on the throughput fixture than on
the one the criterion was written around. The verdict therefore runs on `5520+`, with
the 600 bp fixture kept as a fast inner loop and regression tripwire.

**The control is not our surface.** The brief diffs against the SVG surface, but that
surface's own failure mode is rasterization of an oversized composited layer — a
control that fails is not a control. The control is instead a **headless Chrome raster
of the raw SVG**: no `will-change`, no CSS transform, no zoom round-trip, so the
2026-08-13 rendering bug is not in the measurement path at all.

## The harness

`npm run render-diff` → `scripts/render-diff.ts`. Playwright-driven Chrome, **local
only** — CI has no GPU, falls back to SwiftShader, and would rasterize differently
enough that its numbers could not be compared to the verdict's. The report header
prints machine, GPU string, Chrome version and dpr so any number can be traced to the
box that produced it.

**Camera.** Viewport **1400 × 900 at dpr 2**, three positions per fixture:

1. **fit** — the hard case, and the one the kill criterion is about.
2. **`MAX_SCALE`** at a fixed content point — the easy case. A failure here is wrong
   geometry, not aliasing.
3. **~1.0 scale** — the intermediate, which is what distinguishes aliasing from bad
   maths.

**Control.** The raw SVG with `g.node` **stripped** before rasterization. The 274
translucent stroked segment boxes are settled, uncontroversial, real DOM in the final
design, and are not what is being tested; including them puts noise over a metric
measuring sub-pixel band structure. Bands are diffed against bands.

**Metric.** 64 evenly spaced columns, skipping the outer 2% of width. Per column, the
full height of 8-bit RGB; Pearson correlation per channel against the control column;
mean across channels. **Gate: median across columns ≥ 0.98.** The **5th-percentile
column** is reported too, because aliasing failures concentrate where the curves are
rather than spreading evenly. Raw differing-pixel % and max channel delta are printed
for information and do not gate — at 0.22 px a half-pixel offset makes ~100% of pixels
differ while looking perfect.

**Two shader arms, both measured.** Analytic coverage (the ADR's choice) *and* MSAA
over bounding-box quads. The ADR's claim that MSAA "would alias 464 stacked sub-pixel
ribbons into noise" is a prediction, and this harness is the thing that can test it.
If MSAA passes, the renderer is dramatically simpler. Cut the arm if it is not working
within an hour.

**Rung count.** `N = 64` fixed for the verdict; sweep `N ∈ {16, 32, 128}` at the
`MAX_SCALE` camera only, the sole position where rung count can matter — at fit an
entire transition curve is a few pixels wide.

## What the run must reproduce, and two things easy to get silently wrong

- **Colour space.** SVG composites in **non-linear sRGB**; three.js defaults to a
  linear working space with sRGB output conversion, so identical inputs blend
  differently at every antialiased edge — and at 0.22 px per band nearly every pixel
  is an antialiased edge. `THREE.ColorManagement.enabled = false`, parsed `rgb()`
  bytes untouched end to end. We are reproducing a specific rasterizer, not rendering
  a physically correct scene; matching its technically-incorrect blending is the goal.
- **Z-order.** Bands are **opaque** (`fill-opacity: 1`, inline, no stylesheet) and SVG
  paints them in document order, which is *strand* order — where two strands cross, the
  later-numbered one wins. Free in the DOM, not free on the GPU. The instance buffer
  preserves document order and relies on in-order instance rasterization within the
  single draw call. **This is the least-trusted assumption in the plan**: if the
  5th-percentile column comes back bad, z-order is suspect #1, and the fix is a depth
  buffer keyed on document index — at the cost of correct coverage blending where
  bands genuinely overlap.

## Parsing

Parsed **in the browser, from the response text, with a regex** — never `DOMParser`.
Building 40,442 DOM nodes is exactly the cost this renderer exists to escape, so
measuring it would measure the wrong thing. Precomputing a `.bin` offline is likewise
refused: it would silently delete kill criterion #3. Parse time is printed in the same
report as the correlation, so criterion #3 is answered by the same run as #1.

## Appearance is a lookup table from the start

Per-band colour comes from a **`DataTexture` indexed by `trackID`** (464 texels), not
from a per-instance colour attribute (40,442 × 3 floats). It is the better design
independently — and once the table exists, highlighting is a table write plus
`needsUpdate`, so **kill criterion #2 (highlight under 8 ms) is measured in the same
session**. `trackID` is already an attribute on every element in the document; it is a
read, not an inference. GPU colour picking (criterion #5) stays out; that is genuinely
separate work.

## The three outcomes, fixed before any numbers exist

Written down now because outcome (ii) is the one most likely to be misread as failure
in the moment.

| | outcome | response |
|---|---|---|
| **i** | Both arms miss ≥ 0.98 | Spike **fails**. We cannot reproduce Chrome's rasterization. Fall back to viewport-sized re-rendering inside the DOM, as the brief says. |
| **ii** | Arms hit ≥ 0.98, but the control readability report shows Chrome itself collapsing 464 bands into far fewer | Spike **passes**. We match the SVG faithfully, and the *SVG was never readable at fit either*. A new ticket opens for fit-scale downsampling policy — a pre-existing product problem this work made visible, explicitly **not** a reason to keep the SVG surface, which has the same defect plus the 28 ms wall. |
| **iii** | Analytic passes, MSAA fails | Spike **passes**; the ADR's reasoning is confirmed by measurement rather than argument. |

Readability is **reported, not gated**: the harness prints how many distinct band
values survive per column *in the control*. The pixel diff answers only "do we
rasterize the way Chrome does" — that is the question a Chrome control can answer, and
it is a fair bar even when both sides are mush.

## Timebox

**Three working days to a first verdict**, with a **day-2 checkpoint**: if the
analytic arm is not producing a recognizable picture by the end of day 2, drop it and
run the verdict on MSAA alone — an answer about MSAA beats no answer. If day 3 ends
with no report, the finding is "GPU coverage was harder than the grammar suggested,"
and that gets written down as the result.

## Fixtures, and where the code lives

All three fixtures are **committed** — ~28 MB added to history. The same argument as
`CONTEXT.md` #19 and stronger: the fetch is the unreliable component of this system
(43% of the catalogue 500s), so depending on it at setup time makes the spike less
reproducible, not more. A hand-truncated fixture was rejected outright — it is exactly
the kind of thing that quietly satisfies a validation gate the real document would not.

The spike renderer is **disposable but committed**, under `scripts/spike/`. Disposable
means "will be rewritten in step 1, do not build it to last," not "will vanish" — a
verdict nobody can re-run is an anecdote. It renders in **real Chrome** via a minimal
Vite page that Playwright drives and screenshots: same GPU path as production, no
native GL bindings.

## Recording the verdict

ADR `0001` is **amended in place** with a dated "Measured" section — the house style
already used by `CONTEXT.md` #1, #5 and #6 — and the numbers go in
`notes/<date>-webgl-fidelity-verdict.md`. A new ADR only if the *decision* changes,
i.e. outcome (i). **Nothing goes into `CONTEXT.md` from this work**: ladder, rung,
arm and LUT are implementation, not domain vocabulary. The one candidate term is
whatever the outcome-(ii) collapse ends up being called, and it does not get named
until it is real.

## Tickets

Per-step issues under [#22](https://github.com/CAST-genomics/sequence-tube-map-spike/issues/22)
as the tracking epic. Only the fidelity gate is filed — [#26](https://github.com/CAST-genomics/sequence-tube-map-spike/issues/26); the later steps' issues get
written when their prerequisites land, since this step's outcome may delete steps 4
and 5 entirely. #22 closes with the PR that records the verdict.
