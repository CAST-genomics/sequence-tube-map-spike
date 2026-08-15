/**
 * The SVG surface: the server's document attached live, panned and zoomed by a CSS
 * transform on a wrapping div, with the navigator and the pointer interactions over it.
 *
 * This is the viewer as built on 2026-08-12 and measured since. It is kept because it is
 * the only surface with per-element hit-testing — segment tooltips, strand feeling — and
 * because a document the band grammar rejects can still be looked at here. What it cannot
 * do is scale: the composited layer is 900 megapixels at dpr 2 and 14.4 gigapixels at
 * `MAX_SCALE`, which is what sent the renderer to WebGL
 * (`notes/2026-08-13-svg-rendering-hits-its-ceiling.md`).
 *
 * Everything here moved out of `tubeMapSurface.ts` unchanged when the mount learned to
 * choose between two surfaces. The mount owns the container, the fetch and the error
 * state; the view — `{x, y, scale}`, fit, the clamps, what a resize does — is this file's.
 */

import { createInteractions, type InteractionHandle } from './interaction.ts'
import { createNavigator, type NavigatorHandle } from './navigator.ts'
import { prepareTubeMap } from './svgDocument.ts'
import type { SurfaceRenderer } from './surfaceRenderer.ts'
import {
    MAX_SCALE,
    clamp,
    clampToViewport,
    fitScale,
    fitToWidth,
    pan,
    panToContentPoint,
    viewportRectInContent,
    zoomAbout,
    type Point,
    type Size,
    type Transform
} from './viewportTransform.ts'

export interface SvgSurfaceOptions {
    /**
     * Enable `Shift`-held strand feeling. Off by default: on real maps the per-hover
     * restyle of ~10,000 track elements tears and renders partially. See the note atop
     * `interaction.ts`.
     */
    strandFeeler?: boolean
}

export function createSvgSurface(host: HTMLElement, options: SvgSurfaceOptions = {}): SurfaceRenderer {

    const doc = host.ownerDocument
    const strandFeeler = true === options.strandFeeler

    const surface = doc.createElement('div')
    surface.className = 'stm-surface'

    const content = doc.createElement('div')
    content.className = 'stm-content'

    surface.append(content)
    host.append(surface)

    let contentSize: Size | null = null
    let transform: Transform | null = null
    /** True until the researcher moves the view — a resize re-fits only while the framing is still ours. */
    let untouched = true
    /** Bumped whenever the document changes, so a thumbnail baked for an old one is dropped. */
    let generation = 0
    let frame = 0

    const mapNavigator: NavigatorHandle = createNavigator(host, {
        onNavigate(center: Point): void {
            if (null === transform) {
                return
            }
            commit(panToContentPoint(transform, center, viewportSize()))
        }
    })

    const interactions: InteractionHandle = createInteractions({
        root: host,
        surface,
        strandFeeler,

        onPan(dx: number, dy: number): void {
            if (null === transform) {
                return
            }
            commit(pan(transform, dx, dy))
        },

        onZoom(cursor: Point, factor: number): void {
            if (null === transform || null === contentSize) {
                return
            }
            commit(zoomAbout(transform, cursor, factor, fitScale(contentSize, viewportSize()), MAX_SCALE))
        }
    })

    function viewportSize(): Size {
        const bounds = surface.getBoundingClientRect()
        return { width: bounds.width, height: bounds.height }
    }

    function usable(viewport: Size): boolean {
        return viewport.width > 0 && viewport.height > 0
    }

    /** The one place the view state changes: every move is clamped, stored, and drawn identically. */
    function commit(next: Transform): void {
        if (null === contentSize) {
            return
        }

        const viewport = viewportSize()

        if (false === usable(viewport)) {
            return
        }

        const scale = clamp(next.scale, fitScale(contentSize, viewport), MAX_SCALE)

        transform = clampToViewport({ ...next, scale }, contentSize, viewport)
        untouched = false

        scheduleRender()
    }

    function scheduleRender(): void {
        if (0 !== frame) {
            return
        }

        frame = requestAnimationFrame(() => {
            frame = 0
            render()
        })
    }

    function render(): void {
        if (null === transform) {
            return
        }

        content.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
        mapNavigator.update(viewportRectInContent(transform, viewportSize()))
    }

    function fit(): void {
        if (null === contentSize) {
            return
        }

        const viewport = viewportSize()

        if (false === usable(viewport)) {
            return
        }

        commit(fitToWidth(contentSize, viewport))
        untouched = true
    }

    return {

        show(text: string): void {
            const map = prepareTubeMap(text)
            const mine = generation += 1

            // The document is attached only once it is fully prepared, so the map appears
            // all at once rather than half-drawn or reflowing.
            content.style.width = `${map.content.width}px`
            content.style.height = `${map.content.height}px`
            content.replaceChildren(map.svg)

            contentSize = map.content
            fit()
            render()

            // Baking the thumbnail rasterizes the whole strip, so it lands whenever it
            // lands — and is discarded if another document arrived meanwhile.
            void mapNavigator.setMap(map.content, (canvas, size) => bake(canvas, map.source, size)).then(() => {
                if (mine === generation) {
                    render()
                }
            })
        },

        clear(): void {
            generation += 1
            interactions.reset()
            mapNavigator.clear()
            content.replaceChildren()
            content.style.removeProperty('transform')
            contentSize = null
            transform = null
            untouched = true
        },

        resize(): void {
            if (null === contentSize) {
                return
            }

            mapNavigator.relayout()

            // Resizing reveals more or less of the map rather than re-framing it — unless
            // the researcher has not yet invested in a position, in which case the opening
            // framing should stay correct.
            if (untouched || null === transform) {
                fit()
            } else {
                // Re-clamp against the new viewport; `untouched` is already false here, so
                // committing cannot change which branch a later resize takes.
                commit(transform)
            }
        },

        destroy(): void {
            if (0 !== frame) {
                cancelAnimationFrame(frame)
                frame = 0
            }

            generation += 1
            interactions.destroy()
            mapNavigator.destroy()
            surface.remove()
        }
    }
}

/**
 * Rasterize the prepared SVG into the navigator's thumbnail canvas.
 *
 * A second *live* copy of the document would roughly double the element count for
 * something rendered ~90× too small to resolve a single strand, so the thumbnail is a
 * bitmap baked once on load. This is the SVG surface's own way of filling the canvas and
 * nothing else shares it — the WebGL surface renders its own scene instead, which is why
 * the navigator asks for a painter rather than for bytes.
 */
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
    } finally {
        URL.revokeObjectURL(url)
    }
}

function decode(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('SVG could not be rasterized'))
        image.src = url
    })
}
