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
    --stm-ink: rgb(232, 234, 238);
    --stm-ground: rgb(250, 250, 250);
    --stm-chrome: rgba(18, 20, 24, 0.82);

    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    /* The surface takes its gestures here rather than on the canvas, so the browser's own
       scroll and pinch have to be refused here too — on the canvas alone they would still
       fire for a touch that started on anything mounted over it. */
    touch-action: none;
    overscroll-behavior: none;
    /* And the browser's text selection, for the same reason and one level higher up.
       .stm-canvas refuses it too, but a drag anchors a *range*, and a range spans
       whatever lies between its ends — so a pan that crossed the segment
       tooltip left it highlighted in blue, and left it that way, even though the tooltip
       is pointer-events: none and was never the drag's target. The map is a picture and
       the readouts over it are labels on that picture; none of it is a document. */
    user-select: none;
    background: var(--stm-ground);
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
    contain: layout paint;
}

/* The one exception: the error state names a URL and says what went wrong with it, which
   is the one thing here worth copying out. */
.stm-status {
    user-select: text;
}

/* The canvas is viewport-sized at every zoom level — the oversized composited layer that
   broke the SVG surface is structurally impossible here — so it is simply stretched over
   the root. It is the root that takes the pointer, so that anything layered over the canvas
   is not a hole in pan, zoom and the feeler; the cursor stays here because the canvas is
   exactly the region the map is drawn in. */
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

/* A pan in progress, and the one rule that says so.

   Written on the root and on everything the pointer can be over, rather than as \`:active\`
   on each: \`MapControls\` takes pointer capture on the root when a drag begins, and a
   captured pointer stops hit-testing for \`:hover\` and \`:active\` — the capture target takes
   them instead. \`.stm-canvas:active\` therefore stopped matching the instant the drag it
   was describing actually began, and the root, which had no cursor of its own, fell back to
   the arrow: pressing showed the grabbing hand and moving took it away.

   The root is listed first because it is the element the capture makes current; the others
   because \`cursor\` inherits, and a plain rule on a descendant outranks an inherited value.
   \`bandSurface.ts\` puts the class on, for the primary button only and never while
   feeling. */
.stm-root.is-panning,
.stm-root.is-panning .stm-canvas,
.stm-root.is-panning .stm-segment {
    cursor: grabbing;
}

/* Feeler mode: the cursor is a feeler, not a grip — so it is a pointing finger.

   All three states are one hand in three poses: open to take hold, closed while holding,
   and a finger out while feeling. The crosshair this replaced (2026-08-16) was an
   instrument reticle in a set of hands, and it promised two-axis precision the interaction
   does not have — a feeler is swept, and only its vertical position selects anything.

   \`pointer\` conventionally means clickable, and nothing here is. That is a real cost and
   it is accepted: the finger matches what the mode *is* — CONTEXT.md #14 calls the cursor a
   feeler, making near-identical ribbons palpable — and while the key is held there is
   nothing to click anywhere, since the controls are off. Worth revisiting when clicking a
   segment becomes real, which is a different mode with no key held.

   There is nothing to make inert here — the canvas is one element and the pick pass answers
   with a strand id, so the dead zones the SVG surface had to rule out cannot arise. */
.stm-root.is-feeling .stm-canvas,
.stm-root.is-feeling .stm-segment {
    cursor: pointer;
}

/* The segment boxes (#37). One wrapper carrying the camera's transform; the boxes inside it
   are positioned in world units and never touched by a pan or a zoom.

   **No \`will-change\`.** That property is what promoted the SVG surface's transformed
   wrapper to the composited layer that came apart on 2026-08-13 — that surface, and the
   \`.stm-content\` it transformed, were deleted by #40 — and this wrapper's bounds top out
   near 280,000 × 10,000 css px. It holds at most 767 rounded rects rather than a display
   list the size of the band population, which is why it is a different thing — but it is
   the same class of thing, so it is judged by looking rather than by argument.

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

/* Below the threshold in segmentOverlay.ts, and while no document is mounted. Stated rather
   than left to the UA sheet, because \`position: absolute\` is one cascade accident away from
   outranking it. */
.stm-segment[hidden] {
    display: none;
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
   under the cursor there was the canvas, so the surface picked the strand the navigator
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

/* Drawn as a card with a mark on it, not as red text on the ground.
   Every failure here — unreachable, absent, undrawable, viewer fault — arrives looking
   exactly like a tube map with nothing in it, and the gate is only worth having if a
   refusal cannot be taken for one (loadFailure.ts). So the error state is given an
   edge, a fill that is not the map's ground, and a mark, and reads as something placed
   over the surface rather than as the surface itself. */
.stm-status.is-error {
    --stm-alarm: rgb(168, 44, 44);

    color: rgb(58, 62, 70);
    background: rgba(244, 244, 246, 0.94);
}

.stm-status-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 22px 28px 20px;
    border: 1px solid rgba(168, 44, 44, 0.35);
    border-radius: 6px;
    background: rgb(255, 255, 255);
    box-shadow: 0 1px 3px rgba(20, 22, 26, 0.10);
}

.stm-status-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid var(--stm-alarm);
    color: var(--stm-alarm);
    font-weight: 700;
    font-size: 15px;
    line-height: 1;
}

.stm-status-heading {
    font-weight: 600;
}

/* Only when it is an error. The loading state shares the element and keeps the status's
   own colour — a spinner over an alarm-coloured line would announce a problem there
   isn't one yet. */
.stm-status.is-error .stm-status-heading {
    color: var(--stm-alarm);
}

/* Capped so a parser's reason — which names coordinates and counts — wraps into a
   readable measure rather than running the width of a strip-shaped surface. */
.stm-status-reason,
.stm-status-note,
.stm-status-url {
    max-width: 56ch;
    overflow-wrap: anywhere;
}

/* Set apart from the reason above it, because it says something different in kind: the
   reason is what happened, the note is where the fault lies. Same size, so it is not
   mistaken for fine print — it is the part that stops a researcher debugging their own
   network for twenty minutes. */
.stm-status-note {
    color: rgb(96, 100, 108);
    border-left: 2px solid rgb(210, 213, 219);
    padding-left: 10px;
    line-height: 1.45;
}

/* Quietest of the four: it is here to be copied into a bug report, not read first. */
.stm-status-url {
    color: rgb(120, 124, 132);
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
    .stm-mode-badge { transition: none; }
    .stm-spinner { animation-duration: 2s; }
}
`
