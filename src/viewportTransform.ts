/**
 * Viewport transform — pure, DOM-free.
 *
 * Owns `{ x, y, scale }` and every conversion that touches it. One state object
 * drives both the surface and the navigator, so the two cannot disagree.
 *
 * Content space is the tube map's own coordinate system (SVG viewBox units).
 * Screen space is CSS pixels within the surface element. The mapping is the same
 * one the CSS transform performs:
 *
 *     screen = content * scale + { x, y }
 */

export interface Transform {
    x: number
    y: number
    scale: number
}

export interface Point {
    x: number
    y: number
}

export interface Size {
    width: number
    height: number
}

export interface Rect {
    x: number
    y: number
    width: number
    height: number
}

/** Upper zoom bound: beyond 4 screen pixels per content unit there is nothing left to resolve. */
export const MAX_SCALE = 4

/** The scale at which the content's full width exactly fills the viewport. Also the lower zoom bound. */
export function fitScale(content: Size, viewport: Size): number {
    return viewport.width / content.width
}

/**
 * The opening view: the whole strip framed across the window, centered vertically
 * when it is shorter than the viewport.
 */
export function fitToWidth(content: Size, viewport: Size): Transform {
    const scale = fitScale(content, viewport)
    const renderedHeight = content.height * scale

    return {
        x: 0,
        y: renderedHeight < viewport.height ? (viewport.height - renderedHeight) / 2 : 0,
        scale
    }
}

export function pan(transform: Transform, dx: number, dy: number): Transform {
    return { x: transform.x + dx, y: transform.y + dy, scale: transform.scale }
}

/**
 * Zoom by `factor`, keeping the content point currently under `cursor` under it
 * afterwards — including when the new scale clamps, so pushing against a bound
 * never drags the picture sideways.
 */
export function zoomAbout(
    transform: Transform,
    cursor: Point,
    factor: number,
    minScale: number,
    maxScale: number
): Transform {
    const scale = clamp(transform.scale * factor, minScale, maxScale)
    const anchor = screenToContent(transform, cursor)

    return {
        x: cursor.x - anchor.x * scale,
        y: cursor.y - anchor.y * scale,
        scale
    }
}

export function screenToContent(transform: Transform, point: Point): Point {
    return {
        x: (point.x - transform.x) / transform.scale,
        y: (point.y - transform.y) / transform.scale
    }
}

export function contentToScreen(transform: Transform, point: Point): Point {
    return {
        x: point.x * transform.scale + transform.x,
        y: point.y * transform.scale + transform.y
    }
}

/** The slice of content space the viewport currently shows — what the navigator rect draws. */
export function viewportRectInContent(transform: Transform, viewport: Size): Rect {
    const origin = screenToContent(transform, { x: 0, y: 0 })

    return {
        x: origin.x,
        y: origin.y,
        width: viewport.width / transform.scale,
        height: viewport.height / transform.scale
    }
}

/** Center the viewport on a content point — the navigator's click-to-jump and drag. */
export function panToContentPoint(transform: Transform, point: Point, viewport: Size): Transform {
    return {
        x: viewport.width / 2 - point.x * transform.scale,
        y: viewport.height / 2 - point.y * transform.scale,
        scale: transform.scale
    }
}

/**
 * Keep the content covering the viewport: no empty space at an edge while the
 * content is large enough to fill it, and centered on any axis where it is not.
 */
export function clampToViewport(transform: Transform, content: Size, viewport: Size): Transform {
    return {
        x: clampAxis(transform.x, content.width * transform.scale, viewport.width),
        y: clampAxis(transform.y, content.height * transform.scale, viewport.height),
        scale: transform.scale
    }
}

function clampAxis(origin: number, renderedExtent: number, viewportExtent: number): number {
    if (renderedExtent <= viewportExtent) {
        return (viewportExtent - renderedExtent) / 2
    }

    return clamp(origin, viewportExtent - renderedExtent, 0)
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}
