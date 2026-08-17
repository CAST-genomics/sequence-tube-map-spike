# Sequence Tube Map — standalone build

**Status:** design settled 2026-08-11 by grilling interview; domain language
corrected 2026-08-12. Built 2026-08-12 — every settled decision below is
implemented **or annotated in place with the date it was reversed**; several are, and
where they are, the annotation is the current state rather than the sentence above it.
See [`README.md`](./README.md) for how to run it.
**Parent app:** PGB (`~/PanGenomeProject/pgb`). This directory is a standalone
harness; the code here is intended to survive integration into PGB.

---

## What this is

**A magnifying glass on a single minigraph node.**

PGB renders a pangenome graph in 3D as nodes and edges. Each node is a collapsed
summary — it stands for a stretch of sequence that hundreds of haplotypes traverse,
but it says nothing about *how* they traverse it. The variation is inside, and the
3D view cannot show it.

The sequence tube map is what you see when you put a magnifying glass to one of
those nodes. Inside is a minigraph-cactus subgraph at base-level resolution:
segments of sequence, and every haplotype's path threaded through them. That is
where the SNVs, insertions, deletions, duplications and inversions actually live.

The user experience: looking at the pangenome graph in 3D, the user clicks a
minigraph node, a menu appears, and one option shows the sequence tube map of what
is inside that node.

**PGB fetches the SVG; this viewer displays it.** The layout is done server-side by
the UCSD API. This build owns viewport, navigation and interaction. It owns no
layout, no path routing, no geometry.

## Vocabulary

**A naming collision has to be resolved.** "Node" means two different things across
the boundary between PGB and this viewer, at two different scales. Proposed
resolution, used consistently throughout these documents:

| Term | Meaning |
|---|---|
| **minigraph node** | A node in PGB's 3D pangenome graph — the thing the user clicks. Its ID goes to the API as `minigraphnode`. The container. |
| **segment** | One of the ~75 sequence boxes *inside* the tube map, drawn in `<g class="node">` with ids like `79337767`. The contents. Called "node" by the SVG and by upstream sequence-tube-map; renamed here to keep the two scales distinct. |
| **track** / **strand** | One haplotype's path through the subgraph, drawn as a colored ribbon left→right. Named `sample#haplotype#contig`, e.g. `NA21309#2#CM092097.1`. |
| **band** | The atomic drawable: **one track crossing one x-interval** — a single `<path>` or `<rect>` in `g.track`. A track is made of many bands. *Avoid* "ribbon" for this; a ribbon reads as the whole strand. Added 2026-08-13. |
| **span** | A minigraph node's GRCh38 base-pair extent (`end − start`), as recorded in `data/nodeTable.json`. *Avoid* "size", which conflates four separate quantities — see the note under Risks. Added 2026-08-13. |
| **surface** | The pannable/zoomable area the map is drawn in. ~~Holding the tube-map SVG~~ — **amended 2026-08-16 (#40):** it holds a WebGL canvas, and the document is never attached to the page at all. There is exactly one surface. |
| **navigator** | Thumbnail of the whole tube map, bottom-left, with a rect showing the current viewport. |
| **feeler mode** | `Shift` held. Cursor acts as a feeler: the strand under it is drawn in full and the rest recede. ~~Segments inert, pan/zoom suppressed.~~ **Amended 2026-08-15:** the key *adds* emphasis and takes nothing away from *segments* — they stay hoverable under it. Pan and zoom are a separate question and are unchanged: the WebGL surface still suppresses them while feeling, for a reason of its own — see #13. ~~**On by default on the WebGL surface** since 2026-08-14, where the emphasis *follows* the cursor; off by default on the SVG surface, and staying that way, where it accumulates~~ — **2026-08-16 (#40): always on, and the emphasis follows the cursor.** There is no flag and no accumulating variant; the surface that could not afford the highlight is deleted. See the notes under Interaction. |
| ~~**inspect mode**~~ | ~~`Shift` released. Segments hoverable, strands inert, pan/zoom live.~~ **Retired 2026-08-15.** Once segments are hoverable unconditionally, this named the absence of feeler mode and nothing else. A mode that is on whenever another isn't is not a mode; it is the map. ~~Still current on the SVG surface, which is not being changed.~~ **2026-08-16 (#40): retired outright** — the surface it was still current on is gone. |

*If `segment` is wrong — if the team already says "node" at both scales, or prefers
another term — say so, because it propagates through every document and identifier
from here on.* New vocabulary belongs in PGB's `CLAUDE.md` / `CONTEXT.md` once
settled.

## What the colors mean

Track color encodes **PCLAI — point cloud local ancestry inference** (Geleta et al.,
*Nature Genetics* 2026; `~/PanGenomeProject/pclai-nature-paper-2026/`).

PCLAI deliberately **rejects discrete ancestry labels**. Instead each haplotypic
segment is assigned a *continuous coordinate* in a low-dimensional PCA space, where
Euclidean distance approximates F₂ — accumulated genetic drift between populations.
A haplotype's genome becomes a point cloud, one coordinate per locus, with
recombination breakpoints separating segments.

Consequences for this viewer, all verified against the sample data:

- Each track carries `pclaiX` / `pclaiY` — its local ancestry coordinate **at this
  locus** — and a `color` that is a continuous function of them. Tracks at
  `(-1.746, 0.192)` and `(-1.745, 0.193)` receive `rgb(0,232,180)` and
  `rgb(0,232,180)`.
- **Do not describe the colors as categories, families, or clusters.** They are
  samples of a continuous space. Visible banding is genuine structure in the data,
  not a palette.
- Tracks with no PCLAI call carry `pclaiX="None"` and render flat gray
  `rgb(211,211,211)` — including `GRCh38#0#chr1`.
- Consequently near-identical colors are *meaningful*: two ribbons look alike
  because those haplotypes are genetically close at this locus. This is precisely
  why tracing an individual strand needs a deliberate tool (feeler mode) rather than
  better color separation — the similarity is the signal, not a defect to design away.

**One correction, 2026-08-14 — where this section over-reaches.** Everything above is
true of the PCLAI *coordinates*. It is not true of the 8-bit color the data ships, and
the difference decides whether anything can be done about tracks that cannot be told
apart. The `RGB` field
is an encoding of the coordinate derived for **PGB's PCLAI chart**, a scatter where
position separates the points and color is a supporting cue; a tube map has no position
channel to spare. Measured across PGB's datasets (`scripts/pclai_color_collisions.py`):
~460 placed haplotypes receive 120–150 distinct colors, four in five sharing a color with
another haplotype *exactly*, and at `cici`'s busiest node two haplotypes 8% of the PCA
cloud's diameter apart get the same RGB.

So: near-identical colors *are* meaningful, and identical colors are **not** — that is
quantisation, not a claim that two haplotypes are alike. Read as written, this section
implies the collisions are the signal and nothing can be done about them, which is not
the case. See
[`docs/DISAMBIGUATING-TRACKS.md`](./docs/DISAMBIGUATING-TRACKS.md).

## Verified facts about the data

Measured from `stm-chr1-25331046-25331646.svg` (sample response for one minigraph
node), not assumed:

- **3.4 MB**, `viewBox="0 -80 35562.42857142856 6325"` — a ~5.6:1 strip, ~25 screens
  wide at 1:1.
- **369 tracks**, **75 segments**, **10,345 drawable elements** (4,603 `<rect>` +
  5,742 `<path>`).
- **Every track element carries `class="track<N>"`** — avg 28 elements per track,
  max 47. Highlighting a strand is therefore a **single CSS rule**, not a DOM walk.
- **10,345 empty `<title>` elements**, one per drawable. Dead weight; they also
  fight custom tooltips.
- **Segment sequences are tiny**: median **1 bp**, max 130, 896 bp total across the
  600 bp node. Most segments are single-base variants. `nodewidthoption=compressed`
  (log₂) keeps a 1 bp segment visible.
- **Segment boxes span the haplotypes that traverse them**, not always all of them:
  vertical span median 5418, min 33, max 5553; 48 of 75 exceed 5000. A short box is
  a variant only a few haplotypes carry.
- **Segment boxes paint after tracks** and are hit-testable across their full fill
  area — `fill-opacity: 0.4` does *not* disable pointer events. They occupy narrow
  vertical bands, so without intervention they create thin invisible dead zones where
  strand hover silently fails.

### Two corrections to `pgb/notes/sequence-tube-map/sequence-tube-map-api.md`

That note flags its metadata table as inferred-not-confirmed. Both inferences are wrong:

1. **`pclaiScore` is not a 0–1 float.** Real values are integers `496`–`999`, plus
   two non-numeric sentinels: `"None"` and `"impainted"`.
2. **Colors are not categorical** — see above.

*Fold these back into the pgb note when this work lands.*

## Settled decisions

### Scope and seam

1. **Pure viewer.** SVG from the server is opaque and immutable. No re-ordering,
   filtering or recoloring — those would be server-side parameter requests, not
   client-side layout work.

    **Reversed 2026-08-13.** The viewer now **interprets the server's geometry**: it
    parses band coordinates out of the SVG and rasterizes them on the GPU. This was
    the most load-bearing property of the original design and giving it up is the
    real price of the renderer change — UCSD becomes an upstream we are coupled to at
    the level of drawing primitives. Paid for with a validation gate that rejects a
    non-conforming document outright and falls back to the SVG surface. The
    *no-layout* half of this decision stands: still no re-ordering, filtering or
    recoloring. See ADR [`0001`](./docs/adr/0001-webgl-band-renderer.md).

    **The fallback is rejected, 2026-08-14; the gate stands.** A document off the band
    grammar is refused whole, loudly, and the mount shows a named error state. **It
    does not fall back to the SVG surface, and it never will** — the sentence above
    ("falls back to the SVG surface") is retired, not deferred.

    The reasoning, decided by the user: a rejection is a thing to deal with when it
    occurs, from the document that caused it. Insuring against it with a permanent
    second implementation costs a surface that must be carried, kept working and paid
    for by every feature that lands after it — and buys a researcher who cannot tell
    which renderer drew what they are looking at. An error that surfaces is also the
    only arm that produces a bug report; a silent swap hides the grammar drifting.

    The gate keeps its whole point: the API returns 200-with-plausible-nonsense for an
    unknown node, so refusing loudly is what stands between that and a map that looks
    correct and is of different data. See ADR
    [`0001`](./docs/adr/0001-webgl-band-renderer.md).

    **The SVG surface is deleted, 2026-08-16 (#40).** The paragraph above retired the
    fallback as a *behaviour*; this retires the thing it would have fallen back to. There
    is one surface, no `?renderer=`, and no way to look at a refused document at all. What
    that costs — a grammar change on UCSD's side now shows every affected researcher an
    error card rather than a slow map — is recorded in ADR
    [`0001`](./docs/adr/0001-webgl-band-renderer.md) in its own voice, because it is a real
    reduction in safety and not a tidy-up.
2. **`open(url: string)` is the entire input surface.** PGB constructs the URL from
   the clicked minigraph node's ID and GRCh38 coordinates; the viewer never builds
   one, never checks eligibility, and never knows whether it is local or remote. A
   dev file in `public/` is just another URL — no local/remote branch exists.
3. **No event bus in v1.** Input is one function; all correspondence wiring is
   deferred. Nothing to publish or subscribe to.
4. **`mountTubeMapSurface(container)`** renders surface + navigator into any
   container and knows nothing about panel chrome. The harness passes the full
   viewport (pure data, no chrome); PGB later passes a card body.

    ~~**Extended 2026-08-14.** The signature is now
    `mountTubeMapSurface(container, { renderer })`, where `renderer` is `webgl` (the
    band renderer, the default) or `svg` (the original surface).~~ The mount kept the
    fetch, the spinner and the error state; everything about the *view* — fit, zoom,
    what a resize does — moved into the renderer, because the two answer it in
    different vocabularies. ~~The harness picks from `?renderer=`, so both surfaces are
    comparable on one document without a rebuild.~~ `open(url)` is unchanged and is
    still the entire input surface.

    **Withdrawn 2026-08-16 (#40): the signature is `mountTubeMapSurface(container)`
    again.** There is no `renderer` option and no `?renderer=`; the choice is gone rather
    than defaulted, which is the point — a default would leave the second surface
    reachable. The *split* survives the choice and is worth keeping straight from it: the
    mount still owns only the container, the fetch, the spinner and the error state, and
    everything about the view is still behind four calls, now named `BandSurface` in
    `bandSurface.ts` rather than `SurfaceRenderer` in a file of its own. One
    implementation, one seam — because what the seam is really for is keeping the fetch
    and the camera from growing into each other.
5. **Pure HTML / CSS / SVG / TypeScript. No Three.js.** Zero dependency overlap with
   PGB's 3D stack.

    **Reversed 2026-08-13.** `three@^0.176.0` is added, pinned to PGB's version. The
    rationale inverts: dependency overlap with PGB's 3D stack was a cost and is now
    the point — the dependency is free at the destination.

### Rendering and navigation

6. **Pan/zoom via CSS `transform`** on a wrapping div (`transform-origin: 0 0`,
   `will-change: transform`) — not `viewBox` mutation, which re-rasterizes 10k
   elements per frame. Keeps every element live for hit-testing. Canvas was rejected
   outright: it forfeits per-element hit-testing, which the whole interaction model
   depends on.

    **Premise collapsed 2026-08-13 — do not re-litigate this from the sentence
    above.** Canvas was rejected to preserve DOM hit-testing, and DOM hit-testing at
    pointer rate is precisely what does not work at this element count (~28 ms per
    hover; see #15). The composited layer that made panning cheap is also what broke
    rendering — 900 megapixels at dpr 2, 14.4 gigapixels at `MAX_SCALE`. Per-element
    hit-testing returns via GPU colour picking. `viewportTransform` and the single
    `{x, y, scale}` state object (#7) ~~survive unchanged and now drive an
    `OrthographicCamera`~~; the canvas is **viewport-sized**, so the oversized-layer
    failure is structurally impossible rather than fixed. See
    [`notes/2026-08-13-svg-rendering-hits-its-ceiling.md`](./notes/2026-08-13-svg-rendering-hits-its-ceiling.md).

    **Deleted 2026-08-16 (#40).** The CSS transform, the wrapping div, and
    `viewportTransform.ts` with them. They did not survive: `MapControls` replaced the
    arithmetic on 2026-08-14 (see #7 and the ADR's largest correction) and the surface they
    transformed is gone. `Point`, `Size`, `Rect` and `clamp` are what was left, and they
    are `src/geometry.ts` now — a name that describes what remains rather than what it used
    to drive.
7. ~~**Single `{x, y, scale}` state object** drives both surface and navigator, so the
   two cannot disagree.~~ **There is no such object, 2026-08-16 (#40)** — the last one
   went with the SVG surface. The property it existed for is what the generalization
   below preserves, and that is the part to carry forward.

    **Generalized 2026-08-14.** The WebGL surface has no `{x, y, scale}` — it steers
    `camera.position` and `camera.zoom` — so what the navigator is handed is the
    *conclusion* rather than the state: the slice of content space currently on screen,
    computed by whichever surface is drawing. The property that mattered is intact and
    now holds across both: the navigator stores no view of its own, so it cannot
    disagree with the surface about where the view is. The translation for the WebGL
    surface is `visibleContentRect` / `worldFromContentPoint` in `bandCamera.ts`.
8. **Gestures are PGB's** (three.js `MapControls`, `zoomToCursor`, `zoomSpeed: 1.2`):
   primary-button drag = pan; any `wheel`, ctrl-modified or not = zoom about the
   cursor. A researcher crosses between the two viewers constantly and must not have
   to change hands.
9. **Open fit-to-width**; clamp zoom to `[fit, 4×]`; zoom about the cursor.

    **Ceiling raised 2026-08-14, on the WebGL surface only.** `[fit, 200×]`. `4×` was
    calibrated against the 600 bp fixture and resolves nothing on the documents that
    matter — 0.77 css px per band on `5520+`, 0.47 on `5514+`, at maximum zoom. 200×
    is ~38 px per band on `5520+`; float32 starts to show around 1000×. ~~The SVG
    surface keeps `4×`, which is a defect of that surface and filed separately.~~

    **`[fit, 200×]` is the viewer's clamp outright, 2026-08-16 (#40)** — "on the WebGL
    surface only" no longer qualifies anything, and the `4×` defect was deleted rather
    than fixed.
10. **Resize preserves ~~`{x, y, scale}`~~ the view** and reveals more/less. Exception:
    re-fit if the view is still untouched at initial fit.

    **Restated 2026-08-16 (#40), unchanged in behaviour.** The rule was always about what
    the researcher sees; it named the state object because there was one. What is
    preserved is now `camera.position` and `camera.zoom`, and `untouched` is still the
    flag that decides. `bandSurface.ts` reads it *before* reframing, because raising the
    zoom floor under a view already at fit moves the camera and the change that announces
    is indistinguishable from the researcher having moved it.
11. **Navigator is a baked bitmap** — ~~serialize once on load~~, draw to canvas. Its
    affordances (drag rect, click to center) are chrome *over* the thumbnail, not
    interactions *with* strands, so live vectors buy nothing at ~90× reduction. Rect
    resizes with zoom.

    **On the WebGL surface, 2026-08-14, and still a baked bitmap.** The prediction
    above was that it would land as three.js geometry and a second camera rather than
    as a bitmap and a DOM overlay. Half of that was right and the half that was wrong
    is worth keeping straight:

    - **The thumbnail is baked, from the scene.** One render into a `WebGLRenderTarget`
      at thumbnail size, read back, drawn to the canvas — same scene, same shader, same
      instance buffer, a second camera fitted to the whole map. So it *is* the second
      camera; what it produces is a bitmap, because the image is static and re-rendering
      it per frame would spend a draw call to reproduce the same pixels. What the
      original objection was really about — a second, independently serialized copy of
      the document that can drift from the picture — does not arise.
    - **The rect stays in the DOM.** It is chrome *over* the thumbnail, not map content,
      which is what decision #11 said in the first place. Nothing about the renderer
      change argues for drawing a 1 px border in WebGL.

    **The width changed before anything was built.** `360` came from the 600 bp fixture
    at 360 × 64 and gives 26 px on `5520+` and 13 px on `5514+`. Rendered and looked at:
    26 survives, 13 is a hairline holding a 1.8 px rect. `THUMBNAIL_WIDTH` is now 720 —
    a maximum, shrinking to fit a narrow host. See
    [`notes/2026-08-14-navigator-thumbnail-aspect.md`](./notes/2026-08-14-navigator-thumbnail-aspect.md).

    ~~The segment boxes remain SVG-surface-only.~~ **They arrived on the WebGL surface
    2026-08-15 (#37), as HTML `<div>`s** — one wrapper carrying the camera's transform,
    boxes positioned inside it in world units, `border-radius: 9px` reproducing the
    quadratic corners exactly. `segmentOverlay.ts`. **Highlighting does not, as of
    2026-08-14** — see the note under #15; the WebGL surface highlights from an appearance
    table and the SVG surface no longer has the better story.

    **"Serialize once on load" is deleted, 2026-08-16 (#40)**, along with the surface that
    did it. The one remaining bake is the render-target read above, so the objection the
    original decision was guarding against — a second, independently rasterized copy of
    the document that can drift from the picture — is not merely answered but structurally
    absent. `THUMBNAIL_WIDTH` and the two gestures are unchanged.
12. ~~**Load with `DOMParser`, not `innerHTML`** — strip all `<title>` elements before
    attaching.~~ Spinner in the body until ready.

    **Retired 2026-08-16 (#40).** Both halves were about attaching the server's document
    to the page, which nothing does now: the response text goes to a regex parser and
    comes out as six floats per band, so there is no tree to build safely and no
    `<title>` to strip out of the browser's way. What stands is the spinner, and the error
    card beside it (#35). The safety this bought is not lost — it moved and grew teeth: an
    unparseable document is refused whole rather than attached and hoped for.

### Interaction

13. ~~**`Shift` arbitrates pointer ownership**~~, making the two interaction sets
    mutually exclusive by construction rather than by hit-test arbitration:
    - **held (feeler mode):** `g.node > * { pointer-events: none }`; strands own the
      cursor; no dead zones; pan/zoom suppressed; cursor `crosshair` so the mode is
      visible rather than remembered.
    - **released (inspect mode):** segments hoverable; strand highlights cleared.

    *(The two bullets are the SVG surface's implementation and describe nothing that
    exists after #40, 2026-08-16 — there is no `g.node` in the page and no CSS rule
    switched by the key. They are left standing because the amendments below are written
    against them. What `Shift` **means** is `feelerKey.ts`, and it lost its `armed`
    option with the surface that passed it false.)*

    **`Shift` no longer arbitrates segments on the WebGL surface, 2026-08-15 — over them
    it only adds.** Segments are hoverable whenever they are visible, with no key held:
    mousing over a thing and being told what it is is the plainest interaction there is,
    and a modifier key to reach it is a toll on the common case. Holding `Shift`
    *additionally* emphasizes the strand under the cursor; releasing it drops the emphasis
    and leaves the segment's tooltip standing, since the tooltip never depended on the key.

    **Pan and zoom stay suppressed, and that is settled, 2026-08-15.** The amendment above
    is about segments and reaches no further. Holding `Shift` *is* the act of isolating a
    track with the cursor, and a map that moved under a sweep would slide the strand out
    from under the feeler mid-gesture — the mode exists to hold the picture still while the
    cursor reads it. That reason is the mode's own purpose and has nothing to do with the
    ~28 ms hit-test this amendment retires, which is why retiring the one leaves the other
    standing. `bandSurface.ts` disables `MapControls` on the key down and re-enables it on
    the key up.

    Mutual exclusion existed because both sets competed for one hit-test that cost ~28 ms
    (#15). It doesn't any more: the strand pick is a texel read and the segment hover is a
    real DOM `pointerover` on one div. Two answers to two different questions — *which
    haplotype is this* and *which segment is this* — can both be given at once, so they
    are, and the surface distinguishes them by where each is displayed rather than by
    making the researcher choose.

    **The cursor names what the surface is doing, and nothing else — settled 2026-08-16.**
    Three states, and a segment box is never one of them:

    - **`grab`** — idle over the map, box or no box. #37 asked for `default` over a box,
      "not `pointer`, because nothing is clickable yet"; the second half is what was being
      decided, and `default` is a third answer. The canvas underneath says `grab`, so a
      cursor crossing 767 walls ~364 css px apart would flicker between arrow and hand
      continuously — and it would be lying, since a drag that starts on a box really does
      pan. Nothing signals clickability either way, which was the point. That a hand does
      not announce "this will show you a tooltip" is accepted: the tooltip arrives on hover
      with no gesture to guess at, so there is nothing for the cursor to advertise.
    - **`grabbing`** — while a pan is under way, for its whole duration.
    - **`pointer`, the pointing finger** — while `Shift` is held, over anything. Feeling
      switches the controls off, so a grip would promise a pan that cannot happen.

    All three are **one hand in three poses**: open to take hold, closed while holding, a
    finger out while feeling. That is what settled it, 2026-08-16 — the `crosshair` it
    replaced was an instrument reticle in a set of hands, and it promised two-axis precision
    the interaction does not have, since a feeler is *swept* and only its vertical position
    selects anything. Its stated job was to make the mode visible rather than remembered,
    and the badge already does that.

    `pointer` conventionally means clickable and nothing here is. The cost is accepted: the
    finger matches what the mode is, and while the key is held there is nothing to click
    anywhere, because the controls are off. Revisit when clicking a segment becomes real —
    that is a different mode, with no key held.

    **This is a class on the root, not `:active`**, and the reason is worth keeping.
    `MapControls` takes pointer capture on the root when a drag begins, and a captured
    pointer stops hit-testing for `:hover` and `:active` — the capture target takes them
    instead. `.stm-canvas:active` therefore stopped matching the instant the drag it
    described actually began, and the root, which had no cursor of its own, fell back to the
    arrow. Pressing showed the hand and moving took it away, which is exactly backwards.
    `bandSurface.ts` sets `is-panning` from `pointerdown`, for the primary button only and
    never while feeling; it is released from a listener on the *document*, because most
    drags of a map end off it.

    **Segment boxes are not dead zones.** They take pointer events and own hover, but
    `MapControls` and the pick listeners are attached to the common ancestor, so pan,
    zoom and the feeler bubble through them. This matters at the scale the boxes actually
    have: a median box on `5514+` is **18 × 5613** in a map 6360 tall — a floor-to-ceiling
    wall, ~28 CSS px wide at 200× and taller than any viewport, one of 767 spaced ~364
    CSS px apart. Boxes that swallowed gestures would kill ~8% of every drag and silently
    ignore a wheel-zoom aimed at exactly the feature the researcher wants to magnify.
14. **Highlighting is deliberate, not incidental.** Hover alone does nothing. With
    `Shift` held, strands touched by the cursor highlight and **accumulate**;
    releasing clears all. The cursor as a feeler, making near-identical ribbons feel
    palpable and tactile.

    **Accumulation is reversed on the WebGL surface, 2026-08-14 — the user's decision, on
    looking at it built.** There, exactly **one** strand is emphasized: the one under the
    cursor now. Moving hands the emphasis on and the previous strand recedes with the rest.
    Swept across the bundle, accumulation leaves a widening trail of lit strands behind the
    cursor, and the strand being pointed at becomes one of dozens at full colour — the
    opposite of telling it apart from its neighbours, which is what #32 asked for. Two
    corollaries, same decision: the map recedes on the key **alone**, before the cursor has
    touched anything, so the mode is legible immediately; and over empty space nothing is
    emphasized while the map stays receded, because springing back to full colour in every
    gap between bands would strobe.

    A comparison set of several haplotypes is still wanted (`SPEC.md` story 29). It needs a
    deliberate gesture rather than the side effect of a sweep, and the appearance table
    already supports one — it holds a byte per track and has no opinion about how many are
    lit. ~~The SVG surface's accumulating feeler is unchanged behind `?feeler`.~~

    **Deleted with the surface, 2026-08-16 (#40)**, and so is `?feeler`. Accumulation is
    now only a shape a future deliberate gesture might take, not a behaviour that still
    runs somewhere behind a flag — which is the honest state of it, since the flag was the
    last thing keeping a rejected interaction alive.
15. **De-emphasize the others**, don't brighten the one. At 369 overlapping ribbons,
    dimming reads instantly where brightening does not. One swapped CSS rule
    (`g.track > *:not(.trackN) { opacity: … }`) — O(1) per hover. Short transition to
    avoid strobing.
    **Superseded in practice, 2026-08-13:** "O(1) per hover" describes writing the
    rule, not honouring it. Each swap invalidates style for every one of the map's
    ~10,000 track children — measured at **~28 ms**, with 190 of 582 frames dropped
    during a sweep. Real maps tear and render partially.

    The general rule this establishes, which is not specific to highlighting:
    **changing the appearance of the strand set in real time from pointer position
    will not perform.** De-emphasis, highlighting, and anything else that restyles
    the ribbons live all buy the same ~28 ms; the wall is the coupling to pointer
    rate. ~~Feeler mode is therefore **off by default** (`strandFeeler`, `?feeler` in
    the harness), kept whole rather than deleted.~~ **Deleted 2026-08-16 (#40)** —
    `strandFeeler`, `?feeler` and the CSS-rule highlight behind them. The ~28 ms is a
    true fact about DOM style invalidation and stays recorded above; what was kept whole
    behind the flag does not, because the surface it restyled is gone.

    **The appearance vocabulary is not abandoned — its invocation is.** A highlight
    already standing costs **nothing** to pan and zoom under (8.3 ms median, 2
    dropped frames in 200), so decisions 15 and 16 survive unchanged. Expect indirect
    invocation: a strand list, a menu or palette assigning colors to samples,
    selection driven by PGB, click rather than hover — a few swaps per minute instead
    of a few per second. See
    [`notes/2026-08-13-direct-strand-interaction-is-not-viable.md`](./notes/2026-08-13-direct-strand-interaction-is-not-viable.md).

    **Reversed on the WebGL surface, 2026-08-14, by measurement.** The ~28 ms was a fact
    about DOM style invalidation, not about this problem, and the prediction that indirect
    invocation would be needed is withdrawn for that surface: feeler mode is wired to
    pointer position there and **ships on**. Track appearance is a `DataTexture` of one
    texel per track — RGB plus an emphasis byte — so lighting a strand writes one byte per
    *track*, nothing per band and nothing per already-lit track, and the frame uploads 2 KB.
    On `5520+` (464 tracks, 40,442 bands) a sweep that moves the emphasis 198 times across
    198 tracks holds a **median write of 0.000 ms and a worst of 0.100 ms in every window of
    the sweep** — flat, and under what the page timer resolves, so the honest reading is
    *below 100 µs* rather than *zero*. The worst frame while sweeping (9.4 ms) equals the
    worst frame over the identical moves with `Shift` released (9.4 ms): inside a 16.67 ms
    frame, and a third of the ~28 ms a single DOM swap cost. ~~Both surfaces keep their own
    answer: the SVG surface's feeler stays off and stays behind `?feeler`, because nothing
    about its 28 ms changed.~~ **One surface, one answer, 2026-08-16 (#40): the feeler is
    on.** Measured in
    [`notes/2026-08-14-feeler-mode-on-the-gpu.md`](./notes/2026-08-14-feeler-mode-on-the-gpu.md).

    **What did not reverse: legibility at fit.** The highlight reads unmistakably from about
    one css pixel per band upward and locates nothing at fit-to-width, where a band on
    `5520+` is 0.19 css pixels tall and 5.7 tracks share a device pixel row. That is
    `docs/DISAMBIGUATING-TRACKS.md` constraint 3, and it is a pixel budget rather than a
    performance one. A floor of ink for the emphasized band was tried against it and
    **removed**: a band emitting more ink than the document gave it is brightening the one
    rather than dimming the others, which decision #15 forbids, and it did not rescue the
    fit case anyway.
16. **Strand tooltip: raw `trackName`, unparsed.**
17. ~~**Segment tooltip (inspect mode): `id` + `sequence`, verbatim.** At ≤130 chars it
    always fits — no truncation, no detail panel.~~ Content is provisional; the
    *capability* is what's preserved.

    **Revised 2026-08-15 with the WebGL surface's own tooltip (#37): PGB's node tooltip,
    borrowed outright.** `.graph-tooltip` and `.look-tooltip` copied into
    `surfaceStyles.ts` under the same class names as
    `pgb/src/styles/_toolTipContainer.scss` and `_lookToolTip.scss`, so the two codebases
    stay greppable for each other and a later divergence is a deliberate edit. A
    researcher crosses between the two viewers constantly and a segment should not look
    like a different kind of object depending on the panel.

    Title plus two rows — `id`, `Length … bp`, `Sequence …`. **The sequence is truncated
    at 32 characters**, which the original decision did not need: ≤130 was measured on the
    600 bp fixture, and `5520+` carries a **1,764-character** segment. `.graph-tooltip`
    says `white-space: nowrap` and `.look-tooltip` caps at 300 px, and untruncated those
    two disagree by the width of the screen. The full sequence needs an affordance that
    outlives the cursor, which is a separate ticket.

    The `Length` row is not redundant with the truncation: it is the number the researcher
    is after, and it survives the cut. A fourth row for how many haplotypes traverse the
    segment is readable off the box's height and deliberately deferred.

### Testing

18. ~~**Unit-test the viewport transform module only** — pure `{x, y, scale}` math, no
    DOM. Everything else is verified by looking at it. The three silently-wrong-able
    things are fit-to-width, zoom-about-cursor drift, and navigator-rect ↔ viewport
    scale.~~ **The rule stands; the module and its tests are deleted, 2026-08-16 (#40).**
    Fit-to-width and zoom-about-cursor are `MapControls`' arithmetic now and testing them
    here would be testing three.js; the third — navigator-rect ↔ viewport — is the fourth
    seam below, and it is tested. The restatement is what to read.

    **Restated 2026-08-14, same rule, more seams.** The rule was never "one file"; it
    was *test what can be silently wrong without looking wrong, look at everything
    else*, and the WebGL surface added two more of those. `bandCamera.ts` — where a
    frustum in the wrong units gives a picture that is convincing at one window size
    and stretched at every other — and `parseBands.ts`, where a mis-numbered regex
    group yields plausible geometry and a coordinate conversion applied twice yields a
    map that is merely upside down somewhere else. Both are pure and DOM-free, as this
    decision requires. `spikeIsGone.test.ts` is not a unit test but a rule nobody would
    otherwise check.

    **And one fewer, 2026-08-16 (#40).** `viewportTransform.test.ts` went with the module
    it tested — the ADR already recorded that its unit tests do not transfer, since PGB's
    controls are the original and that module was the copy. `rejectionReasons.test.ts`,
    `parseSegmentBoxes.test.ts` and the rest are untouched. The seams that remain are the
    four named here, and every one of them is still pure and DOM-free.

    **A fourth, 2026-08-14:** the navigator's content-coordinate translation
    (`visibleContentRect` / `worldFromContentPoint`). The map is centred on the origin
    with y up and the navigator thinks in the map's own corner-origin frame, so a rect
    that tracks the view perfectly while sitting half a map height off — or that drifts
    with zoom rather than with position — is a plausible-looking widget and a wrong one.
    Pure, DOM-free, and tested in `bandCamera.test.ts`; the widget itself is judged by
    looking.

### Repo

19. **Commit the 3.4 MB sample SVG.** Reproducibility from a fresh clone beats repo
    hygiene in a spike.

## Deferred — deliberately, not overlooked

- **Telling one track from another.** Tracks running in proximity — parallel, in
  clusters — are often too close in color to separate, and sometimes share a color
  exactly (`SPEC.md` story 28). Track color is PCLAI's shipped encoding, derived for the
  PCLAI chart where *position* separates the points and color supports it; a tube map has
  no position channel to spare, so ~460 haplotypes arrive encoded in 120–150 distinct
  colors with four in five sharing one exactly. The
  strategies on the table — modifier-held emphasis with the rest receding, and depth
  cues now that the renderer is 3D — are collected in
  [`docs/DISAMBIGUATING-TRACKS.md`](./docs/DISAMBIGUATING-TRACKS.md) with the
  constraints each has to survive. Nothing is decided; the document is where proposals
  get checked before they get built.

  **First strategy built and measured, 2026-08-14: A, modifier-held emphasis with the rest
  receding** (#39, over the picking in #38). It answers the interaction half — from about
  one css pixel per band upward a single haplotype is traceable across the window against
  463 ghosts — and it does not answer the fit-to-width half, where there is no pixel in
  which emphasized and receded can differ. It also only ever says which track is *under the
  cursor*, which the document itself flags as a smaller question than the one being asked.
  So this stays deferred as a whole; one tool in it now exists.
- **`trackName` decoding.** `NA21309#2#CM092097.1` is `sample#haplotype#contig`, a
  3-part assembly-walk-shaped key addressable in PGB's vocabulary. Displayed
  verbatim in v1.
- **PCLAI metadata display.** `pclaiX`, `pclaiY`, `pclaiScore` are on every track and
  deliberately unused. Obvious future affordance: hovering a strand could locate that
  haplotype in the existing PCLAI chart panel.
- **1D↔3D correspondence.** `pgb/CLAUDE.md` treats bidirectional mapping as
  load-bearing UX. v1 ships without it. **Raised and consciously scoped out** — a
  deferred obligation, not a defect. Revisit before users see it.
- **The click-to-menu path in PGB.** PGB has no node-click event (`eventMap.ts` has
  only `lineIntersection` hover), and no menu offering the tube map. TBD in PGB.
  Note the API constraint: **a minigraph node absent from GRCh38 has no tube map** —
  don't offer the menu item for it.
## Settled by measurement, 2026-08-12

Both risks flagged for week one are answered, and both are good news.

- **CORS is open.** `https://pangenome-api.ucsd.edu:8000/seqtubemap` returns
  `access-control-allow-origin: *`, and the viewer loads the live URL from a browser
  origin with no proxy. Nothing is needed from UCSD. The non-standard port is a
  non-issue. Re-verified 2026-08-12 with preflight, error paths and parameter
  probes — full record in
  [`notes/2026-08-12-api-reachability-and-cors.md`](./notes/2026-08-12-api-reachability-and-cors.md).
  Two caveats from that pass: fetch **without** `credentials` (the wildcard origin
  is paired with `allow-credentials: true`, which browsers reject), and **error
  responses carry no CORS headers**, so a 500 reaches the client as an opaque
  network failure.
- **The frame budget holds.** Panning at maximum zoom with all 10,345 elements live
  under the CSS transform: **worst frame 9.4 ms**, sustained 120 fps (Chrome,
  M-series Mac, 1600×900). The fallback ladder stays unused; canvas stays rejected.
- **The live response matches the fixture exactly** — byte-identical on re-fetch
  2026-08-12, so the committed fixture is a faithful stand-in.
- **The "fixed" parameters are not what their names suggest.** `pathnumoption` is
  the load-bearing one and only its *presence* matters — drop it and the map falls
  from 369 tracks to 46; any value works. `version=v2` and
  `nodewidthoption=compressed` are both already the defaults, but an unrecognised
  value for either returns 500. And an unknown `minigraphnode` returns **200 with a
  valid-looking SVG** in a fallback 8-color categorical palette, with no haplotype
  greying — silent nonsense, never an error. Node eligibility must be checked in
  PGB; the API will not tell us. Detail in the note above.

## Risks

- **Every fact above comes from one minigraph node.** A larger or more variable node
  could carry far more tracks or segments. Don't over-fit to 369×75. This is now the
  only open risk.

  **Answered by measurement, 2026-08-13, and it was worse than the wording
  suggested** — the committed fixture is a **600 bp** node, and 23 of the 30 nodes in
  `data/nodeTable.json` have a larger span (median 6,364 bp, largest 72,067 bp). All
  30 were fetched (`scripts/survey_nodes.py`, results in `data/nodeSurvey.json`); 17
  returned. **"Size" was doing four jobs at once**:

  | quantity | behaviour |
  |---|---|
  | **span** | The input. Drives nothing directly. |
  | **track count** | **Invariant to span** — 464 on a 1 bp node and on a 6,440 bp node — but **varies by node**: 369, 378 and 464 all occur. It is how many haplotypes traverse *that* node. Never hard-code it; read it from the document. |
  | **segment count** | **Grows with span** — 40 → 48 → 318 → 767 — because a longer span holds more variant sites. |
  | **band count** | Follows segment count: 7,425 → 8,335 → 36,813 → 40,442. The only quantity the renderer's cost depends on. |
  | **bytes** | ~250–350 per band. Drives parse time and transport. |

  So span does not add haplotypes, but it does add bands. There is also a floor: even
  a **1 bp** node is 2.55 MB and 7,425 bands. And note that a band is a **fragment**,
  not a whole ribbon — one haplotype is drawn as a median of 28 pieces in the fixture
  and ~87 in `5520+`, so band counts are counts of shapes, not of strands.

- **43% of the catalog cannot be fetched.** 13 of 30 nodes fail: eleven HTTP 500s, two
  TLS handshake timeouts. Diagnosed 2026-08-13 — the 500 is an **unhandled application
  exception** (uvicorn's default handler, thrown at ~18 s on an otherwise healthy
  server), it is **not load** (failures reproduce cold and isolated), and it is **not
  the node** — the same `minigraphnode` succeeds with a narrower coordinate window.
  **The driver is response size, not span**: bytes-per-bp varies 3× between nodes, the
  largest success is 14.2 MB, and the ceiling is un-bracketed somewhere between ~14 and
  ~24 MB. Consequently **node eligibility cannot be gated on span** — a threshold either
  blocks nodes that work or admits nodes that crash. Full record in
  [`notes/2026-08-13-api-fetch-ceiling.md`](./notes/2026-08-13-api-fetch-ceiling.md).
  Deliberately fenced off from the renderer spike.

  **Closed out 2026-08-17 with a guardrail, not a diagnosis.** Experiment D bisected the
  window on two nodes and the byte-ceiling framing above does **not** survive it: `5511+`
  succeeds at **14.7 MB / 65.6 s** while `5508+` fails at roughly half that, its largest
  success being **8.4 MB / 20.5 s**. No single threshold in bytes *or* in seconds separates
  success from failure across both nodes, so "responses above ~14 MB crash" is wrong as
  stated. (Ignore `smallestFailurePredictedBytes` in `data/failureProbe.json` — it
  extrapolates from the densest small window and overstates by ~2×. A 500 returns no body,
  so a failure's size is not knowable from the client at all.)

  **This is not being pursued further, and that is the decision.** It is a defect in
  UCSD's service; bracketing it more precisely from outside changes nothing the viewer
  does, and the viewer's actual defect was its own — a spinner that ran for 100 s and then
  said nothing useful. So the fetch gives up at `PATIENCE_MS` (90 s, above the slowest
  measured success) and shows a `slow` failure card naming the server as the fault. Issue
  #23 stays open as UCSD's to fix, with the measurements attached. Do not reopen this as an
  investigation without a reason the viewer needs one.

- **Retired 2026-08-13: the band grammar is not a one-document artifact.**
  **127,101 of 127,101** track paths across all 17 retrieved documents conform to the
  canonical form, with thickness always 15, the control point always within the middle
  40% of the span, and no strokes, text, gradients, clip paths or filters anywhere in
  `g.track`. Consecutive pieces of a track **overlap by exactly 1.0 unit** with
  matching y at every one of 9,883 joins — the generator laps them, so there are no
  seams to hide. The grammar is confirmed only over spans of 1 bp–7,967 bp, because
  larger nodes cannot be retrieved.

## Deviations from the settled decisions

Two, both small, both deliberate:

- **Pan is clamped as well as zoom.** Decision 9 bounds only zoom (`[fit, 4×]`).
  Panning is additionally clamped so the content always covers the viewport, for the
  same reason zoom is bounded — otherwise the researcher can drag the strip off into
  empty space and lose it. Unit-tested alongside the rest of the transform math.
- **`panToNavigatorPoint` is called `panToContentPoint`.** It takes a point in
  content coordinates, and the navigator is only one of its callers.
