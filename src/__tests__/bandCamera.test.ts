/**
 * The camera math is the second thing that can be silently wrong without looking wrong.
 *
 * A frustum measured in world units looks identical at one window size and stretches the
 * map at every other, because the visible world width stops depending on how many pixels
 * there are to show it in. That is the failure these tests exist to catch: the
 * resize-preserves-the-view rule (`CONTEXT.md` #10) is a statement about world units per
 * pixel, so it is asserted here rather than judged by eye.
 */

import { describe, expect, it } from 'vitest'
import {
    MAX_ZOOM_FACTOR,
    devicePixel,
    fitZoom,
    overlayTranslation,
    pixelFrustum,
    usable,
    visibleContentRect,
    worldFromContentPoint,
    worldFromViewportPoint,
    zoomRange
} from '../bandCamera.ts'

describe('fitZoom', () => {

    it('is the pixels-per-unit that shows the content’s whole width', () => {
        expect(fitZoom(1000, { width: 500, height: 300 })).toBe(0.5)
        expect(fitZoom(1000, { width: 2000, height: 300 })).toBe(2)
    })

    it('ignores the viewport’s height, because fit is to width', () => {
        expect(fitZoom(1000, { width: 500, height: 300 }))
            .toBe(fitZoom(1000, { width: 500, height: 900 }))
    })
})

describe('zoomRange', () => {

    it('bottoms out at fit and tops out 200× above it', () => {
        const range = zoomRange(1000, { width: 500, height: 300 })

        expect(range.min).toBe(0.5)
        expect(range.max).toBe(0.5 * MAX_ZOOM_FACTOR)
    })

    it('holds the ceiling at 200× so a band stays reachable on the widest strip', () => {
        // 5514+ is 177,994 units wide; a band is 15. At the ceiling that is ~0.47 css px
        // per band under the SVG surface's 4× cap and 23 px here.
        const range = zoomRange(177993.57, { width: 1400, height: 900 })

        expect(15 * range.max).toBeGreaterThan(20)
    })
})

describe('pixelFrustum', () => {

    it('measures the frustum in css pixels, centred on the camera', () => {
        expect(pixelFrustum({ width: 800, height: 600 }))
            .toEqual({ left: -400, right: 400, top: 300, bottom: -300 })
    })

    it('shows more of the map in a wider window at the same zoom', () => {
        // The whole point of a pixel-unit frustum: visible world width is
        // (right - left) / zoom, so widening the window reveals rather than stretches.
        const zoom = 0.5
        const narrow = pixelFrustum({ width: 800, height: 600 })
        const wide = pixelFrustum({ width: 1600, height: 600 })

        expect((narrow.right - narrow.left) / zoom).toBe(1600)
        expect((wide.right - wide.left) / zoom).toBe(3200)
    })

    it('puts the content’s full width on screen at exactly fit zoom', () => {
        const viewport = { width: 1400, height: 900 }
        const frame = pixelFrustum(viewport)

        expect((frame.right - frame.left) / fitZoom(108982.57, viewport)).toBeCloseTo(108982.57, 6)
    })
})

describe('devicePixel', () => {

    it('is one device pixel expressed in world units', () => {
        // Sub-pixel coverage is measured against this, so it follows the device ratio and
        // not just the zoom: at dpr 2 a device pixel is half the world of a css pixel.
        expect(devicePixel(0.5, 1)).toBe(2)
        expect(devicePixel(0.5, 2)).toBe(1)
    })
})

describe('usable', () => {

    it('rejects a viewport with no area, which would make fit zoom zero or infinite', () => {
        expect(usable({ width: 0, height: 600 })).toBe(false)
        expect(usable({ width: 800, height: 0 })).toBe(false)
        expect(usable({ width: 800, height: 600 })).toBe(true)
    })
})

/**
 * The navigator speaks content coordinates — origin at the map's top-left corner, y down,
 * the vocabulary the parser converted *away* from. These two functions are the whole of
 * the translation, and they are the third thing that can be silently wrong without looking
 * wrong: a rect that tracks the view but drifts by half a map height at one zoom and not
 * another looks like a plausible widget until you check it against the picture.
 */
describe('visibleContentRect', () => {

    const content = { width: 108982.57, height: 7785 }

    it('is the whole map when the camera sits at the origin at fit zoom', () => {
        const viewport = { width: 1400, height: 900 }
        const zoom = fitZoom(content.width, viewport)
        const visible = visibleContentRect({ x: 0, y: 0, zoom }, viewport, content)

        expect(visible.x).toBeCloseTo(0, 6)
        expect(visible.width).toBeCloseTo(content.width, 6)

        // Height follows the viewport, not the content: at fit-to-width the strip is
        // shorter than the window, so the visible slice runs off both ends of it.
        expect(visible.height).toBeCloseTo(viewport.height / zoom, 6)
        expect(visible.y).toBeCloseTo((content.height - visible.height) / 2, 6)
    })

    it('moves right and down as the camera does, in content units', () => {
        const viewport = { width: 1400, height: 900 }
        const zoom = 0.01
        const centred = visibleContentRect({ x: 0, y: 0, zoom }, viewport, content)
        const moved = visibleContentRect({ x: 5000, y: -300, zoom }, viewport, content)

        // World y is up and content y is down, so a camera moving down the world moves
        // the rect down the thumbnail.
        expect(moved.x - centred.x).toBeCloseTo(5000, 6)
        expect(moved.y - centred.y).toBeCloseTo(300, 6)
    })

    it('shows less of the map as the zoom rises', () => {
        const viewport = { width: 1400, height: 900 }
        const wide = visibleContentRect({ x: 0, y: 0, zoom: 0.01 }, viewport, content)
        const close = visibleContentRect({ x: 0, y: 0, zoom: 0.04 }, viewport, content)

        expect(close.width).toBeCloseTo(wide.width / 4, 6)
        expect(close.height).toBeCloseTo(wide.height / 4, 6)
    })
})

describe('worldFromContentPoint', () => {

    const content = { width: 108982.57, height: 7785 }

    it('puts the map’s centre at the origin, where the parser left it', () => {
        expect(worldFromContentPoint({ x: content.width / 2, y: content.height / 2 }, content))
            .toEqual({ x: 0, y: 0 })
    })

    it('round-trips with the centre of the visible rect at any zoom', () => {
        const viewport = { width: 1400, height: 900 }

        for (const zoom of [ 0.0128, 0.05, 1.2 ]) {
            const view = { x: 12000, y: -900, zoom }
            const visible = visibleContentRect(view, viewport, content)
            const centre = { x: visible.x + visible.width / 2, y: visible.y + visible.height / 2 }
            const world = worldFromContentPoint(centre, content)

            expect(world.x).toBeCloseTo(view.x, 6)
            expect(world.y).toBeCloseTo(view.y, 6)
        }
    })
})

/**
 * Picking aims a one-pixel camera with this, so an error here does not look like an
 * error: it returns a real strand, just the wrong one, and only ever by a little.
 */
describe('worldFromViewportPoint', () => {

    const viewport = { width: 1400, height: 900 }

    it('puts the middle of the viewport at the camera', () => {
        const view = { x: 12000, y: -900, zoom: 0.05 }

        expect(worldFromViewportPoint({ x: 700, y: 450 }, viewport, view))
            .toEqual({ x: 12000, y: -900 })
    })

    it('flips y, because the viewport counts down and the world counts up', () => {
        const view = { x: 0, y: 0, zoom: 1 }

        expect(worldFromViewportPoint({ x: 700, y: 0 }, viewport, view).y).toBe(450)
        expect(worldFromViewportPoint({ x: 700, y: 900 }, viewport, view).y).toBe(-450)
    })

    it('divides pixel offsets by the zoom, so a pixel is smaller world the closer you are', () => {
        const near = worldFromViewportPoint({ x: 701, y: 450 }, viewport, { x: 0, y: 0, zoom: 10 })
        const far = worldFromViewportPoint({ x: 701, y: 450 }, viewport, { x: 0, y: 0, zoom: 0.1 })

        expect(near.x).toBeCloseTo(0.1, 12)
        expect(far.x).toBeCloseTo(10, 12)
    })

    it('inverts visibleContentRect, so what picking aims at is what the navigator draws', () => {
        const content = { width: 35562.43, height: 6325 }
        const view = { x: -4000, y: 1200, zoom: 0.32 }

        // The viewport's top-left corner, both ways round.
        const visible = visibleContentRect(view, viewport, content)
        const world = worldFromViewportPoint({ x: 0, y: 0 }, viewport, view)

        expect(world.x).toBeCloseTo(visible.x - content.width * 0.5, 6)
        expect(world.y).toBeCloseTo(content.height * 0.5 - visible.y, 6)
    })
})

describe('overlayTranslation', () => {

    const view = { x: -4200, y: 315, zoom: 0.037 }
    const viewport = { width: 1400, height: 900 }

    /** Where the wrapper puts an element laid out at world `(x, y)`, in viewport pixels. */
    function placed(world: { x: number, y: number }): { x: number, y: number } {
        const translate = overlayTranslation(view, viewport)

        return { x: translate.x + world.x * view.zoom, y: translate.y + -world.y * view.zoom }
    }

    it('is the projection the pick pass runs backwards', () => {
        // Asserted against `worldFromViewportPoint` rather than against arithmetic written
        // twice: the boxes have to land on the bands the shader draws, and that function is
        // already what the surface believes about where a viewport pixel is in the world.
        for (const point of [{ x: 0, y: 0 }, { x: 700, y: 450 }, { x: 1399, y: 899 }]) {
            const world = worldFromViewportPoint(point, viewport, view)
            const screen = placed(world)

            expect(screen.x).toBeCloseTo(point.x, 6)
            expect(screen.y).toBeCloseTo(point.y, 6)
        }
    })

    it('puts the camera’s own position in the middle of the viewport', () => {
        const middle = placed({ x: view.x, y: view.y })

        expect(middle.x).toBeCloseTo(viewport.width * 0.5, 9)
        expect(middle.y).toBeCloseTo(viewport.height * 0.5, 9)
    })

    it('lays its contents out with y down, so nothing inside them is mirrored', () => {
        // A larger world y is further *up* the screen. If this ever inverted, the boxes
        // would still land on the map — mirrored about the camera, which on a map centred
        // on the origin at fit is nearly invisible and completely wrong.
        expect(placed({ x: 0, y: 100 }).y).toBeLessThan(placed({ x: 0, y: 0 }).y)
        expect(placed({ x: 100, y: 0 }).x).toBeGreaterThan(placed({ x: 0, y: 0 }).x)
    })
})
