/**
 * How the orthographic camera is framed, and the only arithmetic the WebGL surface does
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

/** A viewport in CSS pixels. */
export interface Viewport {
    width: number
    height: number
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
