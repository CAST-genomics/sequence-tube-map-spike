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
.stm-root.is-feeling .stm-canvas {
    cursor: crosshair;
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
