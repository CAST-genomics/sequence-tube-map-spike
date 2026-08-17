/**
 * Which haplotype is under the cursor.
 *
 * This is the capability the SVG surface lost. DOM hit-testing at 40,442 elements cost
 * ~28 ms per hover — far past a frame — and that measurement is half the reason the
 * renderer was replaced. `CONTEXT.md` #6 rejected canvas specifically to preserve
 * per-element hit-testing; this is where it returns, by a different route.
 *
 * ## The route
 *
 * A second pass over the same scene with a material that writes each band's `trackID` as
 * colour, rendered through a camera whose entire frustum is the one css pixel under the
 * cursor, into a 1×1 target that is then read back. No spatial index, no bounding boxes,
 * no per-band arithmetic on the CPU — the GPU already knows how to rasterize these bands,
 * and asking it "what did you put here" reuses that exactly.
 *
 * **A strand is 13 to 47 separate bands**, and `trackID` is what unites them, so the answer
 * is a haplotype rather than a fragment. That falls out of the attribute; nothing here
 * stitches anything. (`trackID` is the document's spelling of a strand id, and stays
 * spelled that way wherever the document is being quoted — see `parseBands.ts`.)
 *
 * ## Why one pixel and not a region
 *
 * The frustum is one css pixel wide, so almost every instance is clipped after its vertex
 * shader and rasterizes nothing. The vertex shader still runs for all of them — that is
 * the cost of this approach, and it is the number to watch if picking ever gets slow.
 *
 * `readRenderTargetPixels` is a synchronous readback and stalls the pipeline until the
 * pass finishes, so the milliseconds reported with each pick are honest: they include the
 * GPU work, not just the time to submit it.
 *
 * ## The pick material's contract
 *
 * The material handed in must be the band material's twin — same vertex shader, same
 * coverage uniforms — differing only in what it writes. This module drives `uHalfPixel`
 * and `uPad` on it, because the size of a pick pixel is this module's business and
 * follows from the frustum it builds. See `PICK_FRAGMENT` in `bandSurface.ts` for what
 * the fragments write and why alpha is the hit flag.
 */

import {
    Color,
    OrthographicCamera,
    type RawShaderMaterial,
    type Scene,
    WebGLRenderTarget,
    type WebGLRenderer
} from 'three'
import { devicePixel, worldFromViewportPoint, type CameraView, type Viewport } from './bandCamera.ts'
import type { Point } from './geometry.ts'

/** What the cursor is over, and what asking cost. */
export interface Pick {
    /** The haplotype under the cursor, or `null` over empty space. */
    strandId: number | null
    /** Wall-clock milliseconds for the pass, including the readback stall. */
    milliseconds: number
}

export interface BandPicker {
    /** `point` is css pixels from the surface's top-left, as a pointer event reports it. */
    pick(point: Point, viewport: Viewport, view: CameraView): Pick
    dispose(): void
}

/**
 * The pixel the pick pass wrote, read back as a strand id.
 *
 * Alpha is the hit flag rather than a colour. The target is cleared to a fully
 * transparent black that no kept fragment can produce, so zero alpha means empty space
 * — not strand 0, which is a real haplotype on every document we have.
 */
export function decodeStrandId(pixel: Uint8Array): number | null {
    if (0 === pixel[3]) {
        return null
    }

    // Low byte first, matching the two lines of GLSL that wrote it.
    return pixel[0] + pixel[1] * 256
}

export function createBandPicker(
    renderer: WebGLRenderer,
    scene: Scene,
    material: RawShaderMaterial
): BandPicker {

    // One css pixel, so the pick target matches the precision the pointer is reported at
    // rather than the device pixels the surface happens to be drawn with.
    const camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 100)
    const target = new WebGLRenderTarget(1, 1)
    const pixel = new Uint8Array(4)
    const clearColor = new Color()

    return {

        pick(point: Point, viewport: Viewport, view: CameraView): Pick {
            const started = performance.now()
            const world = worldFromViewportPoint(point, viewport, view)

            camera.position.set(world.x, world.y, 5)
            camera.zoom = view.zoom
            camera.updateProjectionMatrix()

            // The pad is what keeps a band thinner than a pick pixel from falling between
            // sample points and reporting empty space where the researcher can plainly
            // see a strand. Measured against the pick pixel, not the screen's.
            const size = devicePixel(view.zoom, 1)

            material.uniforms.uHalfPixel.value = size * 0.5
            material.uniforms.uPad.value = size

            renderer.getClearColor(clearColor)

            const clearAlpha = renderer.getClearAlpha()
            const restore = scene.overrideMaterial

            try {
                renderer.setClearColor(0x000000, 0)
                scene.overrideMaterial = material
                renderer.setRenderTarget(target)
                renderer.render(scene, camera)
                renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
            } finally {
                // The renderer and the scene are the surface's own, so everything borrowed
                // is handed back here rather than left for the next frame to notice.
                renderer.setRenderTarget(null)
                renderer.setClearColor(clearColor, clearAlpha)
                scene.overrideMaterial = restore
            }

            return { strandId: decodeStrandId(pixel), milliseconds: performance.now() - started }
        },

        dispose(): void {
            target.dispose()
        }
    }
}
