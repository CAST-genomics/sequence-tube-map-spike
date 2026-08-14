/**
 * Navigator — a thumbnail of the whole tube map with a rect showing where the
 * current view sits. The widget a researcher uses to know where they are in a strip
 * tens of screens wide.
 *
 * ## It does not draw the map
 *
 * It sizes a canvas to the map's aspect and hands it to whoever mounted it. The two
 * surfaces fill it in ways that have nothing in common — the SVG surface rasterizes
 * the document it already parsed, the WebGL surface renders its own scene into a
 * render target — and neither is the navigator's business. What is its business is
 * the chrome: the rect, the clipping, and the two gestures.
 *
 * ## It holds no view state
 *
 * `update` is handed the slice of content space currently on screen, computed by the
 * surface from whatever it steers by; `onNavigate` asks for a content point back. So
 * the navigator cannot disagree with the surface about where the view is, and it
 * needs to know nothing about `{x, y, scale}` or `camera.zoom` to say so.
 *
 * Content coordinates are the map's own: origin at its top-left corner, y down,
 * extent `content`.
 */

import { createPointerDrag } from './pointerDrag.ts'
import { clamp, type Point, type Rect, type Size } from './viewportTransform.ts'

/**
 * Widest the thumbnail is drawn, in CSS pixels — and the number the widget's whole
 * usefulness turns on, because the maps are strips and the height follows from it.
 *
 * It was 360, which had only ever been exercised against the 600 bp fixture at 360 × 64.
 * On the documents that matter 360 gives 26 px on `5520+` (14:1) and 13 px on `5514+`
 * (28:1). Rendered and looked at: the picture survives at 26 px and is a hairline at 13.
 * At 720 the same two are 51 px and 26 px, both showing where the strands swap and where
 * the strip narrows — landmarks a researcher can aim at. See
 * `notes/2026-08-14-navigator-thumbnail-aspect.md`.
 */
const THUMBNAIL_WIDTH = 720

/** Inset from the surface's lower-left corner, matching `.stm-navigator` in the stylesheet. */
const MARGIN = 16

/**
 * Fill the thumbnail canvas, already sized to `size` CSS pixels at `pixelRatio` device
 * pixels per CSS pixel. May be async; a failure costs the picture, not the affordance.
 */
export type ThumbnailPainter = (canvas: HTMLCanvasElement, size: Size, pixelRatio: number) => void | Promise<void>

export interface NavigatorHandle {
    /** Show the navigator for a map of this size, and have `paint` fill the thumbnail.
     *  Resolves once painted — or once painting has failed, which is not fatal. */
    setMap(content: Size, paint: ThumbnailPainter): Promise<void>
    /** `visible` is the slice of content space on screen, unclipped. */
    update(visible: Rect): void
    /** The host changed size; re-fit the widget to it. The thumbnail is not redrawn — the
     *  baked bitmap is scaled, which is the whole reason it is a bitmap. */
    relayout(): void
    clear(): void
    destroy(): void
}

export interface NavigatorOptions {
    /** Requested viewport center, in content coordinates. */
    onNavigate(center: Point): void
}

export function createNavigator(parent: HTMLElement, options: NavigatorOptions): NavigatorHandle {

    const doc = parent.ownerDocument

    const element = doc.createElement('div')
    element.className = 'stm-navigator'
    element.hidden = true

    const canvas = doc.createElement('canvas')
    canvas.className = 'stm-navigator-thumbnail'

    const rect = doc.createElement('div')
    rect.className = 'stm-navigator-rect'

    element.append(canvas, rect)
    parent.append(element)

    let content: Size | null = null
    /** The widget's size in CSS pixels — the thumbnail's aspect, at whatever width fits. */
    let thumbnail: Size = { width: THUMBNAIL_WIDTH, height: 1 }
    let grabOffset: Point = { x: 0, y: 0 }
    /** The unclipped viewport rect in navigator pixels — what the *view* covers, which is what a drag moves. */
    let viewRect: Rect | null = null
    /** The last slice reported, kept so a relayout can redraw the rect without one. */
    let visibleRect: Rect | null = null

    function navigatorScale(): number {
        return null === content ? 1 : thumbnail.width / content.width
    }

    /**
     * Size the widget to the map's aspect, as wide as `THUMBNAIL_WIDTH` or as wide as the
     * host allows — a navigator wider than the surface it sits in would run off the edge
     * it is meant to describe.
     */
    function layout(mapContent: Size): void {
        const available = parent.clientWidth - MARGIN * 2
        const width = Math.max(1, Math.min(THUMBNAIL_WIDTH, available))

        thumbnail = {
            width,
            height: Math.max(1, Math.round(width * mapContent.height / mapContent.width))
        }

        element.style.width = `${thumbnail.width}px`
        element.style.height = `${thumbnail.height}px`
    }

    /** Place the rect for a slice of content space, in navigator pixels. */
    function drawRect(visible: Rect): void {
        const scale = navigatorScale()

        viewRect = {
            x: visible.x * scale,
            y: visible.y * scale,
            width: visible.width * scale,
            height: visible.height * scale
        }

        // Drawn clipped to the thumbnail: the rect marks how much of the *map* is on
        // screen, so at whole-map fit it frames the thumbnail exactly rather than
        // spilling into the surrounding empty space. The size is never floored — a rect
        // that stopped shrinking would over-report the visible slice while still looking
        // plausible.
        const left = clamp(viewRect.x, 0, thumbnail.width)
        const top = clamp(viewRect.y, 0, thumbnail.height)
        const right = clamp(viewRect.x + viewRect.width, 0, thumbnail.width)
        const bottom = clamp(viewRect.y + viewRect.height, 0, thumbnail.height)

        rect.style.left = `${left}px`
        rect.style.top = `${top}px`
        rect.style.width = `${right - left}px`
        rect.style.height = `${bottom - top}px`
    }

    function pointerPosition(event: PointerEvent): Point {
        const bounds = element.getBoundingClientRect()
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    }

    function navigate(event: PointerEvent): void {
        if (null === content) {
            return
        }

        const scale = navigatorScale()
        const position = pointerPosition(event)

        options.onNavigate({
            x: (position.x - grabOffset.x) / scale,
            y: (position.y - grabOffset.y) / scale
        })
    }

    const drag = createPointerDrag(element, {

        accepts: (): boolean => null !== content,

        onStart(event: PointerEvent): void {
            // Grabbing inside the rect drags it from where it was taken hold of;
            // pressing anywhere else jumps that point to the middle of the view.
            //
            // The anchor comes from the unclipped rect, not the drawn one: where the
            // rect runs past the thumbnail edge the two centers differ, and using the
            // drawn one would make a grab there jump the view.
            const position = pointerPosition(event)

            grabOffset = null !== viewRect && contains(viewRect, position)
                ? { x: position.x - (viewRect.x + viewRect.width / 2), y: position.y - (viewRect.y + viewRect.height / 2) }
                : { x: 0, y: 0 }

            element.classList.add('is-dragging')
            navigate(event)
            event.preventDefault()
        },

        onMove(event: PointerEvent): void {
            navigate(event)
        },

        onEnd(): void {
            grabOffset = { x: 0, y: 0 }
            element.classList.remove('is-dragging')
        }
    })

    return {

        async setMap(mapContent: Size, paint: ThumbnailPainter): Promise<void> {
            content = mapContent
            layout(mapContent)

            const ratio = doc.defaultView?.devicePixelRatio || 1

            // The bitmap is baked at the size the widget has now and scaled by CSS after
            // that, so a later resize costs no repaint.
            canvas.width = Math.round(thumbnail.width * ratio)
            canvas.height = Math.round(thumbnail.height * ratio)

            element.hidden = false

            try {
                await paint(canvas, thumbnail, ratio)
            } catch (error) {
                console.warn('Navigator thumbnail could not be drawn; the viewport rect still works.', error)
            }
        },

        update(visible: Rect): void {
            if (null === content) {
                return
            }

            visibleRect = visible
            drawRect(visible)
        },

        relayout(): void {
            if (null === content) {
                return
            }

            layout(content)

            if (null !== visibleRect) {
                drawRect(visibleRect)
            }
        },

        clear(): void {
            drag.cancel()
            content = null
            viewRect = null
            visibleRect = null
            element.hidden = true
            canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
        },

        destroy(): void {
            drag.destroy()
            element.remove()
        }
    }
}

function contains(rect: Rect, point: Point): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.width &&
        point.y >= rect.y && point.y <= rect.y + rect.height
}
