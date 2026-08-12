/**
 * Navigator — a thumbnail of the whole tube map with a rect showing where the
 * current view sits.
 *
 * The thumbnail is a bitmap baked once on load. A second live copy of the SVG
 * would roughly double the element count for something rendered ~90x too small to
 * resolve a single strand; the navigator's affordances are chrome *over* the
 * thumbnail, not interactions *with* strands.
 *
 * It holds no view state of its own — it is handed the same `{ x, y, scale }` the
 * surface renders from, so the two cannot disagree.
 */

import { clamp, screenToContent, viewportRectInContent, type Point, type Rect, type Size, type Transform } from './viewportTransform.ts'

const NAVIGATOR_WIDTH = 360

export interface NavigatorHandle {
    /** Bake the thumbnail. Resolves once drawn — or once drawing has failed, which is not fatal. */
    setMap(source: string, content: Size): Promise<void>
    update(transform: Transform, viewport: Size): void
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
    let thumbnail: Size = { width: NAVIGATOR_WIDTH, height: 1 }
    let dragPointer: number | null = null
    let grabOffset: Point = { x: 0, y: 0 }
    /** The unclipped viewport rect in navigator pixels — what the *view* covers, which is what a drag moves. */
    let viewRect: Rect | null = null

    function navigatorScale(): number {
        return null === content ? 1 : thumbnail.width / content.width
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

    function onPointerDown(event: PointerEvent): void {
        if (null === content) {
            return
        }

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

        dragPointer = event.pointerId
        element.setPointerCapture(event.pointerId)
        element.classList.add('is-dragging')
        navigate(event)
        event.preventDefault()
    }

    function onPointerMove(event: PointerEvent): void {
        if (event.pointerId === dragPointer) {
            navigate(event)
        }
    }

    function onPointerUp(event: PointerEvent): void {
        if (event.pointerId !== dragPointer) {
            return
        }

        dragPointer = null
        grabOffset = { x: 0, y: 0 }
        element.classList.remove('is-dragging')

        if (element.hasPointerCapture(event.pointerId)) {
            element.releasePointerCapture(event.pointerId)
        }
    }

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('pointercancel', onPointerUp)

    return {

        async setMap(source: string, mapContent: Size): Promise<void> {
            content = mapContent
            thumbnail = {
                width: NAVIGATOR_WIDTH,
                height: Math.max(1, Math.round(NAVIGATOR_WIDTH * mapContent.height / mapContent.width))
            }

            element.style.width = `${thumbnail.width}px`
            element.style.height = `${thumbnail.height}px`

            const ratio = doc.defaultView?.devicePixelRatio || 1
            canvas.width = Math.round(thumbnail.width * ratio)
            canvas.height = Math.round(thumbnail.height * ratio)
            canvas.style.width = `${thumbnail.width}px`
            canvas.style.height = `${thumbnail.height}px`

            element.hidden = false

            await bake(canvas, source, thumbnail)
        },

        update(transform: Transform, viewport: Size): void {
            if (null === content) {
                return
            }

            const scale = navigatorScale()
            const visible = viewportRectInContent(transform, viewport)
            const origin = screenToContent(transform, { x: 0, y: 0 })

            viewRect = {
                x: origin.x * scale,
                y: origin.y * scale,
                width: visible.width * scale,
                height: visible.height * scale
            }

            // Drawn clipped to the thumbnail: the rect marks how much of the *map*
            // is on screen, so at whole-map fit it frames the thumbnail exactly
            // rather than spilling into the surrounding empty space. The size is
            // never floored — a rect that stopped shrinking would over-report the
            // visible slice while still looking plausible.
            const left = clamp(viewRect.x, 0, thumbnail.width)
            const top = clamp(viewRect.y, 0, thumbnail.height)
            const right = clamp(viewRect.x + viewRect.width, 0, thumbnail.width)
            const bottom = clamp(viewRect.y + viewRect.height, 0, thumbnail.height)

            rect.style.left = `${left}px`
            rect.style.top = `${top}px`
            rect.style.width = `${right - left}px`
            rect.style.height = `${bottom - top}px`
        },

        clear(): void {
            content = null
            viewRect = null
            element.hidden = true
            canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
        },

        destroy(): void {
            element.removeEventListener('pointerdown', onPointerDown)
            element.removeEventListener('pointermove', onPointerMove)
            element.removeEventListener('pointerup', onPointerUp)
            element.removeEventListener('pointercancel', onPointerUp)
            element.remove()
        }
    }
}

/** Rasterize the prepared SVG into the thumbnail canvas. A failure costs the picture, not the affordance. */
async function bake(canvas: HTMLCanvasElement, source: string, size: Size): Promise<void> {
    const context = canvas.getContext('2d')

    if (null === context) {
        return
    }

    const url = URL.createObjectURL(new Blob([ source ], { type: 'image/svg+xml' }))

    try {
        const image = await decode(url)
        context.setTransform(canvas.width / size.width, 0, 0, canvas.height / size.height, 0, 0)
        context.clearRect(0, 0, size.width, size.height)
        context.drawImage(image, 0, 0, size.width, size.height)
    } catch {
        console.warn('Navigator thumbnail could not be baked; the viewport rect still works.')
    } finally {
        URL.revokeObjectURL(url)
    }
}

function contains(rect: Rect, point: Point): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.width &&
        point.y >= rect.y && point.y <= rect.y + rect.height
}

function decode(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('SVG could not be rasterized'))
        image.src = url
    })
}
