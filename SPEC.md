# Spec — Sequence Tube Map viewer

**Repo:** `~/PanGenomeProject/sequence-tube-map-spike` (standalone harness).
**Design source:** [`CONTEXT.md`](./CONTEXT.md) — read its Vocabulary section first;
"node" means two different things at two scales and this spec uses the disambiguated
terms throughout.
**Destination:** PGB (`CAST-genomics/pgb`) as a new panel, once proven here.

---

## Problem Statement

PGB renders a pangenome graph in 3D as minigraph nodes and edges. Each minigraph
node is a *collapsed summary*: it stands for a stretch of sequence that hundreds of
haplotypes traverse, but it reveals nothing about **how** they traverse it. All the
structural variation — SNVs, insertions, deletions, duplications, inversions — is
inside the node, and the 3D view cannot show it. A researcher can see that a locus
is complex, and can go no further.

The interior is a minigraph-cactus subgraph at base-level resolution, and the UCSD
group already renders it as a sequence tube map, served as SVG. But an SVG in a
browser tab is unusable at this scale. A single minigraph node expands to a strip
roughly 25 screens wide holding 369 haplotype strands stacked vertically. Opened
raw, the researcher can either see the whole node as an unreadable smear, or see
legible detail with no idea where they are inside it.

Compounding this, the strands are *genuinely* near-identical in color, and
meaningfully so. Strand color encodes PCLAI — a continuous local-ancestry coordinate
in PCA space (Geleta et al., *Nature Genetics* 2026), where distance approximates
genetic drift. Two ribbons look alike because those haplotypes are genetically close
at this locus. So the visual similarity is the signal, not a palette defect to be
designed away — and it means following one haplotype across the node by eye is
effectively impossible. The data is all present and almost none of it is legible.

## Solution

A **map viewer** panel, reached by clicking a minigraph node in the 3D graph and
choosing the sequence tube map from the menu that appears.

The map *is* the data — no chrome inside the viewing surface, no legend, no axes, no
framing furniture. Affordances are layered on top of the data rather than arranged
around it.

Three capabilities make the strip usable:

1. **Free navigation.** Trackpad pan and zoom over the full-resolution vector strip,
   the way any map behaves.
2. **A navigator.** A thumbnail of the whole tube map, bottom-left, with a rect
   showing where the current view sits. It answers "where am I inside this node" at
   a glance, and can be dragged or clicked to move.
3. **A feeler** *(built; always on — see Feeler mode below)*. Holding
   `Shift` turns the cursor into a probe: the strand it is on is drawn in full while the
   rest recede. The emphasis **follows the cursor** — one strand at a time, decided
   2026-08-14. Releasing clears everything. This is the deliberate tool
   that the continuous coloring makes necessary — it separates one haplotype from its
   genetically-similar neighbours without distorting the color that carries the
   ancestry signal. Because it is opt-in, the view stays calm during plain reading.

The viewer performs no layout. The server returns a finished SVG; this is a viewport
and interaction layer over someone else's picture.

## User Stories

### Opening and framing

1. As a researcher, I want to open a sequence tube map from a minigraph node in the
   3D graph, so that I can see the variation the node summarizes.
2. As a researcher, I want the viewer to accept a URL and render the tube map it
   returns, so that I see the interior of the node I clicked.
3. As a researcher, I want the whole tube map framed in the window when it first
   opens, so that I understand the shape and extent of the node's interior before
   committing to a detail view.
4. As a researcher, I want a progress indicator while the map loads, so that a
   multi-megabyte fetch doesn't look like a hung application.
5. As a researcher, I want the map to appear all at once when ready, so that I never
   see a half-drawn or reflowing picture.
6. As a researcher, I want a clear message when a map fails to load, so that I can
   tell a network problem from an empty result.
7. As a PGB developer, I want the viewer to take a URL and nothing else, so that PGB
   owns query construction and the viewer stays ignorant of genomics.
8. As a PGB developer, I want to point the viewer at a local file during development,
   so that I can work offline against a fixed fixture.

### Navigation

9. As a researcher, I want to pan by dragging, so that moving around works exactly as
   it does in the PGB browser I arrived from.
10. As a researcher, I want to zoom with a Magic Mouse swipe, a wheel, or a pinch, so
    that I can move between overview and detail continuously — again as in PGB.
11. As a researcher, I want zoom to happen about the cursor, so that the feature I am
    pointing at stays under my finger as I zoom into it.
12. As a researcher, I want zoom bounded at the low end by whole-map fit, so that I
    cannot get lost in empty space around the data.
13. As a researcher, I want zoom bounded at the high end, so that I cannot zoom past
    the point where I'm looking at rendering artifacts rather than data.
14. As a researcher, I want panning to stay smooth across ten thousand elements, so
    that navigation never feels like it is fighting me.
15. As a researcher, I want the map to stay vector-sharp at every zoom level, so that
    detail resolves as I zoom rather than blurring.
16. As a researcher, I want resizing the window to reveal more or less of the map
    rather than re-framing it, so that I don't lose the position I navigated to.
17. As a researcher who has not yet moved the view, I want a resize to re-fit the map,
    so that the initial framing stays correct until I've invested in a position.

### Navigator

18. As a researcher, I want a thumbnail of the entire tube map visible at all times,
    so that I always know how the detail I'm viewing relates to the whole node.
19. As a researcher, I want a rect on the thumbnail showing my current viewport, so
    that I can locate myself without zooming out.
20. As a researcher, I want that rect to shrink as I zoom in, so that I can see how
    magnified I currently am.
21. As a researcher, I want to drag the rect to move the main view, so that I can
    traverse the node quickly without repeated panning.
22. As a researcher, I want to click anywhere on the thumbnail to jump there, so that
    moving to a distant part of the map is one gesture.
23. As a researcher, I want the navigator and the main view to always agree, so that
    I never have to work out which one is telling the truth.
24. As a researcher, I want the navigator at the lower left, out of the way, so that
    it never covers the data I'm reading.

### Feeler mode — tracing haplotypes

> **Built, then disabled (2026-08-13).** Every story below is implemented and works
> on the fixture, but on real maps the highlight tears and renders partially:
> restyling ~10,000 strand elements costs ~28 ms, and a sweep asks for that several
> times a second. Feeler mode is off by default (`strandFeeler`; `?feeler` re-arms
> the harness). *(Both the flag and the surface it guarded were deleted 2026-08-16, #40;
> the finding below is what outlives them.)*
>
> **The general finding, which outlives this section:** *altering the appearance of
> the strand set in real time, driven directly by pointer position, will not
> perform.* That covers highlighting, de-emphasis, and any future live restyling of
> the ribbons alike — the wall is the coupling of appearance change to pointer rate,
> not any one feature.
>
> **What survives is every capability; what changes is the means of invoking it.**
> Story 28 — separating one haplotype from its near-identical neighbours — remains a
> live requirement, and so does the rest of what these stories *want*. The stories
> below describe a **direct** route to it that this element count does not support.
> Expect an indirect route instead: a list, a menu, a palette assigning colors to
> samples, selection driven by the host, a click rather than a hover — anything
> where the rule swaps once per user decision rather than once per pointer move. A
> highlight already standing was measured to cost nothing to navigate under.
> Observation and measurements:
> [`notes/2026-08-13-direct-strand-interaction-is-not-viable.md`](./notes/2026-08-13-direct-strand-interaction-is-not-viable.md).
>
> **Re-enabled on the WebGL surface (2026-08-14, #39), and the general finding above is
> withdrawn for it.** The ~28 ms was style invalidation in the DOM, not a property of this
> problem. Strand appearance is now a `DataTexture` of one texel per strand, so moving the
> emphasis writes one byte per *strand* — nothing per band — and the frame uploads 2 KB: on
> `5520+` a sweep that moves it 198 times across 198 strands holds a median write of 0.000 ms
> and a worst of 0.100 ms in every window of the sweep, and the worst frame while sweeping
> (9.4 ms) equals the worst frame over the same moves with the key released.
> **The direct route is what ships there.** The indirect routes above are still worth having
> and are no longer the only option.
>
> **Story 29 is deliberately not met there, and that is a reversal rather than a gap.** The
> user decided 2026-08-14, on looking at it built, that the emphasis must *follow* the cursor:
> exactly one strand at full colour, the one under the feeler now. Accumulating a set leaves a
> widening trail of lit strands behind a sweep, and the strand being pointed at becomes one of
> dozens — the opposite of story 28. The set this story wants is still wanted; it needs a
> deliberate gesture rather than the side effect of a sweep. ~~The SVG surface still
> accumulates.~~ *(Deleted 2026-08-16, #40 — nothing accumulates anywhere now.)*
>
> Met there: 25, 26, 27 (crosshair and a badge), 28 — *from about one css pixel per band
> upward* — 30, 31, 32, 34, 36 (one canvas and a pick pass, so the dead zones this story was
> written against cannot arise) and 37. **Two more are not met and are not merely pending:**
> **33**, a smooth rather than instant change, which needs per-strand animation and a surface
> that draws every frame rather than on demand; and **35**, seeing *which* strand is under the
> cursor, which needs `trackName` — the band parser reads geometry, colour and `trackID` and
> nothing else, so the harness's `?pick` readout can name a strand only by number.
>
> At fit-to-width story 28 is not met at all: a band on `5520+` is 0.19 css pixels tall and
> 5.7 strands share a device pixel row, so there is no pixel in which an emphasized and a
> receded strand can differ. That is a pixel budget, and the candidates for it are weighed in
> [`docs/DISAMBIGUATING-STRANDS.md`](./docs/DISAMBIGUATING-STRANDS.md). One of them — a floor of
> ink for the emphasized band — was tried and removed, because a band emitting more ink than
> the document gave it is brightening the one rather than dimming the others, which story 30
> forbids. ~~The SVG surface keeps the paragraphs above unchanged: its feeler stays off, behind
> `?feeler`.~~ *(#40, 2026-08-16: there is one surface, its feeler is on, and "there" above
> now means the viewer.)* Measurements:
> [`notes/2026-08-14-feeler-mode-on-the-gpu.md`](./notes/2026-08-14-feeler-mode-on-the-gpu.md).

25. As a researcher, I want strands to stay quiet when I'm merely moving the cursor
    around, so that reading the map is not a strobing distraction.
26. As a researcher, I want to hold `Shift` to enter a mode where the cursor
    highlights strands it touches, so that highlighting is something I choose rather
    than something that happens to me.
27. As a researcher, I want a visible cue that feeler mode is active, so that I am
    never in a mode I've forgotten about.
28. As a researcher, I want to separate one haplotype from its neighbours even when
    they are nearly the same color, so that genetic similarity does not prevent me
    from reading individual paths.
29. As a researcher, I want strands to accumulate as I sweep across them, so that I
    can build a comparison set of several haplotypes.
30. As a researcher, I want non-selected strands to recede rather than selected ones
    to brighten, so that my selection is legible among hundreds of saturated
    neighbours.
31. As a researcher, I want the ancestry coloring left undistorted, so that
    highlighting never changes what the colors mean.
32. As a researcher, I want releasing `Shift` to clear every highlight at once, so
    that returning to a clean view is a single gesture.
33. As a researcher, I want the highlight change to be smooth rather than instant, so
    that sweeping across many strands doesn't flicker.
34. As a researcher, I want a highlighted strand highlighted along its whole length,
    so that I can follow one haplotype across the entire node.
35. As a researcher, I want to see which strand I'm touching, so that I can identify a
    haplotype I want to note down.
36. As a researcher, I want strand highlighting to work at every point along a strand,
    so that there are no unexplained dead zones where the gesture fails.
37. As a researcher, I want the map to hold still while I'm feeling my way across it,
    so that the strand under my cursor doesn't slide away mid-gesture.

### Inspect mode — segments

38. As a researcher, I want to hover a segment box when not in feeler mode, so that I
    can query the subgraph's structure without leaving the map.
39. As a researcher, I want a segment to show its identifier and sequence, so that I
    can connect what I'm seeing to the underlying graph.
40. As a researcher, I want segments to stay out of the way while I'm tracing strands,
    so that the two interactions never compete for the cursor.
41. As a researcher, I want the mode governed by one key I'm already holding, so that
    there is no separate mode control to learn or find.

### Integration (later, but shaping the build now)

42. As a PGB developer, I want the viewer to render into any container I hand it, so
    that it can fill a bare window here and sit inside a PGB card later.
43. As a PGB developer, I want the viewer to share no dependencies with PGB's 3D
    stack, so that dropping it in cannot disturb existing rendering.
44. As a PGB developer, I want the viewer cleanly destroyable, so that opening and
    closing the panel repeatedly does not leak listeners or DOM.

## Implementation Decisions

### Scope boundary

- **The viewer is a pure viewer.** The server returns finished SVG; the viewer treats
  it as opaque and immutable. No layout, no path routing, no geometry, no charting
  library. Re-ordering, filtering, or recoloring strands would be server-side
  parameter requests, not client-side work.
- **No Three.js.** Pure HTML / CSS / SVG / TypeScript. Zero dependency overlap with
  PGB's 3D stack.
- **All files TypeScript**, per PGB's standing convention.

### Modules

**`mountTubeMapSurface(container)`** — the single public entry point. Renders surface
and navigator into any container; knows nothing about panel chrome, cards, or PGB.
Returns a handle:

- `open(url: string)` — fetch, parse, display. The *entire* input surface.
- `destroy()` — remove listeners and DOM.

PGB constructs the URL from the clicked minigraph node's ID and its GRCh38
coordinates, and decides eligibility; the viewer never builds a URL and never
inspects one. A local development file is just another URL, so no local-vs-remote
branch exists anywhere in the code.

~~**Viewport transform module** — pure, DOM-free, owns `{ x, y, scale }` and every
conversion touching it: `fitToWidth`, `pan`, `zoomAbout`, `screenToContent`,
`contentToScreen`, `viewportRectInContent`, `panToNavigatorPoint`. One state object
drives both surface and navigator, so the two cannot disagree.~~

**Navigator module** — ~~bakes a bitmap thumbnail once on load~~ **renders the map into a
render target once per document and reads it back**, renders the viewport rect, handles
drag and click-to-center ~~by delegating to the transform module~~ **by asking the surface
for a content point**.

~~**Interaction module** — pointer and keyboard handling, mode switching, highlight
rule management, tooltips.~~

> **Amended 2026-08-16 (#40), and this is where the module list stands.** The viewport
> transform module and the interaction module are **deleted**, with the SVG surface they
> served. Pan and zoom are three.js `MapControls` — the transform module was a hand-written
> copy of `pgb/src/mapControlsFactory.js`, written only because the SVG viewer had no
> three.js, and ADR `0001` records that as its largest error. What survives of it is
> `src/geometry.ts`: `Point`, `Size`, `Rect`, `clamp`, and nothing else.
>
> In their place: **`bandSurface.ts`** — the scene, the shaders, the controls, the feeler —
> behind the four calls of `BandSurface` (`show(text)`, `clear`, `resize`, `destroy`), which
> is the whole of what the mount knows about it. Beside it, **`parseBands.ts`** and
> **`parseSegmentBoxes.ts`** read the response, **`bandCamera.ts`** owns the framing
> arithmetic, **`bandPicker.ts`** answers which strand is under the cursor,
> **`strandAppearance.ts`** holds how each one looks, **`feelerKey.ts`** owns what `Shift`
> means, and **`segmentOverlay.ts`** draws `g.node` as divs. `README.md` §"Shape of the
> code" is the current table.

### Rendering and navigation

- ~~**Pan/zoom via CSS `transform`** on a wrapping div (`transform-origin: 0 0`,
  `will-change: transform`), *not* `viewBox` mutation, which invalidates and
  re-rasterizes all ~10,345 elements every frame. Canvas rasterization was rejected
  outright — it forfeits per-element hit-testing, which the entire interaction model
  depends on.~~ **Reversed on both counts and deleted 2026-08-16 (#40).** `will-change`
  is exactly what promoted the composited layer that came apart at 900 megapixels
  (2026-08-13), and the canvas this ruled out is what the viewer is: pan is
  `camera.position`, zoom is `camera.zoom`, and per-element hit-testing came back as a GPU
  pick pass that agrees with the picture by construction. ADR `0001`, `CONTEXT.md` #6.
- **Gestures match PGB**, which configures three.js `MapControls` with
  `zoomToCursor`, `zoomSpeed: 1.2`, rotation off. Primary-button drag pans one-for-one
  in screen pixels; every `wheel` — Magic Mouse swipe, conventional wheel, and the
  ctrl+`wheel` macOS synthesizes for a pinch — zooms about the cursor on
  `MapControls`' own curve, `0.95 ** (zoomSpeed * deltaY / 100)`. `deltaX` is ignored.
  One deliberate deviation: line- and page-mode `deltaMode` values are converted to
  pixels first. three.js reads `deltaY` raw, which on a line-reporting browser makes a
  notch zoom by ~0.06% — PGB never meets that because it ships in Chrome.
- **Initial view is fit-to-width.** Zoom clamped to ~~`[fit, 4×]`~~ **`[fit, 200×]`
  (2026-08-14)**, about the cursor. `4×` was calibrated on the 600 bp fixture and resolves
  nothing on the documents that matter.
- **Resize preserves ~~`{x, y, scale}`~~ the view** — `camera.position` and `camera.zoom`
  since #40 — except when the view is untouched at initial fit, in which case it re-fits.

### Loading

- ~~Parse with `DOMParser`, **not** `innerHTML`, so the document can be cleaned before
  it is ever attached — one reflow instead of two, no half-rendered flash.~~
- ~~**Strip all `<title>` elements on load.** The response carries 10,345 empty ones;
  they are dead weight and they fight custom tooltips.~~
- Spinner in the body until the parsed document is attached.

> **Both parse bullets retired 2026-08-16 (#40).** The document is never attached to the
> page at all: the response text goes to a regex parser and comes out as six floats per
> band, so there is no tree to build safely and no `<title>` in the browser's way. The
> spinner stands, and beside it the error card — a document the band grammar refuses is
> refused whole and named, which is a stronger form of the safety the `DOMParser` bullet
> was reaching for. `CONTEXT.md` #12.

### Navigator

- **Baked bitmap**, produced once on load by serializing the SVG to a canvas. A
  second live copy would roughly double element count for something rendered ~90× too
  small to resolve individual strands. The navigator's affordances are chrome *over*
  the thumbnail, not interactions *with* strands.
- Rect scales with zoom; drag pans; click centers.

### Interaction model

> **The table below is the SVG surface's model and that surface was deleted 2026-08-16
> (#40).** Two rows no longer describe anything: segment boxes are hoverable with no key
> held and take real pointer events (amended 2026-08-15, `CONTEXT.md` #13), and the cursor
> is a pointing finger rather than a `crosshair` (2026-08-16). Two rows are still exactly
> right and are settled: strands answer only under `Shift`, and pan and zoom are suppressed
> while it is held — not for the hit-test cost the paragraphs below give, which is gone, but
> because the mode exists to hold the picture still while the cursor reads it. The
> dead-zone argument below is also retired on its own terms: there is one canvas and a pick
> pass answering with a strand id, so the class of bug it guards against cannot arise.

**`Shift` arbitrates pointer ownership**, making the two interaction sets mutually
exclusive by construction rather than by hit-test arbitration:

| | Feeler mode (`Shift` held) | Inspect mode (released) |
|---|---|---|
| Strands | own the cursor, highlight on contact | inert |
| Segment boxes | `pointer-events: none` | hoverable, show tooltip |
| Pan / zoom | suppressed | live |
| Cursor | `crosshair` | default |

This resolves a real hazard. Segment boxes paint *after* strands and are hit-testable
across their full fill area — `fill-opacity: 0.4` does not disable pointer events.
They occupy narrow vertical bands, and strands are horizontal, so sweeping across
strands means moving vertically at a fixed x. Without intervention, an x landing
inside a segment band would fail to highlight *at all*, presenting as a random dead
zone rather than an explicable rule. Disabling segment hit-testing in feeler mode
eliminates the class of bug rather than patching its symptoms.

Suppressing pan/zoom in feeler mode follows the same reasoning: feeling and moving
are different intents, and mixing them makes both feel unreliable.

**Highlighting:**

- Highlight is **deliberate, never incidental** — plain hover does nothing.
- Strands touched while `Shift` is held **accumulate**; releasing clears all.
- **De-emphasize the others** rather than brighten the selected. At 369 overlapping
  saturated ribbons, dimming reads instantly where brightening does not — and it
  leaves the ancestry coloring of the selected strands untouched, which matters
  because that color is data.
- Implemented as **one swapped CSS rule** of the form
  `g.track > *:not(.trackN) { opacity: … }`. Every element of a strand carries
  `class="track<N>"` (avg 28 elements per strand, max 47), so highlighting is O(1) per
  hover regardless of element count — no DOM walk, no per-element listeners. A short
  transition prevents strobing during a sweep.
- **This last claim did not survive contact with real maps.** O(1) covers *writing*
  the rule; the browser still invalidates style for all ~10,000 children of `g.track` on
  every swap — measured at ~28 ms each — at pointer-move rate. Hence the default-off
  flag. An indirect selection keeps everything in this section and only changes how
  often the rule is swapped.

**Tooltips:**

- Strand: raw `trackName` (`sample#haplotype#contig`), unparsed.
- Segment: `id` and `sequence`, verbatim. Sequences are tiny — median 1 bp, max 130 —
  so this always fits with no truncation and no detail panel. Segment tooltip
  *content* is provisional; the *capability* is what's preserved.

### Known data facts the implementation must respect

Measured from the sample response for one minigraph node, not assumed:

- `viewBox="0 -80 35562.42857142856 6325"` — ~5.6:1, ~25 screens wide at 1:1.
- 369 strands, 75 segments, 10,345 drawable elements, 3.4 MB.
- Segment boxes span only the haplotypes that traverse them: vertical span median
  5418, min 33, max 5553. A short box is a variant few haplotypes carry.
- `pclaiScore` is **not** a 0–1 float: integers 496–999 plus the non-numeric
  sentinels `"None"` and `"impainted"`. Any future parser must handle both strings.
- Strand color is a **continuous** function of `pclaiX`/`pclaiY`, not a categorical
  palette. Strands with no PCLAI call carry `pclaiX="None"` and render flat gray
  `rgb(211,211,211)`, including `GRCh38#0#chr1`.

The last two contradict the inferred metadata table in
`pgb/notes/sequence-tube-map/sequence-tube-map-api.md`, which correctly flags itself
as unverified. Fold these corrections back when this work lands.

## Testing Decisions

**What makes a good test here.** Test external behavior, not implementation. This
feature is overwhelmingly visual: if the map renders wrong it is obvious instantly,
and a test asserting elements exist is strictly worse than looking. Tests are aimed
narrowly at what can be *silently* wrong — arithmetic producing a plausible-looking
but incorrect picture.

~~**One seam: the viewport transform module.**~~ **Four seams, 2026-08-16 (#40) — the
rule is unchanged and the module is deleted.** The rule was never "one file"; it was
*test what can be silently wrong without looking wrong, and look at everything else*.
The seams that carry that now are `bandCamera.ts` (framing arithmetic, including risk 3
below), `parseBands.ts` and `parseSegmentBoxes.ts` (a mis-numbered regex group yields
plausible geometry), and `segmentOverlay.ts`'s incremental visibility threshold. All four
are pure and DOM-free, as this decision requires. Risks 1 and 2 below are `MapControls`'
arithmetic now, and testing them here would be testing three.js. `CONTEXT.md` #18.

Pure functions over `{ x, y, scale }`,
no DOM, no fixtures, no test infrastructure. All three silently-wrong-able risks live
inside it:

1. **fit-to-width** — an off-by-a-factor result still looks like a reasonable view.
2. **zoom-about-cursor drift** — subtly wrong math makes the point under the cursor
   creep during zoom, reading as "feels bad" rather than "is broken".
3. **navigator-rect ↔ viewport scale** — a wrong factor produces a rect that moves
   correctly but is the wrong size, which looks plausible indefinitely.

Representative cases: fit computes correct scale and origin for known content and
viewport sizes; zooming about a point leaves that point stationary in content space;
zoom clamps at both bounds; pan is invertible; `screenToContent` and `contentToScreen`
round-trip; `viewportRectInContent` shrinks proportionally as scale rises.

**Not tested at a higher seam.** Testing through `mountTubeMapSurface` in jsdom was
considered and rejected: jsdom has no layout engine, so `getBoundingClientRect`
returns zeros and the transform math — the only part worth testing — becomes
untestable at exactly the seam that appears highest. What remains testable there is
element existence, which the eye verifies faster and better.

**Everything else is verified visually:** ~~SVG injection, `<title>` stripping,
highlight CSS, mode switching~~ **the drawn map, the feeler, the segment boxes**,
tooltips, navigator appearance, and pan/zoom feel. Several of those now have a
playwright driver that does the looking and leaves the screenshots behind —
`scripts/verify_{pick,highlight,segment_boxes,refusal,pointer_binding}.mjs`. They are
not unit tests and are not run by `npm test`; they are a way of looking that can be
repeated.

**Prior art.** PGB's tests live in `src/__tests__`. This repo has no suite yet; the
transform module's tests establish it.

## Out of Scope

- **Any layout computation.** The server owns it.
- **Strand filtering, re-ordering, or recoloring.** Server-side parameters if ever
  needed. Recoloring in particular would destroy the ancestry signal.
- **`trackName` decoding.** `NA21309#2#CM092097.1` is `sample#haplotype#contig`, a
  3-part assembly-walk-shaped key addressable in PGB's vocabulary, but v1 displays it
  verbatim.
- **PCLAI metadata display.** `pclaiX`, `pclaiY`, `pclaiScore` are present on every
  strand and deliberately unused. The obvious future affordance — hovering a strand
  locating that haplotype in PGB's existing PCLAI chart panel — is not in v1.
- **1D↔3D correspondence.** PGB's `CLAUDE.md` treats bidirectional mapping as
  load-bearing UX. v1 ships without it. **Raised and consciously scoped out** — a
  deferred obligation, not an oversight, to revisit before the feature reaches users.
- **Event bus integration.** v1 publishes and subscribes to nothing.
- **The click-to-menu path in PGB.** PGB has no node-click event today —
  `eventMap.ts` carries only `lineIntersection` hover — and no menu offering the tube
  map. TBD in PGB. Note the API constraint: a minigraph node absent from GRCh38 has
  no tube map, so the menu item must not be offered for one.
- **Live API wiring and CORS.** v1 runs against a committed local fixture.
- **Panel chrome.** Cards, headers, drag handles and navbar buttons belong to PGB.
- **Multiple simultaneous maps.** One surface per container.

## Further Notes

**Establish two things early — both cheap now, expensive at integration.**

1. ~~**Frame budget.** Smooth panning of 10,345 live elements under CSS transform is
   expected but unmeasured. Measure in week one. If it fails, the fallback ladder is:
   reduce transition work, then `content-visibility`, then reconsider — but *not*
   canvas, which forfeits hit-testing.~~ **Measured 2026-08-13, and it failed.** The
   ladder was not climbed: the layer itself was the problem at 900 megapixels, and the
   answer was the canvas this bullet ruled out — hit-testing came back as a GPU pick pass.
   The CSS-transform surface was deleted 2026-08-16 (#40). ADR `0001`.
2. **CORS.** The endpoint is `https://pangenome-api.ucsd.edu:8000/seqtubemap` — a
   non-standard port, browser-origin CORS behavior unknown. If headers are absent,
   that's a request to Cici Bu or a proxy route, far better known now than during
   integration.

**Every measurement here comes from one minigraph node**
(`chr1:25331046-25331646`, `minigraphnode=5519`). A larger or more variable node
could carry far more strands or segments. Avoid over-fitting to 369×75.

**The 3.4 MB fixture is committed deliberately** — reproducibility from a fresh clone
beats repo hygiene in a spike. The equivalent question for the *pgb* repo is genuinely
open and is flagged in the API note.
