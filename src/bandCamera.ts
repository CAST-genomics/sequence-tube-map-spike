/**
 * How the orthographic camera is framed, and the only arithmetic the surface does
 * that is not in a shader.
 *
 * **The frustum is measured in CSS pixels, not world units**, and `camera.zoom` therefore
 * reads as *CSS pixels per world unit*. The spike framed it the other way — half-width
 * fixed at the content's own half-width, so `zoom = 1` was fit-to-width by construction —
 * which is the simpler thing to write and the wrong thing to resize: with the frustum
 * pinned to the content, the visible world width is `contentWidth / zoom` no matter how
 * many pixels the window has, so widening the window stretches the map instead of showing
 * more of it. Decision #10 says a resize reveals more or less, and this is where that is
 * decided.
 *
 * The cost of the change is that fit is no longer the number 1: it depends on the
 * viewport, so it has to be recomputed on every resize, and with it the zoom clamp. That
 * is what `zoomRange` is for.
 */

import type { Point, Rect, Size } from './geometry.ts'

/** A viewport in CSS pixels. */
export interface Viewport {
    width: number
    height: number
}

/** Where the camera looks and how close, which is all the navigator needs of it. */
export interface CameraView {
    /** Camera position in world units — the point at the middle of the viewport. */
    x: number
    y: number
    /** CSS pixels per world unit. */
    zoom: number
}

/** A symmetric orthographic frustum, in CSS pixels. */
export interface Frustum {
    left: number
    right: number
    top: number
    bottom: number
}

/**
 * How far past fit the camera may go. 200× is ~38 css px per band on `5520+`, measured;
 * the SVG surface's 4× was calibrated against the 600 bp fixture and never resolves a
 * haplotype on the documents that matter. float32 starts to show around 1000×.
 */
export const MAX_ZOOM_FACTOR = 200

/** CSS pixels per world unit at which the content's full width fills the viewport. */
export function fitZoom(contentWidth: number, viewport: Viewport): number {
    return viewport.width / contentWidth
}

/** The zoom clamp `MapControls` enforces: fit at the bottom, 200× fit at the top. */
export function zoomRange(contentWidth: number, viewport: Viewport): { min: number, max: number } {
    const fit = fitZoom(contentWidth, viewport)

    return { min: fit, max: fit * MAX_ZOOM_FACTOR }
}

/**
 * The frustum for a viewport. Height follows the viewport rather than the content: on a
 * 14:1 strip most of the screen is empty at fit, which is what fit-to-width has always
 * meant here.
 */
export function pixelFrustum(viewport: Viewport): Frustum {
    const halfWidth = viewport.width * 0.5
    const halfHeight = viewport.height * 0.5

    return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight }
}

/**
 * One device pixel in world units. Everything sub-pixel — the analytic coverage the
 * fragment shader computes, and the pad that keeps a band thinner than a pixel from
 * missing every sample — is measured against this, so it follows the device ratio and not
 * just the zoom.
 */
export function devicePixel(zoom: number, pixelRatio: number): number {
    return 1 / (zoom * pixelRatio)
}

/** Whether a viewport has enough area to frame anything in. A collapsed one gives a fit
 *  zoom of zero or infinity, so callers wait rather than commit one. */
export function usable(viewport: Viewport): boolean {
    return viewport.width > 0 && viewport.height > 0
}

/**
 * The slice of the map on screen, in **content coordinates** — origin at the map's
 * top-left corner, y down — the map's own frame, which the navigator thinks in.
 *
 * This is the translation the navigator needs, and the only place the two coordinate
 * systems meet. `parseBands.ts` centres the map on the origin and flips y so nothing
 * downstream has to know the source was SVG; the navigator is a picture of the *whole
 * map*, so it thinks in the map's own corner-origin frame and this converts back.
 *
 * The rect is unclipped: at fit-to-width on a 14:1 strip the viewport is taller than the
 * map, so the visible slice legitimately runs off both ends of it. Clipping is the
 * navigator's business, and only for drawing.
 */
export function visibleContentRect(view: CameraView, viewport: Viewport, content: Size): Rect {
    const width = viewport.width / view.zoom
    const height = viewport.height / view.zoom

    return {
        x: view.x + content.width * 0.5 - width * 0.5,
        y: content.height * 0.5 - view.y - height * 0.5,
        width,
        height
    }
}

/**
 * Where a point in the viewport lands in the world.
 *
 * This is the projection run backwards, and it is two lines only because the frustum is
 * symmetric, measured in css pixels, and never rotated: `zoom` reads as css pixels per
 * world unit, so an offset from the middle of the viewport divides straight through it.
 *
 * `point` is css pixels from the viewport's top-left with y down — what a pointer event
 * reports over the canvas. The world it returns has y up, like everything downstream of
 * `parseBands`.
 */
export function worldFromViewportPoint(point: Point, viewport: Viewport, view: CameraView): Point {
    return {
        x: view.x + (point.x - viewport.width * 0.5) / view.zoom,
        y: view.y + (viewport.height * 0.5 - point.y) / view.zoom
    }
}

/**
 * Where a wrapper carrying `translate(…) scale(view.zoom)` must be translated so that its
 * contents, laid out in world units, land exactly on the map the canvas draws.
 *
 * This is the projection written as a CSS transform, and it is what lets #37's segment
 * boxes be positioned once, in the document's own numbers, and never touched again on a pan
 * or a zoom. One string per frame replaces per-box work entirely.
 *
 * **Its contents are laid out with y down**, because CSS `top` grows downward and a wrapper
 * scaled by a negative factor would mirror everything inside it, tooltips included. So an
 * element at world `(x, y)` is placed at `left: x`, `top: -y`, and this returns the
 * translation that carries that convention onto the screen:
 *
 *     screen.x = translate.x + world.x  · zoom
 *     screen.y = translate.y + (-world.y) · zoom
 *
 * which is `worldFromViewportPoint` run forwards, and is asserted against it.
 */
export function overlayTranslation(view: CameraView, viewport: Viewport): Point {
    return {
        x: viewport.width * 0.5 - view.x * view.zoom,
        y: viewport.height * 0.5 + view.y * view.zoom
    }
}

/** The inverse for a point: where the camera goes to put `point` at the middle of the view. */
export function worldFromContentPoint(point: Point, content: Size): Point {
    return {
        x: point.x - content.width * 0.5,
        y: content.height * 0.5 - point.y
    }
}
