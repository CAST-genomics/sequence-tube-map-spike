/**
 * The viewer's stylesheet, carried as a string so that mounting it costs the host
 * nothing but a call — no CSS import, no build-step assumption, no chance of PGB's
 * styles and these drifting apart in the bundle.
 *
 * The map is the data: no chrome inside the viewing surface. Every affordance here
 * is layered over the picture rather than arranged around it.
 */

export const SURFACE_STYLES = `
.stm-root {
    --stm-recede: 0.05;
    --stm-ink: rgb(232, 234, 238);
    --stm-ground: rgb(250, 250, 250);
    --stm-chrome: rgba(18, 20, 24, 0.82);

    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    /* The WebGL surface takes its gestures here rather than on the canvas, so the browser's
       own scroll and pinch have to be refused here too — on the canvas alone they would
       still fire for a touch that started on anything mounted over it. Redundant for the
       SVG surface, which refuses them again on .stm-surface. */
    touch-action: none;
    overscroll-behavior: none;
    background: var(--stm-ground);
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
    contain: layout paint;
}

.stm-surface {
    position: absolute;
    inset: 0;
    overflow: hidden;
    touch-action: none;
    overscroll-behavior: none;
    user-select: none;
}

.stm-content {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    will-change: transform;
}

.stm-content svg {
    display: block;
}

/* The WebGL surface. The canvas is viewport-sized at every zoom level — the oversized
   composited layer that broke the SVG surface is structurally impossible here — so it is
   simply stretched over the root. It is the root that takes the pointer, so that anything
   layered over the canvas is not a hole in pan, zoom and the feeler; the cursor stays here
   because the canvas is exactly the region the map is drawn in. */
.stm-canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    overscroll-behavior: none;
    user-select: none;
    cursor: grab;
}

.stm-canvas:active {
    cursor: grabbing;
}

/* Feeler mode on the WebGL surface: the cursor is a feeler, not a grip. There is nothing
   to make inert here — the canvas is one element and the pick pass answers with a track
   id, so the dead zones the SVG surface had to rule out cannot arise. */
.stm-root.is-feeling .stm-canvas,
.stm-root.is-feeling .stm-segment {
    cursor: crosshair;
}

/* The segment boxes (#37). One wrapper carrying the camera's transform; the boxes inside it
   are positioned in world units and never touched by a pan or a zoom.

   **No \`will-change\`.** That property is what promoted \`.stm-content\` to the composited
   layer that came apart on 2026-08-13, and the wrapper's bounds top out near 280,000 ×
   10,000 css px. It holds at most 767 rounded rects rather than a display list the size of
   the band population, which is why it is a different thing — but it is the same class of
   thing, so it is judged by looking rather than by argument.

   Inert itself, since it spans the whole map: only the boxes inside it take the cursor. */
.stm-segments {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    pointer-events: none;
}

/* Reproducing \`fill: rgb(255,255,255); fill-opacity: 0.4; stroke: rgb(0,0,0);
   stroke-width: 2px\` and quadratic corners of radius 9, which is all a segment box is.
   Width, height, position, border width and radius are all written per box from the
   document's own numbers — nothing about the size is decided here.

   Nothing is pinned to a css size: the border scales with the camera like the 15-unit bands
   do. See *What the renderer corrects, and what it leaves alone* in docs/RENDERING.md. */
.stm-segment {
    position: absolute;
    box-sizing: border-box;
    border-style: solid;
    border-color: rgb(0, 0, 0);
    background: rgba(255, 255, 255, 0.4);
    pointer-events: auto;
    /* The same grip the canvas underneath offers, because a drag starting on a box really
       does pan the map. Never \`pointer\`: nothing here is clickable yet. */
    cursor: grab;
}

.stm-segment:hover {
    background: rgba(255, 255, 255, 0.6);
}

.stm-segment:active {
    cursor: grabbing;
}

/* Below the threshold in segmentOverlay.ts, and while no document is mounted. Stated rather
   than left to the UA sheet, because \`position: absolute\` is one cascade accident away from
   outranking it. */
.stm-segment[hidden] {
    display: none;
}

/* A short transition keeps a sweep across many strands from strobing. */
.stm-content g.track > * {
    transition: opacity 120ms ease-out;
}

/* Inspect mode: segments own the cursor, strands are inert. */
.stm-root:not(.is-feeling) .stm-content g.track > * {
    pointer-events: none;
}

/* Inspect mode: the map is also a thing you take hold of and drag, as in PGB. */
.stm-root:not(.is-feeling) .stm-surface {
    cursor: grab;
}

.stm-root.is-panning .stm-surface {
    cursor: grabbing;
}

/* A drag is a grip on the whole map rather than a pointer at anything inside it,
   so nothing under the cursor is a target for its duration. Skipping the
   hit-testing says that, and spares ~10,345 elements per pointer move saying it. */
.stm-root.is-panning .stm-content {
    pointer-events: none;
}

/* Feeler mode: strands own the cursor; segment boxes cannot shadow them. */
.stm-root.is-feeling .stm-surface {
    cursor: crosshair;
}

.stm-root.is-feeling .stm-content g.node > * {
    pointer-events: none;
}

.stm-mode-badge {
    position: absolute;
    right: 12px;
    bottom: 12px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--stm-chrome);
    color: var(--stm-ink);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 10px;
    opacity: 0;
    transition: opacity 120ms ease-out;
    pointer-events: none;
}

.stm-root.is-feeling .stm-mode-badge {
    opacity: 1;
}

/* ── PGB's node tooltip, borrowed outright ────────────────────────────────────────────────

   Copied 2026-08-15 from pgb/src/styles/_toolTipContainer.scss and _lookToolTip.scss — the
   styling behind Look.createNodeTooltipContent(). Kept under the same class names so the two
   codebases stay greppable for each other and a later divergence is a deliberate edit rather
   than a drift nobody noticed. \`$licorice\` and \`$magnesium\` resolve to #000000 and #B8B8B8;
   the scss nesting is written out flat, and nothing else is changed.

   A researcher crosses between the two viewers constantly, and a segment should not look
   like a different kind of object depending on which panel it is in. */
.graph-tooltip {
    position: absolute;
    background: rgba(255, 255, 255, 0.85);
    color: #000000;
    border-radius: 4px;
    pointer-events: none;
    z-index: 1000;
    display: none;
    white-space: nowrap;
    border: 1px solid #B8B8B8;
}

.look-tooltip {
    padding: 0.5rem;
    font-size: 0.875rem;
    line-height: 1.4;
    color: #495057;
    width: fit-content;
    max-width: 300px;
}

.look-tooltip .node-section {
    margin-bottom: 1rem;
}

.look-tooltip .node-section:last-child {
    margin-bottom: 0;
}

.look-tooltip .node-section .node-title {
    margin: 0 0 0.25rem 0;
    font-size: 0.9rem;
    color: #212529;
    padding-bottom: 0.125rem;
    font-weight: 600;
}

.look-tooltip .node-section .node-details-table {
    min-width: fit-content;
    border-collapse: collapse;
    margin: 0;
}

.look-tooltip .node-detail-label {
    padding: 0.125rem 0.5rem 0.125rem 0;
    font-size: 0.8rem;
    color: #212529;
    font-weight: 500;
    text-align: left;
    vertical-align: top;
    white-space: nowrap;
}

.look-tooltip .node-detail-value {
    padding: 0.125rem 0.5rem 0.125rem 0;
    font-size: 0.8rem;
    color: #6c757d;
    text-align: left;
    vertical-align: top;
}

/* ── and what this codebase adds to it ────────────────────────────────────────────────────

   PGB positions the container itself; here it is anchored to the surface's top-left corner
   and moved with a \`transform\`, which does not invalidate layout — so a tooltip following
   the cursor cannot turn the surface's own per-move \`getBoundingClientRect\` into a forced
   reflow. \`.graph-tooltip\` ships \`display: none\`, so being shown is a class.

   PGB's \`z-index: 1000\` is overridden down to 3: it outranks the navigator, which the
   tooltip may legitimately overlap, and yields to the status layer at 4, which must be able
   to cover a refused document with nothing showing through it. The rest of the copied block
   is left exactly as it stands there.

   The font is overridden because \`.stm-root\` sets a monospace \`font\` shorthand for the
   readouts, and PGB's tooltip is not monospace. */
.graph-tooltip {
    top: 0;
    left: 0;
    z-index: 3;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}

.graph-tooltip.is-shown {
    display: block;
}

/* The SVG surface's own tooltip, which is a different thing under a different name. */
.stm-tooltip {
    position: absolute;
    top: 0;
    left: 0;
    max-width: 48ch;
    padding: 5px 9px;
    border-radius: 5px;
    background: var(--stm-chrome);
    color: var(--stm-ink);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    pointer-events: none;
    z-index: 3;
}

/* Instrumentation, not chrome: only ?pick puts this on the surface.

   Top left and below the ?fps pill, which is the one corner nothing else claims: the
   harness's URL picker fills the top right at a higher z-index and hid this completely,
   and the navigator owns the bottom left. */
.stm-pick {
    position: absolute;
    left: 12px;
    top: 46px;
    padding: 4px 10px;
    border-radius: 4px;
    background: var(--stm-chrome);
    color: var(--stm-ink);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    z-index: 3;
}

.stm-navigator {
    position: absolute;
    left: 16px;
    bottom: 16px;
    overflow: hidden;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(0, 0, 0, 0.14);
    cursor: pointer;
    touch-action: none;
    z-index: 2;
}

.stm-navigator[hidden] {
    display: none;
}

.stm-navigator.is-dragging {
    cursor: grabbing;
}

/* Baked at the size the widget had when the map loaded, and scaled from there: a resize
   re-fits the navigator without re-rendering the map into it. */
.stm-navigator-thumbnail {
    display: block;
    width: 100%;
    height: 100%;
}

/* Hit-tested, unlike most things drawn over something else. It was pointer-events: none,
   which made the rect a window through the navigator onto the map behind it: the element
   under the cursor there was the canvas, so the surface picked the track the navigator
   covers while the researcher was looking at the navigator. The drag is on the widget and
   the press bubbles to it either way, so taking events costs the gesture nothing. */
.stm-navigator-rect {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid rgba(20, 22, 26, 0.9);
    background: rgba(40, 120, 255, 0.16);
    box-shadow: 0 0 0 9999px rgba(255, 255, 255, 0.45);
}

.stm-status {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
    color: rgb(70, 74, 82);
    background: var(--stm-ground);
    z-index: 4;
}

.stm-status[hidden] {
    display: none;
}

.stm-status.is-error {
    color: rgb(150, 40, 40);
}

.stm-spinner {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid rgba(0, 0, 0, 0.14);
    border-top-color: rgba(0, 0, 0, 0.55);
    animation: stm-spin 700ms linear infinite;
}

.stm-status.is-error .stm-spinner {
    display: none;
}

@keyframes stm-spin {
    to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
    .stm-content g.track > * { transition: none; }
    .stm-spinner { animation-duration: 2s; }
}
`
