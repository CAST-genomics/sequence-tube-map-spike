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

/* A short transition keeps a sweep across many strands from strobing. */
.stm-content g.track > * {
    transition: opacity 120ms ease-out;
}

/* Inspect mode: segments own the cursor, strands are inert. */
.stm-root:not(.is-feeling) .stm-content g.track > * {
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

.stm-navigator-thumbnail {
    display: block;
}

.stm-navigator-rect {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid rgba(20, 22, 26, 0.9);
    background: rgba(40, 120, 255, 0.16);
    box-shadow: 0 0 0 9999px rgba(255, 255, 255, 0.45);
    pointer-events: none;
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
