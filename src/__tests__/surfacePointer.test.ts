/**
 * Where a pointer event lands, once the listener is no longer on the element it lands on.
 *
 * Bound to the root, `event.offsetX` answers a question nobody asked — it is an offset
 * into whatever happened to be under the cursor, which from #37 onwards is a segment box
 * 28 css px wide rather than the canvas. `canvasPoint` is what replaces it, and it is
 * asserted here rather than judged by eye because the failure it guards against looks like
 * a pick that is *nearly* right: off by the overlay's own origin, which is small, plausible
 * and points at the wrong strand.
 */

import { describe, expect, it } from 'vitest'
import { canvasPoint } from '../surfacePointer.ts'

/** A canvas inset 12 px from a window scrolled a little — the general case, not the origin. */
const BOUNDS = { left: 12, top: 40, right: 812, bottom: 640 }

describe('canvasPoint', () => {

    it('measures from the canvas’s own top-left, not the viewport’s', () => {
        expect(canvasPoint({ x: 112, y: 140 }, BOUNDS)).toEqual({ x: 100, y: 100 })
    })

    it('puts the top-left corner at the origin', () => {
        expect(canvasPoint({ x: 12, y: 40 }, BOUNDS)).toEqual({ x: 0, y: 0 })
    })

    it('keeps sub-pixel offsets, because the pick camera is happy with them', () => {
        expect(canvasPoint({ x: 12.5, y: 40.25 }, BOUNDS)).toEqual({ x: 0.5, y: 0.25 })
    })

    it('is nowhere for a pointer outside the canvas on any side', () => {
        expect(canvasPoint({ x: 11, y: 100 }, BOUNDS)).toBeNull()
        expect(canvasPoint({ x: 100, y: 39 }, BOUNDS)).toBeNull()
        expect(canvasPoint({ x: 900, y: 100 }, BOUNDS)).toBeNull()
        expect(canvasPoint({ x: 100, y: 700 }, BOUNDS)).toBeNull()
    })

    it('excludes the far edges, because bounds are half-open like the pixels they count', () => {
        expect(canvasPoint({ x: 812, y: 100 }, BOUNDS)).toBeNull()
        expect(canvasPoint({ x: 100, y: 640 }, BOUNDS)).toBeNull()
        expect(canvasPoint({ x: 811.5, y: 639.5 }, BOUNDS)).toEqual({ x: 799.5, y: 599.5 })
    })

    it('is nowhere for a canvas with no area at all, rather than the origin', () => {
        expect(canvasPoint({ x: 0, y: 0 }, { left: 0, top: 0, right: 0, bottom: 0 })).toBeNull()
    })
})
