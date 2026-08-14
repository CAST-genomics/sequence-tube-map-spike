/**
 * The three camera positions the fidelity gate measures, derived from the real
 * `viewportTransform` so the spike cannot quietly disagree with the app about what
 * "fit" means.
 *
 * Shared by the WebGL page, the control page and the Node driver, because the whole
 * measurement rests on both renderers being given the *same* window of content.
 */

import { MAX_SCALE, clampToViewport, fitToWidth, type Size, type Transform } from '../../src/viewportTransform.ts'

/** The measurement viewport. Fixed: fit scale is a function of it, so numbers from
 *  different sizes are not comparable. */
export const VIEWPORT: Size = { width: 1400, height: 900 }

/** Retina, as the researchers run it. At dpr 2 a 0.216 CSS px band is 0.43 device px. */
export const DEVICE_PIXEL_RATIO = 2

export type CameraName = 'fit' | 'mid' | 'max'

export interface Camera {
    name: CameraName
    transform: Transform
    /** What a failure here would mean, carried alongside the number it produces. */
    reads: string
}

/**
 * `fit` is the hard case and the one the kill criterion is about. `max` is the easy
 * case — a failure there is wrong geometry rather than aliasing. `mid` is what
 * separates the two diagnoses.
 */
export function cameras(content: Size): Camera[] {
    const fit = fitToWidth(content, VIEWPORT)

    return [
        { name: 'fit', transform: fit, reads: 'sub-pixel band structure' },
        { name: 'mid', transform: zoomedAbout(fit, content, 1.0), reads: 'aliasing vs geometry' },
        { name: 'max', transform: zoomedAbout(fit, content, MAX_SCALE), reads: 'geometry and curve fidelity' }
    ]
}

/**
 * Zoom to `scale` about the centre of the viewport, then clamp exactly as the surface
 * would. Centring is arbitrary but must be *stated*, since at MAX_SCALE the window is
 * a 350-unit slice of a 108,983-unit strip and any two choices show different bands.
 */
function zoomedAbout(fit: Transform, content: Size, scale: number): Transform {
    const factor = scale / fit.scale
    const cx = VIEWPORT.width / 2
    const cy = VIEWPORT.height / 2

    return clampToViewport(
        {
            x: cx - (cx - fit.x) * factor,
            y: cy - (cy - fit.y) * factor,
            scale
        },
        content,
        VIEWPORT
    )
}
