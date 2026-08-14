# Sequence Tube Map — standalone build

**Status:** design settled 2026-08-11 by grilling interview; domain language
corrected 2026-08-12. Built 2026-08-12 — every settled decision below is
implemented; see [`README.md`](./README.md) for how to run it.
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
| **surface** | The pannable/zoomable area holding the tube-map SVG. |
| **navigator** | Thumbnail of the whole tube map, bottom-left, with a rect showing the current viewport. |
| **feeler mode** | `Shift` held. Cursor acts as a feeler: strands highlight on contact, segments inert, pan/zoom suppressed. **Disabled by default** — see the note under Interaction. |
| **inspect mode** | `Shift` released, and the only mode the viewer ships in. Segments hoverable, strands inert, pan/zoom live. |

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
the difference decides whether this panel's central problem is solvable. The `RGB` field
is an encoding of the coordinate derived for **PGB's PCLAI chart**, a scatter where
position separates the points and color is a supporting cue; a tube map has no position
channel to spare. Measured across PGB's datasets (`scripts/pclai_color_collisions.py`):
~460 placed haplotypes receive 120–150 distinct colors, four in five sharing a color with
another haplotype *exactly*, and at `cici`'s busiest node two haplotypes 8% of the PCA
cloud's diameter apart get the same RGB.

So: near-identical colors *are* meaningful, and identical colors are **not** — that is
quantisation, not a claim that two haplotypes are alike. Read as written, this section
says the collisions are the signal and nothing can be done; that would be the wrong
conclusion. See
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
2. **`open(url: string)` is the entire input surface.** PGB constructs the URL from
   the clicked minigraph node's ID and GRCh38 coordinates; the viewer never builds
   one, never checks eligibility, and never knows whether it is local or remote. A
   dev file in `public/` is just another URL — no local/remote branch exists.
3. **No event bus in v1.** Input is one function; all correspondence wiring is
   deferred. Nothing to publish or subscribe to.
4. **`mountTubeMapSurface(container)`** renders surface + navigator into any
   container and knows nothing about panel chrome. The harness passes the full
   viewport (pure data, no chrome); PGB later passes a card body.

    **Extended 2026-08-14.** The signature is now
    `mountTubeMapSurface(container, { renderer })`, where `renderer` is `webgl` (the
    band renderer, the default) or `svg` (the original surface). The mount kept the
    fetch, the spinner and the error state; everything about the *view* — fit, zoom,
    what a resize does — moved into the renderer, because the two answer it in
    different vocabularies. The harness picks from `?renderer=`, so both surfaces are
    comparable on one document without a rebuild. `open(url)` is unchanged and is
    still the entire input surface.
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
    `{x, y, scale}` state object (#7) survive unchanged and now drive an
    `OrthographicCamera`; the canvas is **viewport-sized**, so the oversized-layer
    failure is structurally impossible rather than fixed. See
    [`notes/2026-08-13-svg-rendering-hits-its-ceiling.md`](./notes/2026-08-13-svg-rendering-hits-its-ceiling.md).
7. **Single `{x, y, scale}` state object** drives both surface and navigator, so the
   two cannot disagree.

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
    is ~38 px per band on `5520+`; float32 starts to show around 1000×. The SVG
    surface keeps `4×`, which is a defect of that surface and filed separately.
10. **Resize preserves `{x, y, scale}`** and reveals more/less. Exception: re-fit if
    the view is still untouched at initial fit.
11. **Navigator is a baked bitmap** — serialize once on load, draw to canvas. Its
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

    The segment boxes and highlighting remain SVG-surface-only.
12. **Load with `DOMParser`, not `innerHTML`** — strip all `<title>` elements before
    attaching. Spinner in the body until ready.

### Interaction

13. **`Shift` arbitrates pointer ownership**, making the two interaction sets
    mutually exclusive by construction rather than by hit-test arbitration:
    - **held (feeler mode):** `g.node > * { pointer-events: none }`; strands own the
      cursor; no dead zones; pan/zoom suppressed; cursor `crosshair` so the mode is
      visible rather than remembered.
    - **released (inspect mode):** segments hoverable; strand highlights cleared.
14. **Highlighting is deliberate, not incidental.** Hover alone does nothing. With
    `Shift` held, strands touched by the cursor highlight and **accumulate**;
    releasing clears all. The cursor as a feeler, making near-identical ribbons feel
    palpable and tactile.
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
    rate. Feeler mode is therefore **off by default** (`strandFeeler`, `?feeler` in
    the harness), kept whole rather than deleted.

    **The appearance vocabulary is not abandoned — its invocation is.** A highlight
    already standing costs **nothing** to pan and zoom under (8.3 ms median, 2
    dropped frames in 200), so decisions 15 and 16 survive unchanged. Expect indirect
    invocation: a strand list, a menu or palette assigning colors to samples,
    selection driven by PGB, click rather than hover — a few swaps per minute instead
    of a few per second. See
    [`notes/2026-08-13-direct-strand-interaction-is-not-viable.md`](./notes/2026-08-13-direct-strand-interaction-is-not-viable.md).
16. **Strand tooltip: raw `trackName`, unparsed.**
17. **Segment tooltip (inspect mode): `id` + `sequence`, verbatim.** At ≤130 chars it
    always fits — no truncation, no detail panel. Content is provisional; the
    *capability* is what's preserved.

### Testing

18. **Unit-test the viewport transform module only** — pure `{x, y, scale}` math, no
    DOM. Everything else is verified by looking at it. The three silently-wrong-able
    things are fit-to-width, zoom-about-cursor drift, and navigator-rect ↔ viewport
    scale.

    **Restated 2026-08-14, same rule, more seams.** The rule was never "one file"; it
    was *test what can be silently wrong without looking wrong, look at everything
    else*, and the WebGL surface added two more of those. `bandCamera.ts` — where a
    frustum in the wrong units gives a picture that is convincing at one window size
    and stretched at every other — and `parseBands.ts`, where a mis-numbered regex
    group yields plausible geometry and a coordinate conversion applied twice yields a
    map that is merely upside down somewhere else. Both are pure and DOM-free, as this
    decision requires. `spikeIsGone.test.ts` is not a unit test but a rule nobody would
    otherwise check.

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

- **Telling one track from another.** The sequence tube map's central problem
  (`SPEC.md` story 28), and one it inherits: track color is PCLAI's shipped encoding,
  derived for the PCLAI chart where *position* separates the points and color is a
  supporting cue. Here there is no position channel to spare, so ~460 haplotypes arrive
  encoded in 120–150 distinct colors with four in five sharing one exactly. The
  strategies on the table — modifier-held emphasis with the rest receding, and depth
  cues now that the renderer is 3D — are collected in
  [`docs/DISAMBIGUATING-TRACKS.md`](./docs/DISAMBIGUATING-TRACKS.md) with the
  constraints each has to survive. Nothing is decided; the document is where proposals
  get checked before they get built.
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
