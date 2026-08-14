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
| Has | analytic coverage, PGB's `MapControls` | segment tooltips, the navigator, feeler mode |
| Refuses | a document off the band grammar, loudly | nothing |

WebGL is the default because the SVG surface has a ceiling and reaches it on every
document larger than the 600 bp fixture: its composited layer is 900 megapixels at
dpr 2, and its 4× zoom cap leaves a haplotype 0.77 css px tall on `5520+`. The
verdict that settled this, with the measurements, is
[`notes/2026-08-14-three-js-renderer-verdict.md`](./notes/2026-08-14-three-js-renderer-verdict.md);
how a band is drawn is [`docs/RENDERING.md`](./docs/RENDERING.md).

The SVG surface stays because it is the only one with per-element hit-testing, and
because a document the band grammar rejects can still be looked at there.

## Using it

Drag with the primary button to pan; a Magic Mouse swipe, a mouse wheel, or a
trackpad pinch zooms about the cursor. On the SVG surface, hovering a segment box
shows its id and sequence, and the navigator, bottom left, can be clicked to jump or
dragged to travel — the segment boxes, the navigator and highlighting are all still
to come on the WebGL surface, and will arrive as geometry rather than as a DOM
overlay and a baked bitmap.

Pan and zoom are PGB's, gesture for gesture. The WebGL surface *is* three.js
`MapControls` with PGB's configuration verbatim; the SVG surface matches it by hand
at PGB's `zoomSpeed`, so a notch travels the same distance in all three.

### Feeler mode is off

Holding `Shift` was meant to turn the cursor into a probe — strands highlighting on
contact and accumulating, releasing clearing them all. It is **disabled by default**,
because a real map tears and renders partially under it: restyling the ~10,000 track
elements costs ~28 ms, and a sweep asks for that several times a second.

The finding generalizes past this one feature: **changing how the strands look, in
real time, from pointer position is not going to perform** — highlighting,
de-emphasis, or anything else that restyles the ribbons live. The wall is the
coupling of appearance change to pointer rate, and no constant fixes it.

What that does *not* mean is that the ideas are abandoned. Every one of them
survives; only the way they get invoked changes, from direct to indirect — a strand
list, a menu, a palette assigning colors to samples, selection driven by the host, a
click instead of a hover. A highlight already standing was measured to cost nothing
to pan and zoom under, so the budget is roughly 28 ms per user decision rather than
per pointer move. Plenty of room, and plenty of ways to spend it.

The mechanism is intact behind `strandFeeler`, and the harness re-arms it with
`?feeler` for judging it against smaller maps or a cheaper highlight:

```
http://localhost:5173/?feeler
```

Full observation, measurements and reasoning:
[`notes/2026-08-13-direct-strand-interaction-is-not-viable.md`](./notes/2026-08-13-direct-strand-interaction-is-not-viable.md).

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
| `src/parseBands.ts` | the document as six floats per band; rejects anything off-grammar |
| `src/bandCamera.ts` | the WebGL camera's framing — pure, DOM-free, tested |
| `src/svgSurface.ts` | the SVG surface: `{x, y, scale}`, the navigator, the interactions |
| `src/viewportTransform.ts` | the SVG surface's transform math — pure, DOM-free, tested |
| `src/navigator.ts` | baked thumbnail, viewport rect, drag and click-to-jump |
| `src/interaction.ts` | modes, highlight rule, tooltips, drag-pan and wheel-zoom |
| `src/fetchDocument.ts` | the fetch, and the failures worth naming |
| `src/svgDocument.ts` | parse, strip `<title>`, measure the viewBox |
| `src/surfaceStyles.ts` | the viewer's stylesheet, as a string so the host imports no CSS |
| `src/main.ts`, `src/frameMeter.ts` | harness only — PGB replaces both |

The tested seams are the ones that can be silently wrong without looking wrong: the
two lots of camera math, and the band parser, where a mis-numbered regex group yields
plausible geometry. Everything else is verified by looking at it, for the reasons
`SPEC.md` §Testing Decisions gives.

Both week-one risks — CORS and the frame budget — are measured and closed;
`CONTEXT.md` §"Settled by measurement" has the numbers, and records the two small
deviations from the settled decisions.
