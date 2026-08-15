# Sequence Tube Map — standalone viewer

A magnifying glass on a single minigraph node. PGB renders the pangenome graph in
3D; each node is a collapsed summary of a stretch of sequence hundreds of haplotypes
traverse. This viewer shows the interior — the minigraph-cactus subgraph at
base-level resolution, where the variation actually lives.

Design: [`CONTEXT.md`](./CONTEXT.md) (read the Vocabulary section first — "node"
means two different things at two scales). Requirements: [`SPEC.md`](./SPEC.md).

```
npm install
npm run dev        # http://localhost:5173
npm test           # viewport transform math
npm run typecheck
```

## Harness

`index.html` is a bare full-viewport container plus a picker: a renderer selector, a
node selector, a URL field, and Open. Three query parameters:

- `?renderer=webgl|svg` — which surface draws the map. Defaults to `webgl`. The
  selector sets it by reloading, so the two surfaces can be compared on the same
  document in the same session, and which one is running is readable off the address
  bar rather than off the page's memory.
- `?url=…` — open a different tube map. Defaults to the committed fixture.
- `?fps=1` — frame meter, top left. Click it to reset the worst-frame figure.
- `?pick` — on the WebGL surface, read the pick pass and the feeler out loud: the track
  under the cursor, what the pick cost, which track is emphasized, and what the last and
  worst appearance-table writes cost. Instrumentation; feeler mode runs without it.

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

## Two surfaces

The map is drawn either by the **WebGL band renderer** or by the original **SVG
surface**. They are the same viewer — same entry point, same `open(url)`, same
loading and error states — differing only in what happens to the bytes after they
arrive.

| | WebGL (default) | SVG |
|---|---|---|
| Reads the document as | six floats per band, by regex | a live DOM tree |
| Draws with | one instanced draw call | ~10,345 elements under a CSS transform |
| Zoom range | fit – 200× | fit – 4× |
| Has | analytic coverage, PGB's `MapControls`, feeler mode | per-element hit-testing |
| Refuses | a document off the band grammar, loudly | nothing |

WebGL is the default because the SVG surface has a ceiling and reaches it on every
document larger than the 600 bp fixture: its composited layer is 900 megapixels at
dpr 2, and its 4× zoom cap leaves a haplotype 0.77 css px tall on `5520+`. The
verdict that settled this, with the measurements, is
[`notes/2026-08-14-three-js-renderer-verdict.md`](./notes/2026-08-14-three-js-renderer-verdict.md);
how a band is drawn is [`docs/RENDERING.md`](./docs/RENDERING.md).

Tracks running in proximity are often too close in color to tell apart, and sometimes
share a color exactly. Track color is PCLAI's shipped encoding of a PCA coordinate,
derived for the PCLAI chart — where position separates the points and color supports it —
and a tube map has no position channel to spare. The strategies for adding back a channel
the chart did not need are collected in
[`docs/DISAMBIGUATING-TRACKS.md`](./docs/DISAMBIGUATING-TRACKS.md).

**The SVG surface is not a fallback.** A document the band grammar rejects gets a named
error state and stops there; nothing is silently swapped in behind it, because a
researcher who cannot tell which renderer drew what they are looking at is worse off
than one who gets told the document could not be drawn. A refusal is something to deal
with when it occurs, from the document that caused it. Decided 2026-08-14 — `CONTEXT.md`
decision #1 and ADR `0001` carry the reasoning.

What the SVG surface is, for now: the only surface with per-element hit-testing, and a
comparison arm reachable by hand at `?renderer=svg`.

## Using it

Drag with the primary button to pan; a Magic Mouse swipe, a mouse wheel, or a
trackpad pinch zooms about the cursor. The navigator, bottom left, shows the whole
map with a rect around what is on screen: drag the rect to travel, press anywhere
else to centre that point. Both surfaces have it.

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

The navigator's thumbnail is drawn from the surface's own scene: on the WebGL
surface, one render into a render target at thumbnail size, read back once per
document, so the picture in the corner cannot disagree with the picture on screen.
It is 720 px wide at most, which is 51 px tall on `5520+` and 26 px on `5514+`;
360 px was tried first and leaves `5514+` a 13 px hairline
([`notes/2026-08-14-navigator-thumbnail-aspect.md`](./notes/2026-08-14-navigator-thumbnail-aspect.md)).

Pan and zoom are PGB's, gesture for gesture. The WebGL surface *is* three.js
`MapControls` with PGB's configuration verbatim; the SVG surface matches it by hand
at PGB's `zoomSpeed`, so a notch travels the same distance in all three.

### Feeler mode

Hold `Shift` and the cursor becomes a feeler. The map recedes on the key alone, the track
under the cursor is drawn as the document drew it, moving the cursor hands the emphasis to
the next track, and releasing brings the whole map back. Hover alone does nothing —
highlighting is deliberate rather than incidental. Pan and zoom are suppressed while the
key is held, because a strand that slides out from under the cursor cannot be felt.

**The emphasis follows the cursor rather than accumulating**, decided 2026-08-14 after
looking at the alternative: touches that pile up leave a widening trail of lit strands
behind a sweep, and the strand being pointed at ends up as one of dozens at full colour,
which is the opposite of telling it apart. A comparison set of several haplotypes is still
wanted and needs a deliberate gesture instead; the appearance table already supports one.
The SVG surface's feeler, which is off, still accumulates.

It is **on, on the WebGL surface, and off on the SVG surface** — the same interaction with
two different costs behind it. On the SVG surface each swap invalidates style across
~10,000 elements at ~28 ms, real maps tear, and that is not fixable by tuning; it stays
behind `?feeler` there
([`notes/2026-08-13-direct-strand-interaction-is-not-viable.md`](./notes/2026-08-13-direct-strand-interaction-is-not-viable.md)):

```
http://localhost:5173/?renderer=svg&feeler
```

On the WebGL surface, track appearance is a `DataTexture` of one texel per track — RGB
plus an emphasis byte — so moving the emphasis writes one byte per *track*, nothing per
band, and the frame uploads 2 KB. On `5520+`, 464 tracks and 40,442 bands, a sweep that
moves it 198 times across 198 tracks holds a median write of 0.000 ms and a worst of
0.100 ms in every window of the sweep — flat, and under what the page timer resolves, so
read it as *below 100 µs*. The worst frame while sweeping is 9.4 ms, the same as the worst
frame over the identical moves with the key released: inside a 16.67 ms frame, and a third
of the ~28 ms a single DOM swap cost.

What it does not do is work at fit-to-width, where a band on `5520+` is 0.19 css pixels
tall and 5.7 tracks share a device pixel row: there is no pixel in which emphasized and
receded can differ. It reads unmistakably from about one css pixel per band upward. That is
a pixel budget rather than a performance one, and
[`docs/DISAMBIGUATING-TRACKS.md`](./docs/DISAMBIGUATING-TRACKS.md) is where the candidates
for the other regime are weighed.

Measurements, screenshots and the choices behind the treatment:
[`notes/2026-08-14-feeler-mode-on-the-gpu.md`](./notes/2026-08-14-feeler-mode-on-the-gpu.md).
Rerun them with `npm run dev` up:

```
node scripts/verify_highlight.mjs '<url>'
```

## Shape of the code

`mountTubeMapSurface(container, options?)` is the only public entry point. It
returns `{ open(url), destroy() }` — `open` is the entire input surface, and the
options are `renderer` and `strandFeeler`. The host builds the
URL and decides eligibility; the viewer never builds one, never inspects one, and
never learns whether it is local or remote.

The mount owns the fetch, the spinner and the error state. It owns nothing about the
view: fitting, zooming and what a resize does to the framing belong to the renderer,
because the two answer those in different vocabularies.

| File | Holds |
|---|---|
| `src/tubeMapSurface.ts` | the entry point; the fetch, the load lifecycle, the renderer choice |
| `src/surfaceRenderer.ts` | what a renderer is — `show(text)`, `clear`, `resize`, `destroy` |
| `src/bandSurface.ts` | the WebGL surface: one instanced draw call, `MapControls`, the shaders |
| `src/parseBands.ts` | `g.track` as six floats per band; rejects anything off-grammar |
| `src/parseSegmentBoxes.ts` | `g.node` as rounded rectangles; rejects anything off-grammar |
| `src/segmentOverlay.ts` | the segment boxes as HTML divs, and the tooltip naming the one under the cursor |
| `src/documentGrammar.ts` | what both parsers share about refusing a document |
| `src/bandCamera.ts` | the WebGL camera's framing, and the navigator's content coordinates — pure, DOM-free, tested |
| `src/svgSurface.ts` | the SVG surface: `{x, y, scale}`, the interactions, the SVG thumbnail bake |
| `src/viewportTransform.ts` | the SVG surface's transform math, and the geometry vocabulary both surfaces speak — pure, DOM-free, tested |
| `src/navigator.ts` | the navigator's chrome: viewport rect, drag and press-to-jump. Each surface paints its own thumbnail |
| `src/interaction.ts` | modes, highlight rule, tooltips, drag-pan and wheel-zoom |
| `src/fetchDocument.ts` | the fetch, and the failures worth naming |
| `src/svgDocument.ts` | parse, strip `<title>`, measure the viewBox |
| `src/surfaceStyles.ts` | the viewer's stylesheet, as a string so the host imports no CSS |
| `src/main.ts`, `src/frameMeter.ts` | harness only — PGB replaces both |

The tested seams are the ones that can be silently wrong without looking wrong: the
two lots of camera math, both parsers — where a mis-numbered regex group yields plausible
geometry — and the segment overlay's visibility threshold, which is incremental across
frames and so is a claim about something stateful. Everything else is verified by looking at it, for the reasons
`SPEC.md` §Testing Decisions gives.

Both week-one risks — CORS and the frame budget — are measured and closed;
`CONTEXT.md` §"Settled by measurement" has the numbers, and records the two small
deviations from the settled decisions.
