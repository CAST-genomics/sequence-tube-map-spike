# The three.js renderer works — verdict, 2026-08-14

Answers the question fixed in
[`2026-08-14-three-js-spike-restarted.md`](./2026-08-14-three-js-spike-restarted.md):
**does a three.js renderer of the tube map look good and feel right under pan and zoom?**

**It does.** All three failure conditions clear. The renderer is `spike/`, built across
[#27](https://github.com/CAST-genomics/sequence-tube-map-spike/issues/27),
[#28](https://github.com/CAST-genomics/sequence-tube-map-spike/issues/28) and
[#29](https://github.com/CAST-genomics/sequence-tube-map-spike/issues/29) over one day.

## Where the numbers come from

Every figure below was measured on one machine, driving the real page with real pointer
input. Nothing is estimated.

| | |
|---|---|
| Machine | Apple M1 Pro, 16-core GPU, macOS 26.5.2 |
| GPU path | `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)`, `MAX_SAMPLES` 4 |
| Browser | Google Chrome 151.0.7922.138, driven by Playwright with `channel: 'chrome'` |
| Viewport | 1400 × 900 at dpr 2 |
| three.js | 0.176.0, pinned to PGB's version |
| Document | `5520+` — 14.2 MB, 40,442 bands, 464 strands, 108,983 units wide |

**Headless Chromium would not have produced these numbers.** Playwright's bundled browser
falls back to SwiftShader in headless mode on this machine (`MAX_TEXTURE_SIZE` 8192);
`channel: 'chrome'` gets the Metal path even headless. Any future measurement has to launch
the latter or it is measuring a software rasteriser.

## The three failure conditions

Fixed before any code existed, and applied — as agreed — to the best technique tried rather
than the first.

### ii · Stutter or tearing — **cleared**

| | zoom | band height | frame | worst |
|---|---|---|---|---|
| fit | 1.0× | 0.19 css px | 8.3 ms | 10.5 |
| zoomed | 19.2× | 3.70 css px | 8.3 ms | 9.2 |
| ceiling | 200.0× | 38.54 css px | 8.4 ms | 9.3 |
| pan at ceiling | 200.0× | | 8.4 ms | 9.2 |
| round trip to fit | 1.0× | 0.19 css px | 8.3 ms | 10.5 |

**8.3 ms is the display's 120 Hz cap, not the renderer.** Frame time never left 8.3–8.4 ms
through panning, zooming, panning while fully zoomed, and a round trip that returns to
exactly 1.0×. The worst frame across every session was 10.5 ms.

Both coverage techniques hold this. So does every rung count from 16 to 128. The only cost
anywhere is a single ~87 ms frame at load while the buffers upload, which does not recur.

For scale: the SVG surface panned at 8.3 ms too — but only by handing the compositor a new
matrix for a bitmap it already had, which is what made zoom re-rasterize a 900-megapixel
layer and come apart. Here the canvas is 2.5 megapixels at every zoom level and geometry is
never rebuilt, so the failure is structurally absent rather than avoided.

### iii · Zoom cannot reach — **cleared**

`zoom = 1` is fit-to-width by construction; the ceiling is 200×, giving **38.54 CSS px per
band** on `5520+`. `MapControls` clamps natively at both ends.

This condition existed because the shipping viewer's `MAX_SCALE = 4` was calibrated against
the 600 bp fixture and **never resolves a haplotype on the documents that matter** — 0.77 px
per band on `5520+`, 0.47 on `5514+`, at maximum zoom. That defect is the SVG viewer's, not
the renderer's, and is filed separately.

### i · Mush at fit scale — **cleared, with the finding restated**

At fit, 464 strands land on **177 device rows**: 2.6 haplotypes per pixel row. The banding
does not dissolve into noise — the large-scale colour structure survives and is perfectly
usable for navigation — but individual strands are not separable, and cannot be.

**This is a property of the data, not of the renderer, and it was confirmed independently.**
The user loaded the raw `5520+` SVG straight into Chrome and observed the same thing: *"one
of the issues with these files is we have features, the strands or tracks… they are all very
close together and they can blend together."* Chrome's own render of the document has the
identical limit. There is no version of this map in which 464 distinguishable things occupy
177 pixels.

So the condition is judged as: **we render this as well as Chrome renders it, and the SVG
was never readable at fit either.** This was the pre-committed reading of exactly this
outcome, and it holds — with the difference that it now rests on the user's own observation
of the control rather than on an argument.

Two things follow, both filed rather than solved here:

- Fit-scale legibility is a **product** question — downsampling policy, or a span-based
  eligibility gate — not a rendering one.
- Colour similarity defeats the eye at *every* zoom, not only at fit. See
  [#32](https://github.com/CAST-genomics/sequence-tube-map-spike/issues/32).

## Which technique

**Analytic coverage (technique C).** Both were built and compared live on the same frame.

| at fit, `5520+` | saturation | min channel | distinct colours | distinct per column |
|---|---|---|---|---|
| **A · msaa** | 0.560 | 102.6 | 1,052 | 101 / 464 |
| **C · analytic** | 0.394 | 145.2 | **11,137** | **119 / 464** |

The reasoning, and the honest caveat:

- The ADR predicted MSAA would *dissolve* the banding into noise. **It does not dissolve; it
  discards.** Each of four samples is won outright by one band, so no background survives
  and it looks crisp — but at most four of the 2.6-to-5 bands covering a pixel can be
  represented and the rest are lost. Its saturation is bought by throwing haplotypes away.
- Analytic keeps ~10× more distinct colour, which is the structure the renderer exists to
  preserve, but is washed toward white: bands abut exactly, and compositing 2.6
  independently-covered opaque bands per pixel leaves ~30% of the white ground showing
  through. **SVG has this same conflation artifact**, so analytic is faithful.
- **The choice barely matters.** At 40× — where a band is 7.74 CSS px — the two arms differ
  by 6.18% of pixels at a mean channel delta of 2.32/255, entirely on band edges. They are
  the same picture. The whole question lives below one pixel per band, which is the regime
  where nothing is legible regardless.

C is chosen because it preserves more information at no cost, not because the difference is
visible where anyone works. A third option — normalising by total coverage, giving full
saturation *and* exact proportions, better than SVG rather than equal to it — is described
in `spike/RENDERING.md` and deliberately not built: it costs order-independence and improves
only the unreadable regime.

## What the spike also established

- **Parsing 14.2 MB in the browser costs 37–41 ms**, against 42 ms outside it. No geometry
  cache, no build step, no offline format. The concern that motivated one was unfounded.
- **The band grammar holds in practice, not just in survey.** The parser re-verifies the
  grammar per document and would reject on any deviation; all three fixtures parse clean.
- **Strands abut with zero gap** — pitch 15 against thickness 15. The map is a solid field of
  colour, not thin ribbons on white, which makes the "0.6 px sub-pixel ribbon" framing in
  ADR `0001` misleading.
- **21.3% of strands in `5520+` have no PCLAI call** (99 of 464, flat grey). The grey wash at
  fit is data.
- **No root-finding is needed anywhere in the geometry.** Both edges of a band reach `x0` at
  `t=0` and `x1` at `t=1` regardless of their control abscissae, so sampling both at even
  `t` inscribes a correct polygon. The superseded renderer's four-step Newton solve existed
  only to serve a choice to place rungs at even `x`.

## What this does not answer

Fenced off deliberately, and unchanged by the verdict:

- **Transport.** 13 of 30 nodes cannot be fetched at all
  ([#23](https://github.com/CAST-genomics/sequence-tube-map-spike/issues/23)). The renderer
  consumes six floats per band and receives ~300 bytes of markup per band, which makes the
  compact-geometry request to UCSD specific enough to be worth making.
- **The largest nodes.** The grammar is confirmed over spans of 1 bp – 7,967 bp. Bigger
  documents are untested, not tested and passing.
- **Everything deferred from the spike:** the 274 segment boxes, the navigator, highlighting,
  hit-testing. When they land they land as three.js geometry and a second camera — not as a
  DOM overlay and a baked bitmap.

## Consequences

`spike/` is a spike and its stated contract is that it dies. The verdict means it now gets
**rewritten as a real module**, not promoted. The SVG surface in `src/` stays untouched until
that lands, and the decision about whether it remains as a fallback is separate work.

ADR [`0001`](../docs/adr/0001-webgl-band-renderer.md) is amended in place: its decision
stands and is now measured rather than argued, while several of its consequences — the
`{x, y, scale}` camera, the absent controls library, the DOM overlay for segment boxes, and
the sub-pixel-ribbon framing — are corrected.
