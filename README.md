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

`index.html` is a bare full-viewport container plus a picker: a node selector, a URL
field, and Open. Two query parameters:

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

## Using it

Drag with the primary button to pan; a Magic Mouse swipe, a mouse wheel, or a
trackpad pinch zooms about the cursor. Hovering a segment box shows its id and
sequence. The navigator, bottom left, can be clicked to jump or dragged to travel.

Pan and zoom are PGB's, gesture for gesture: the browser drives three.js
`MapControls`, and this matches it at PGB's `zoomSpeed`, so a notch travels the same
distance in both.

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
returns `{ open(url), destroy() }` — `open` is the entire input surface, and the one
option is `strandFeeler`. The host builds the
URL and decides eligibility; the viewer never builds one, never inspects one, and
never learns whether it is local or remote.

| File | Holds |
|---|---|
| `src/tubeMapSurface.ts` | the entry point; owns `{x, y, scale}` and the load lifecycle |
| `src/viewportTransform.ts` | all transform math — pure, DOM-free, the one tested seam |
| `src/navigator.ts` | baked thumbnail, viewport rect, drag and click-to-jump |
| `src/interaction.ts` | modes, highlight rule, tooltips, drag-pan and wheel-zoom |
| `src/loadTubeMap.ts` | fetch, parse, strip `<title>`, measure the viewBox |
| `src/surfaceStyles.ts` | the viewer's stylesheet, as a string so the host imports no CSS |
| `src/main.ts`, `src/frameMeter.ts` | harness only — PGB replaces both |

The transform module is the only unit-tested seam, for the reasons `SPEC.md`
§Testing Decisions gives. Everything else is verified by looking at it.

Both week-one risks — CORS and the frame budget — are measured and closed;
`CONTEXT.md` §"Settled by measurement" has the numbers, and records the two small
deviations from the settled decisions.
