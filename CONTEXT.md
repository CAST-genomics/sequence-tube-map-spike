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
| **surface** | The pannable/zoomable area holding the tube-map SVG. |
| **navigator** | Thumbnail of the whole tube map, bottom-left, with a rect showing the current viewport. |
| **feeler mode** | `Shift` held. Cursor acts as a feeler: strands highlight on contact, segments inert, pan/zoom suppressed. |
| **inspect mode** | `Shift` released. Segments hoverable, strands inert, pan/zoom live. |

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
2. **`open(url: string)` is the entire input surface.** PGB constructs the URL from
   the clicked minigraph node's ID and GRCh38 coordinates; the viewer never builds
   one, never checks eligibility, and never knows whether it is local or remote. A
   dev file in `public/` is just another URL — no local/remote branch exists.
3. **No event bus in v1.** Input is one function; all correspondence wiring is
   deferred. Nothing to publish or subscribe to.
4. **`mountTubeMapSurface(container)`** renders surface + navigator into any
   container and knows nothing about panel chrome. The harness passes the full
   viewport (pure data, no chrome); PGB later passes a card body.
5. **Pure HTML / CSS / SVG / TypeScript. No Three.js.** Zero dependency overlap with
   PGB's 3D stack.

### Rendering and navigation

6. **Pan/zoom via CSS `transform`** on a wrapping div (`transform-origin: 0 0`,
   `will-change: transform`) — not `viewBox` mutation, which re-rasterizes 10k
   elements per frame. Keeps every element live for hit-testing. Canvas was rejected
   outright: it forfeits per-element hit-testing, which the whole interaction model
   depends on.
7. **Single `{x, y, scale}` state object** drives both surface and navigator, so the
   two cannot disagree.
8. **Trackpad:** `wheel` + `ctrlKey` = pinch-zoom; `wheel` alone = two-finger pan.
9. **Open fit-to-width**; clamp zoom to `[fit, 4×]`; zoom about the cursor.
10. **Resize preserves `{x, y, scale}`** and reveals more/less. Exception: re-fit if
    the view is still untouched at initial fit.
11. **Navigator is a baked bitmap** — serialize once on load, draw to canvas. Its
    affordances (drag rect, click to center) are chrome *over* the thumbnail, not
    interactions *with* strands, so live vectors buy nothing at ~90× reduction. Rect
    resizes with zoom.
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
16. **Strand tooltip: raw `trackName`, unparsed.**
17. **Segment tooltip (inspect mode): `id` + `sequence`, verbatim.** At ≤130 chars it
    always fits — no truncation, no detail panel. Content is provisional; the
    *capability* is what's preserved.

### Testing

18. **Unit-test the viewport transform module only** — pure `{x, y, scale}` math, no
    DOM. Everything else is verified by looking at it. The three silently-wrong-able
    things are fit-to-width, zoom-about-cursor drift, and navigator-rect ↔ viewport
    scale.

### Repo

19. **Commit the 3.4 MB sample SVG.** Reproducibility from a fresh clone beats repo
    hygiene in a spike.

## Deferred — deliberately, not overlooked

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

## Deviations from the settled decisions

Two, both small, both deliberate:

- **Pan is clamped as well as zoom.** Decision 9 bounds only zoom (`[fit, 4×]`).
  Panning is additionally clamped so the content always covers the viewport, for the
  same reason zoom is bounded — otherwise the researcher can drag the strip off into
  empty space and lose it. Unit-tested alongside the rest of the transform math.
- **`panToNavigatorPoint` is called `panToContentPoint`.** It takes a point in
  content coordinates, and the navigator is only one of its callers.
