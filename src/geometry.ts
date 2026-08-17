/**
 * The plane the viewer measures in: three shapes and a clamp. Pure, DOM-free.
 *
 * Content space is the tube map's own coordinate system (SVG viewBox units), origin at
 * the map's top-left corner and y down. Everything else — world space, css pixels,
 * device pixels — is a conversion away from it, and every conversion lives with the
 * thing that owns the camera (`bandCamera.ts`) rather than here.
 *
 * This was `viewportTransform.ts` until 2026-08-16, and it was much larger: it owned
 * `{ x, y, scale }` and the pan, zoom, fit and clamp arithmetic driving the SVG surface's
 * CSS transform, including a hand-written copy of `pgb/src/mapControlsFactory.js`'s wheel
 * curve. #40 retired that surface, and `MapControls` had already replaced the arithmetic
 * — see ADR `0001`, which records both. What is left is the vocabulary the rest of the
 * viewer still speaks in, which is why the file is still here under a name that fits it.
 */

export interface Point {
    x: number
    y: number
}

export interface Size {
    width: number
    height: number
}

export interface Rect {
    x: number
    y: number
    width: number
    height: number
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}
