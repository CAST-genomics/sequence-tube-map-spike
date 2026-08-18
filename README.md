# Sequence Tube Map — standalone viewer

A magnifying glass on a single minigraph node. PGB renders the pangenome graph in
3D; each node is a collapsed summary of a stretch of sequence hundreds of haplotypes
traverse. This viewer shows the interior — the minigraph-cactus subgraph at
base-level resolution, where the variation actually lives.

Design: [`CONTEXT.md`](./CONTEXT.md) (read the Vocabulary section first — "node"
means two different things at two scales). Requirements: [`SPEC.md`](./SPEC.md).

## This viewer has shipped. It ships from PGB, not from here

**2026-08-18.** The viewer was migrated into PGB and is now reachable there: right-click a
node in the 3D graph and pick *Sequence Tube Map*. Two copies of it exist, and the one that
ships is PGB's.

| | where |
|---|---|
| the shipping code | [`pgb/src/tubemap/`](https://github.com/CAST-genomics/pgb/tree/main/src/tubemap) |
| why it is a panel and not a Look | [`pgb/docs/adr/0001`](https://github.com/CAST-genomics/pgb/blob/main/docs/adr/0001-sequence-tube-map-panel.md) |
| why the band renderer, and what was given up | [`pgb/docs/adr/0002`](https://github.com/CAST-genomics/pgb/blob/main/docs/adr/0002-webgl-band-renderer.md) |
| how the migration went | [`pgb#85`](https://github.com/CAST-genomics/pgb/issues/85), landed in [`pgb#99`](https://github.com/CAST-genomics/pgb/pull/99) |

**This repo is not archived, and is not a snapshot of what shipped.** It is the laboratory:
the place to try visualization metaphors and affordances for making tube map data more
tractable, where an idea can be built on a standalone surface without owing anything to
PGB's release. The traffic is one-way — an idea that earns its place arrives in PGB as a
change to `src/tubemap/`, never as a second implementation to reconcile, and `src/tubemap/`
is never re-synchronised wholesale from here.

So expect the two to diverge, and expect this one to be ahead in ideas and behind in
correctness. Six defects were fixed in PGB during the migration's last step that are still
live here, four of them the assumption that every tube map is a wide strip: `fitZoom` fits
the width rather than the map, the navigator's thumbnail has no height ceiling, the segment
box parser compares coordinates exactly where the server spells one edge two ways, and
`Shift` arms feeler mode from anywhere on the page. Worth porting if an experiment here runs
into them; [`pgb#99`](https://github.com/CAST-genomics/pgb/pull/99) has each one.

The four open questions this repo keeps — strand disambiguation (#32, #50), hollow unscored
strands (#48), the slow-server spinner (#58) — stayed here rather than moving to PGB, for
the same reason: they are the laboratory's subject.

```
npm install
npm run dev        # http://localhost:5173
npm test           # parsers, camera math, refusal reasons
npm run typecheck
```

## Harness

`index.html` is a bare full-viewport container plus a picker: a node selector, a URL
field, and Open. Three query parameters:

- `?url=…` — open a different tube map. Defaults to the committed fixture.
- `?fps=1` — frame meter, top left. Click it to reset the worst-frame figure.
- `?pick` — read the pick pass and the feeler out loud: the strand under the cursor, what
  the pick cost, which strand is emphasized, and what the last and worst appearance-table
  writes cost. Instrumentation; feeler mode runs without it.

`?renderer=` and `?feeler` are gone as of 2026-08-16 (#40): there is one surface, and its
feeler is always on.

The selector lists the committed fixture and every minigraph node of a PGB dataset
that GRCh38 places — 30 of `cici.json`'s 45 — in chromosome order. Picking one fills
the URL field and opens it live, so the field always shows what is on screen and
stays editable by hand. The 15 nodes GRCh38 doesn't place have no tube map and are
deliberately absent: the API answers for an unknown node with a plausible-looking map
rather than an error, so not offering them is the only defence.

The list is `data/nodeTable.json`, generated from a PGB dataset — the same derivation
PGB will do at click time, done once ahead of time:

```
python3 scripts/build_node_table.py path/to/pgb/public/datasets/api-v3/cici.json
```

Every URL is also reachable by hand — the live endpoint works directly:

```
http://localhost:5173/?url=https%3A%2F%2Fpangenome-api.ucsd.edu%3A8000%2Fseqtubemap%3Fchrom%3Dchr1%26start%3D25331046%26end%3D25331646%26version%3Dv2%26pathnumoption%3Dnormal%26nodewidthoption%3Dcompressed%26minigraphnode%3D5519
```

## One surface

The map is drawn by the **WebGL band renderer**, and there is nothing else to select. It
reads the response as six floats per band by regex, draws the lot in one instanced call
with analytic coverage, steers with PGB's `MapControls` from fit to 200×, and refuses a
document off the band grammar loudly rather than drawing part of it.

It was one of two until 2026-08-16 (#40). The original **SVG surface** attached the
server's document live and panned it with a CSS transform, and it has a ceiling it reaches
on every document larger than the 600 bp fixture: its composited layer is 900 megapixels
at dpr 2, its hover restyle costs ~28 ms across ~10,000 elements, and its 4× zoom cap
leaves a haplotype 0.77 css px tall on `5520+`. The verdict that settled this, with the
measurements, is
[`notes/2026-08-14-three-js-renderer-verdict.md`](./notes/2026-08-14-three-js-renderer-verdict.md);
how a band is drawn is [`docs/RENDERING.md`](./docs/RENDERING.md).

Strands running in proximity are often too close in color to tell apart, and sometimes
share a color exactly. Strand color is PCLAI's shipped encoding of a PCA coordinate,
derived for the PCLAI chart — where position separates the points and color supports it —
and a tube map has no position channel to spare. The strategies for adding back a channel
the chart did not need are collected in
[`docs/DISAMBIGUATING-STRANDS.md`](./docs/DISAMBIGUATING-STRANDS.md).

**Nothing falls back.** A document the band grammar rejects gets a named error state and
stops there. That was already the behaviour before the surface was deleted — nothing was
ever silently swapped in, because a researcher who cannot tell which renderer drew what
they are looking at is worse off than one who gets told the document could not be drawn.
A refusal is something to deal with when it occurs, from the document that caused it.

Deleting the surface makes that irreversible, and it costs something: if UCSD's drawing
grammar changes, there is now no way to look at an affected document at all. ADR
[`0001`](./docs/adr/0001-webgl-band-renderer.md) records that plainly as a reduction in
safety, along with the three reasons it is still the right trade — chiefly that a fallback
reachable only by guessing a query parameter is not one, and that the surface behind it
carries both of the failures that produced this renderer. `CONTEXT.md` decision #1 has the
short version.

## Using it

Drag with the primary button to pan; a Magic Mouse swipe, a mouse wheel, or a
trackpad pinch zooms about the cursor. The navigator, bottom left, shows the whole
map with a rect around what is on screen: drag the rect to travel, press anywhere
else to centre that point.

Hovering a segment box shows the segment's id, its length in bases and its sequence, with
no key held. The boxes are HTML divs over the canvas — translucent, black-stroked, rounded
exactly as the document draws them — under one wrapper carrying the camera's transform, so
a pan is one string rather than 767 style writes. They take pointer events and own hover,
but pan, zoom and the strand feeler all reach the map through them: a drag that starts on a
box pans, and a wheel aimed at one zooms into it. Holding `Shift` *adds* the strand
emphasis without taking the tooltip away.

A box is withheld until it is about 1.5 css pixels wide on screen, per box. At fit on
`5514+` an 18-unit box is 0.14 px, and 767 of those are a picket fence over the map rather
than a set of segments; closing the camera hands them back largest-first. Nothing else
about them is corrected — the 2-unit stroke and the radius-9 corners scale with the camera
like the bands do. `node scripts/verify_segment_boxes.mjs` runs the lot against `5514+` at
200× and leaves the screenshots in `/tmp`.

The navigator's thumbnail is drawn from the surface's own scene — one render into a
render target at thumbnail size, read back once per document, so the picture in the
corner cannot disagree with the picture on screen.
It is 720 px wide at most, which is 51 px tall on `5520+` and 26 px on `5514+`;
360 px was tried first and leaves `5514+` a 13 px hairline
([`notes/2026-08-14-navigator-thumbnail-aspect.md`](./notes/2026-08-14-navigator-thumbnail-aspect.md)).

Pan and zoom are PGB's, gesture for gesture — the surface *is* three.js `MapControls`
with PGB's configuration verbatim, so a notch travels the same distance in both viewers.
The hand-written copy of PGB's controls factory that the SVG surface needed is gone with
it (#40).

### Feeler mode

Hold `Shift` and the cursor becomes a feeler. The map recedes on the key alone, the strand
under the cursor is drawn as the document drew it, moving the cursor hands the emphasis to
the next strand, and releasing brings the whole map back. Hover alone does nothing —
highlighting is deliberate rather than incidental. Pan and zoom are suppressed while the
key is held, because a strand that slides out from under the cursor cannot be felt.

**The emphasis follows the cursor rather than accumulating**, decided 2026-08-14 after
looking at the alternative: touches that pile up leave a widening trail of lit strands
behind a sweep, and the strand being pointed at ends up as one of dozens at full colour,
which is the opposite of telling it apart. A comparison set of several haplotypes is still
wanted and needs a deliberate gesture instead; the appearance table already supports one.

It is **always on**, with no flag. The same interaction was built on the SVG surface and
shipped switched off, because there each swap invalidated style across ~10,000 elements at
~28 ms, real maps tore, and no tuning reached it
([`notes/2026-08-13-direct-strand-interaction-is-not-viable.md`](./notes/2026-08-13-direct-strand-interaction-is-not-viable.md));
that surface and its `?feeler` flag were deleted 2026-08-16 (#40).

Here strand appearance is a `DataTexture` of one texel per strand — RGB plus an emphasis
byte — so moving the emphasis writes one byte per *strand*, nothing per band, and the frame
uploads 2 KB. On `5520+`, 464 strands and 40,442 bands, a sweep that
moves it 198 times across 198 strands holds a median write of 0.000 ms and a worst of
0.100 ms in every window of the sweep — flat, and under what the page timer resolves, so
read it as *below 100 µs*. The worst frame while sweeping is 9.4 ms, the same as the worst
frame over the identical moves with the key released: inside a 16.67 ms frame, and a third
of the ~28 ms a single DOM swap cost.

What it does not do is work at fit-to-width, where a band on `5520+` is 0.19 css pixels
tall and 5.7 strands share a device pixel row: there is no pixel in which emphasized and
receded can differ. It reads unmistakably from about one css pixel per band upward. That is
a pixel budget rather than a performance one, and
[`docs/DISAMBIGUATING-STRANDS.md`](./docs/DISAMBIGUATING-STRANDS.md) is where the candidates
for the other regime are weighed.

Measurements, screenshots and the choices behind the treatment:
[`notes/2026-08-14-feeler-mode-on-the-gpu.md`](./notes/2026-08-14-feeler-mode-on-the-gpu.md).
Rerun them with `npm run dev` up:

```
node scripts/verify_highlight.mjs '<url>'
```

## Shape of the code

`mountTubeMapSurface(container, options?)` is the only public entry point. It
returns `{ open(url), destroy() }` — `open` is the entire input surface, and the only
option left is `pickReadout`, which is harness instrumentation. The host builds the
URL and decides eligibility; the viewer never builds one, never inspects one, and
never learns whether it is local or remote.

The mount owns the fetch, the spinner and the error state. It owns nothing about the
view: fitting, zooming and what a resize does to the framing are behind the four calls of
`BandSurface`. That seam was where two surfaces met; it survives one, because what it
really keeps apart is the fetch and the camera.

| File | Holds |
|---|---|
| `src/tubeMapSurface.ts` | the entry point; the fetch, the load lifecycle, the error state |
| `src/bandSurface.ts` | the surface: one instanced draw call, `MapControls`, the shaders, and `BandSurface` — `show(text)`, `clear`, `resize`, `destroy` |
| `src/parseBands.ts` | `g.track` as six floats per band; rejects anything off-grammar |
| `src/parseSegmentBoxes.ts` | `g.node` as rounded rectangles; rejects anything off-grammar |
| `src/segmentOverlay.ts` | the segment boxes as HTML divs, and the tooltip naming the one under the cursor |
| `src/documentGrammar.ts` | what both parsers share about refusing a document |
| `src/bandCamera.ts` | the camera's framing, and the navigator's content coordinates — pure, DOM-free, tested |
| `src/geometry.ts` | `Point`, `Size`, `Rect`, `clamp` — the vocabulary the rest of it measures in |
| `src/navigator.ts` | the navigator's chrome: viewport rect, drag and press-to-jump. The surface paints the thumbnail |
| `src/bandPicker.ts`, `src/strandAppearance.ts`, `src/feelerKey.ts` | which strand is under the cursor, how each one looks, and what `Shift` means |
| `src/fetchDocument.ts` | the fetch, and the failures worth naming |
| `src/loadFailure.ts` | which of the four failures happened, in words a researcher can act on |
| `src/surfaceStyles.ts` | the viewer's stylesheet, as a string so the host imports no CSS |
| `src/main.ts`, `src/frameMeter.ts` | harness only — PGB replaces both |

The tested seams are the ones that can be silently wrong without looking wrong: the
camera math, both parsers — where a mis-numbered regex group yields
plausible geometry — and the segment overlay's visibility threshold, which is
incremental across frames and so is a claim about something stateful. Everything else is verified by looking at it, for the reasons
`SPEC.md` §Testing Decisions gives.

Both week-one risks — CORS and the frame budget — are measured and closed;
`CONTEXT.md` §"Settled by measurement" has the numbers, and records the two small
deviations from the settled decisions.
