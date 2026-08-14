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
import { MAX_ZOOM_FACTOR, devicePixel, fitZoom, pixelFrustum, usable, zoomRange } from '../bandCamera.ts'

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
