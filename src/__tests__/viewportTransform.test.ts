import { describe, expect, it } from 'vitest'

import {
    MAX_SCALE,
    clampToViewport,
    contentToScreen,
    fitToWidth,
    fitScale,
    pan,
    panToContentPoint,
    screenToContent,
    viewportRectInContent,
    zoomAbout,
    type Size,
    type Transform
} from '../viewportTransform.ts'

// The measured fixture: one minigraph node, viewBox="0 -80 35562.42857142856 6325".
const content: Size = { width: 35562.42857142856, height: 6325 }
const viewport: Size = { width: 1600, height: 900 }

describe('fitToWidth', () => {

    it('scales content width to exactly fill the viewport width', () => {
        const t = fitToWidth(content, viewport)
        expect(t.scale).toBeCloseTo(viewport.width / content.width, 12)
        expect(content.width * t.scale).toBeCloseTo(viewport.width, 9)
    })

    it('places the content left edge at the viewport left edge', () => {
        const { x } = fitToWidth(content, viewport)
        expect(x).toBe(0)
    })

    it('centers content vertically when it is shorter than the viewport', () => {
        const t = fitToWidth(content, viewport)
        const renderedHeight = content.height * t.scale
        expect(renderedHeight).toBeLessThan(viewport.height)
        expect(t.y).toBeCloseTo((viewport.height - renderedHeight) / 2, 9)
    })

    it('places the content top edge at the viewport top when content is taller than the viewport', () => {
        const tall: Size = { width: 1000, height: 100000 }
        const t = fitToWidth(tall, viewport)
        expect(content.height * t.scale).toBeGreaterThan(viewport.height)
        expect(t.y).toBe(0)
    })

    it('agrees with fitScale', () => {
        expect(fitToWidth(content, viewport).scale).toBe(fitScale(content, viewport))
    })
})

describe('pan', () => {

    it('translates the origin by the given screen delta', () => {
        const t: Transform = { x: 10, y: 20, scale: 0.5 }
        expect(pan(t, 5, -7)).toEqual({ x: 15, y: 13, scale: 0.5 })
    })

    it('is invertible', () => {
        const t: Transform = { x: 10, y: 20, scale: 0.5 }
        expect(pan(pan(t, 123.5, -456.25), -123.5, 456.25)).toEqual(t)
    })

    it('leaves scale untouched', () => {
        expect(pan({ x: 0, y: 0, scale: 3 }, 100, 100).scale).toBe(3)
    })
})

describe('zoomAbout', () => {

    const min = fitScale(content, viewport)

    it('leaves the content point under the cursor stationary', () => {
        const t = fitToWidth(content, viewport)
        const cursor = { x: 640, y: 410 }
        const before = screenToContent(t, cursor)

        const zoomed = zoomAbout(t, cursor, 2.5, min, MAX_SCALE)
        const after = screenToContent(zoomed, cursor)

        expect(after.x).toBeCloseTo(before.x, 6)
        expect(after.y).toBeCloseTo(before.y, 6)
    })

    it('leaves the cursor point stationary across a chain of zooms', () => {
        const cursor = { x: 233, y: 717 }
        let t = fitToWidth(content, viewport)
        const before = screenToContent(t, cursor)

        for (const factor of [ 1.1, 1.1, 1.1, 0.9, 1.4, 0.5, 3.0 ]) {
            t = zoomAbout(t, cursor, factor, min, MAX_SCALE)
        }

        const after = screenToContent(t, cursor)
        expect(after.x).toBeCloseTo(before.x, 6)
        expect(after.y).toBeCloseTo(before.y, 6)
    })

    it('multiplies scale by the factor when unclamped', () => {
        const t: Transform = { x: 0, y: 0, scale: 1 }
        expect(zoomAbout(t, { x: 0, y: 0 }, 2, min, MAX_SCALE).scale).toBeCloseTo(2, 12)
    })

    it('clamps at the low end to the fit scale', () => {
        const t = fitToWidth(content, viewport)
        const zoomed = zoomAbout(t, { x: 800, y: 450 }, 0.01, min, MAX_SCALE)
        expect(zoomed.scale).toBe(min)
    })

    it('clamps at the high end to the maximum scale', () => {
        const t = fitToWidth(content, viewport)
        const zoomed = zoomAbout(t, { x: 800, y: 450 }, 10000, min, MAX_SCALE)
        expect(zoomed.scale).toBe(MAX_SCALE)
    })

    it('keeps the cursor point stationary even when the zoom clamps', () => {
        const t = { ...fitToWidth(content, viewport), scale: MAX_SCALE / 1.5 }
        const cursor = { x: 900, y: 100 }
        const before = screenToContent(t, cursor)

        const zoomed = zoomAbout(t, cursor, 100, min, MAX_SCALE)

        expect(zoomed.scale).toBe(MAX_SCALE)
        const after = screenToContent(zoomed, cursor)
        expect(after.x).toBeCloseTo(before.x, 6)
        expect(after.y).toBeCloseTo(before.y, 6)
    })
})

describe('screenToContent / contentToScreen', () => {

    const t: Transform = { x: -1234.5, y: 87.25, scale: 0.375 }

    it('round-trips a screen point', () => {
        const p = { x: 613.5, y: 425.75 }
        const back = contentToScreen(t, screenToContent(t, p))
        expect(back.x).toBeCloseTo(p.x, 9)
        expect(back.y).toBeCloseTo(p.y, 9)
    })

    it('round-trips a content point', () => {
        const c = { x: 20000, y: 3162.5 }
        const back = screenToContent(t, contentToScreen(t, c))
        expect(back.x).toBeCloseTo(c.x, 9)
        expect(back.y).toBeCloseTo(c.y, 9)
    })

    it('maps the content origin to the transform origin', () => {
        expect(contentToScreen(t, { x: 0, y: 0 })).toEqual({ x: t.x, y: t.y })
    })
})

describe('viewportRectInContent', () => {

    it('covers the whole content at fit scale', () => {
        const t = fitToWidth(content, viewport)
        const rect = viewportRectInContent(t, viewport)
        expect(rect.x).toBeCloseTo(0, 9)
        expect(rect.width).toBeCloseTo(content.width, 6)
    })

    it('shrinks in inverse proportion to scale', () => {
        const base = { x: 0, y: 0, scale: 1 }
        const one = viewportRectInContent(base, viewport)
        const four = viewportRectInContent({ ...base, scale: 4 }, viewport)

        expect(four.width).toBeCloseTo(one.width / 4, 9)
        expect(four.height).toBeCloseTo(one.height / 4, 9)
    })

    it('tracks the panned origin', () => {
        const t: Transform = { x: -500, y: -250, scale: 0.5 }
        const rect = viewportRectInContent(t, viewport)
        expect(rect.x).toBeCloseTo(1000, 9)
        expect(rect.y).toBeCloseTo(500, 9)
    })

    it('has its top-left at the content point under the viewport top-left corner', () => {
        const t: Transform = { x: -123, y: -45, scale: 0.7 }
        const rect = viewportRectInContent(t, viewport)
        const corner = screenToContent(t, { x: 0, y: 0 })
        expect(rect.x).toBeCloseTo(corner.x, 9)
        expect(rect.y).toBeCloseTo(corner.y, 9)
    })
})

describe('panToContentPoint', () => {

    it('centers the viewport on the requested content point', () => {
        const t: Transform = { x: 0, y: 0, scale: 0.5 }
        const target = { x: 20000, y: 3000 }

        const centered = panToContentPoint(t, target, viewport)
        const onScreen = contentToScreen(centered, target)

        expect(onScreen.x).toBeCloseTo(viewport.width / 2, 9)
        expect(onScreen.y).toBeCloseTo(viewport.height / 2, 9)
    })

    it('leaves scale untouched', () => {
        const centered = panToContentPoint({ x: 0, y: 0, scale: 2 }, { x: 1, y: 1 }, viewport)
        expect(centered.scale).toBe(2)
    })
})

describe('clampToViewport', () => {

    it('does not let content pull away from the left edge', () => {
        const t = { ...fitToWidth(content, viewport), scale: 1 }
        const clamped = clampToViewport(pan(t, 500, 0), content, viewport)
        expect(clamped.x).toBe(0)
    })

    it('does not let content pull away from the right edge', () => {
        const t: Transform = { x: 0, y: 0, scale: 1 }
        const clamped = clampToViewport(pan(t, -1e9, 0), content, viewport)
        expect(clamped.x).toBeCloseTo(viewport.width - content.width, 6)
    })

    it('leaves an in-bounds transform untouched', () => {
        const t: Transform = { x: -1000, y: -100, scale: 1 }
        expect(clampToViewport(t, content, viewport)).toEqual(t)
    })

    it('centers an axis whose content is smaller than the viewport', () => {
        const t = fitToWidth(content, viewport)
        const clamped = clampToViewport(pan(t, 0, 400), content, viewport)
        expect(clamped.y).toBeCloseTo((viewport.height - content.height * t.scale) / 2, 9)
    })

    it('holds the fit transform fixed', () => {
        const t = fitToWidth(content, viewport)
        const clamped = clampToViewport(t, content, viewport)
        expect(clamped.x).toBeCloseTo(t.x, 9)
        expect(clamped.y).toBeCloseTo(t.y, 9)
    })
})
