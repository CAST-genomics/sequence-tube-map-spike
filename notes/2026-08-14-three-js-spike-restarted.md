# The three.js spike, restarted from scratch — settled 2026-08-14

Settled by grilling interview, **discarding the plan settled the same morning**. This
note supersedes
[`2026-08-14-webgl-fidelity-gate-plan.md`](./2026-08-14-webgl-fidelity-gate-plan.md)
in full, and the step list in
[`2026-08-13-webgl-band-renderer-spike-brief.md`](./2026-08-13-webgl-band-renderer-spike-brief.md).

Two objections drove the restart, both the user's:

1. **The plan had stopped being about the renderer.** A committed pixel-diff harness, a
   0.98 median-correlation gate, a stripped-`g.node` control page rasterized in headless
   Chrome, two shader arms measured against each other — that is a machine for *proving*
   a picture is right, and the question was never "can we prove it," it was "does it
   work." Correlation is good at catching subtly wrong geometry; eyes are better at
   "does this look right," which is the actual bar.
2. **The design was SVG-thinking in a GPU costume.** The destination is PGB, which is a
   three.js application. A renderer driven by a `{x, y, scale}` object, with segment
   boxes in a DOM SVG overlay and a navigator baked to a bitmap, is the SVG viewer's
   architecture with its surface swapped out.

## The spike

**Does a three.js renderer of this data look good and feel right under pan and zoom?**

Not "does it match the SVG." We are replacing the SVG, not impersonating it — and a
renderer that is *better* than the SVG would score badly against a diff with it.

**Panning and zooming is the whole rationale for the visualization.** Everything else is
secondary, which is why highlighting, hit-testing, the navigator and the segment boxes
are all out of the first render.

### What counts as failure, fixed before anything is built

All three count, and they apply to the **best technique tried, not the first one** — "A
shimmers" is a result about MSAA, not a verdict on the spike.

| | failure | what it looks like |
|---|---|---|
| **i** | **Mush at fit scale** | The PCLAI banding smears into a uniform field, or crawls and moirés when panned one pixel at a time. At fit on `5520+` a band is 0.19 CSS px, so ~5 haplotypes share every screen pixel row; the colour structure has to survive that averaging. |
| **ii** | **Stutter or tearing** | Dropped frames during a drag. Judged with a frame-time readout on screen, since the SVG's pan was already a respectable 8.3 ms and "feels fine" is not by itself evidence of improvement. |
| **iii** | **Zoom cannot reach** | You hit the zoom stop while haplotypes are still unresolvable. See the finding below — this was true of the shipping viewer and nobody had noticed. |

## Two findings from the interview

Both measured 2026-08-14, both absent from every earlier document.

### Strands abut exactly — there is no background between them

Baseline pitch between adjacent strands is **15** and thickness is **15**, so the gap is
**zero**. 464 strands span y ∈ [20, 6965] with no gaps anywhere.

The map is a **solid field of colour**, not thin ribbons drawn on white. The "0.6 px
sub-pixel ribbon" framing in ADR `0001` is therefore partly misleading: nothing thin is
being drawn against a background. What must survive rasterization is the *colour
transition between touching neighbours*, which is a materially easier thing to preserve
than a thin feature on a contrasting ground. It also means adjacent-band seams cannot
occur vertically — there is nothing to seam against.

### `MAX_SCALE = 4` never resolves a haplotype on the real fixtures

The clamp is `[fit, 4×]` (`CONTEXT.md` #9). It was only ever exercised against the 600
bp fixture, the one document the SVG viewer ever successfully displayed.

| fixture | strip width | px per band at fit | at 4× | at 4×, device px (dpr 2) |
|---|---|---|---|---|
| 600 bp | 35,562 | 0.59 | **2.4 px** | 4.8 — fine |
| `5520+` | 108,983 | 0.19 | **0.77 px** | 1.5 — barely separable, no shape |
| `5514+` | 177,994 | 0.12 | **0.47 px** | 0.9 — still sub-pixel at maximum zoom |

**On the nodes we actually care about, maximum zoom still leaves every haplotype thinner
than a CSS pixel.** No renderer fixes this; it is a constant calibrated on the small
fixture. It matters to the spike because judging "does it look good" while capped at 4×
means judging an image that is sub-pixel at every reachable zoom level, and concluding
the renderer failed when the clamp failed.

There was also a reason not to raise it in the old design: at 4× the composited layer was
already 14.4 gigapixels. On the GPU that constraint is gone — the canvas is 2.5
megapixels at every zoom level.

**This is a defect in the shipping viewer, independent of this spike.**

## The settled design

Three.js-centric, shaped like PGB. Nothing is imported from `src/`.

| | |
|---|---|
| Location | `spike/`, own Vite entry. **Hard rule: zero imports from `src/`** — the friction is the mechanism that keeps vestiges out. |
| Camera | `OrthographicCamera`. Zoom is `camera.zoom`, pan is `camera.position`. **No `{x, y, scale}` object anywhere.** |
| Controls | `MapControls`, configured exactly as `pgb/src/mapControlsFactory.js`: `zoomToCursor = true`, `enableRotate = false`, `screenSpacePanning = true`, `zoomSpeed = 1.2`, `panSpeed = 1`. |
| Zoom range | `minZoom` = fit, `maxZoom` = **200×** (~38 px per band on `5520+`; 104× is where a band reaches 20 px and you can read its shape). |
| Coordinates | y negated and content centred on the origin **in the parser**. Downstream, nothing knows the source was SVG or that y ever pointed down. World units stay SVG user units. |
| Loop | Continuous `requestAnimationFrame` + `controls.update()`, as PGB does. Render-on-demand is an optimization for a problem the GPU does not have. |
| Geometry | Shared ladder mesh, `InstancedBufferGeometry`, one draw call, 40,442 instances. |
| Colour | Per-instance attribute. **No `DataTexture` LUT** — the LUT exists to make highlighting O(1), and highlighting is deferred. |
| Data | SVG parsed in the browser at load. **42 ms** for 14.2 MB / 40,442 bands, so a pre-parsed geometry cache (1.05 MB, 13.5× smaller) was rejected: it buys nothing noticeable and costs a build step, a format, a loader and a staleness risk. |
| Fixtures | 600 bp for the inner loop. **Every judgment call on `5520+`**, where the risk is 3× worse. |

`viewportTransform.ts` is not used. It is a hand-written reimplementation of
`mapControlsFactory.js`, written because the SVG viewer had no three.js; using the
original is less code and closer to the destination's feel. Its unit tests do not
transfer.

### Shaders

The three techniques are derived in
[`2026-08-13-six-floats-per-band.html`](./2026-08-13-six-floats-per-band.html) §03,
with overdraw measured across the reference document.

| | technique | curve evaluated | overdraw | coverage |
|---|---|---|---|---|
| **A** | Ladder mesh | vertex shader | 0.87× | quantised (MSAA) |
| **B** | Bounding quad | fragment shader | 8.07× | analytic |
| **C** | Fitted strip | both | 0.87× | analytic |

**A and C ship together in one shader behind a compile flag, with a live key toggle.**
They share geometry entirely — the only difference is whether the fragment writes opaque
colour and lets MSAA handle edges, or computes coverage and writes it as alpha. That is
about six lines apart, so building both converts the choice from an argument into
something you look at on the same frame at the same camera.

**B is the named fallback**, not a third arm — it is the only one needing different
geometry. It earns its build if both A and C facet at high zoom, where its per-fragment
exactness is a genuine advantage.

Two predictions from the earlier work are now testable rather than arguable:

- *"Four-sample MSAA dissolves 464 stacked sub-pixel ribbons into noise."* Confirmed that
  `MAX_SAMPLES` is **4** on this machine's M1 Pro / ANGLE Metal path, so the five
  quantization levels are real. Whether they mush is not yet known.
- *"The bounding quad is defeated by tall bands — 8.07× overdraw."* Measured, but never
  **priced**: 8.07× on a 2.5 megapixel canvas is ~20 megapixels of fill per frame, which
  is unremarkable for an M1 Pro. The overdraw is real; the rejection may not survive.

A third consideration appears only now that zoom is uncapped. 40,442 bands over 464
strands is ~87 pieces per strand, so the average piece spans **~1,250 units** — at 200×
that is **~3,200 px wide on screen**, and 64 rungs is one rung per 50 px. Linear
interpolation between rungs across a smoothstep curve may visibly facet. That is a
*high-zoom* failure, distinct from the fit-scale one, and the two point at different
fixes.

### Float32 precision, the cost of uncapping zoom

`5514+` is 177,994 units wide. A vertex at x ≈ 178,000 passes through a
`modelViewMatrix` carrying a translation of ≈ −178,000, and that subtraction happens in
float32 in the shader — so geometry quantizes to a grid of **0.0156 units**.

| zoom | px per band | precision grid |
|---|---|---|
| 20× | 4 px | 0.004 px — invisible |
| 100× | 20 px | 0.02 px — invisible |
| 1000× | 200 px | **0.2 px — visible jitter while panning** |

`maxZoom = 200` sits comfortably inside this. Centring the content on the origin halves
coordinate magnitudes and buys a little more headroom. If the ceiling is ever raised,
the fix is a camera-relative offset computed on the CPU in double.

## Deliberately deferred

Not in the first render, and when they land they land as three.js, not as DOM:

- **The 274 segment boxes** — as geometry, picked with a raycaster. **Not** a DOM SVG
  overlay above the canvas, which is what ADR `0001` specifies. The overlay's stated
  benefit is free hit-testing, which is the same reasoning that produced `CONTEXT.md` #6,
  whose premise has already collapsed.
- **The navigator** — a second `OrthographicCamera` on the same scene, not a bitmap baked
  from the SVG at load. Always in sync by construction, no second representation that can
  disagree with the first.
- **Highlighting** — at which point the per-instance colour attribute becomes the
  `DataTexture` LUT, which is a small contained change once there is a reason for it.
- **GPU colour picking.**

Note the vocabulary: **"baked" means rasterized to a bitmap** and nothing else. It was
briefly overloaded during the interview to mean pre-parsed geometry; that is a *geometry
cache*, and it was rejected anyway. If the navigator becomes a second camera, nothing in
the project is baked at all.

## What survives from the earlier work, and what does not

**Survives** — all of it measured, none of it plan-dependent:

- The band grammar. **127,101 / 127,101 strand paths conform** across 17 documents;
  thickness always 15; control abscissae always within u ∈ [0.30, 0.70]; no strokes,
  text, gradients, clip paths or filters in `g.track`.
- The geometry derivation in `2026-08-13-six-floats-per-band.html` §§01–02, 05, 08 — the
  smoothstep collapse, monotone x sweep, the 1.0-unit lap at all 9,883 joins, and the
  list of what would break the design.
- `scripts/spike/parseBands.ts` — 234 lines, 10 tests green against all three fixtures.
  Copied into `spike/` rather than imported, so the zero-imports rule holds without
  exception. Extended to emit centred, y-up geometry.
- The three committed fixtures in `public/`.

**Does not survive:**

- The fidelity-gate plan in full — harness, 0.98 gate, correlation metric, control page,
  camera triple, readability report, three pre-committed outcomes, three-day timebox.
- ADR `0001`'s architecture consequences: *"the camera is driven from the same
  `{x, y, scale}` object as before; no controls library is involved"* and the DOM SVG
  overlay for segment boxes. Its *geometry* reasoning stands.
- `scripts/spike/bandRenderer.ts` — a more elaborate C than the artifact describes (four
  Newton iterations in the vertex shader, a uniform pixel size rather than `fwidth`,
  padded quads). Left on disk, not consulted.

One environment fact worth keeping from the discarded harness: **Playwright's bundled
Chromium falls back to SwiftShader in headless mode on this machine** (`maxTex 8192`),
while `channel: 'chrome'` gets ANGLE Metal even headless. Any future automated GPU
measurement has to launch the latter or it is measuring a software rasterizer.

## Recording the outcome

**No ADR yet.** Reversing ADR `0001` on controls and the DOM overlay is ADR-shaped —
hard to reverse, surprising without context, a real trade-off — but it is contingent on
the spike passing. If the spike fails there is no three.js renderer to have an
architecture for. When there is a verdict, the ADR is written then, and it likely
supersedes `0001` rather than sitting beside it.

**No `CONTEXT.md` change.** Ladder, rung, arm and geometry cache are implementation
vocabulary, not domain vocabulary. `CONTEXT.md` is a glossary and nothing else.

**`#22` and `#26` describe the discarded plan** — `#26`'s method section is entirely the
pixel-diff harness — and need correcting before a future session reads them and rebuilds
exactly what was thrown away.
