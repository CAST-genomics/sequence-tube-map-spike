/**
 * The viewer's single public entry point.
 *
 * `mountTubeMapSurface(container)` renders a surface and navigator into any
 * container and knows nothing about panel chrome, cards, or PGB. Its entire input
 * surface is `open(url)`: the host constructs the URL — from a clicked minigraph
 * node's id and coordinates, or from a fixture in `public/` — and the viewer never
 * builds one, never inspects one, and never learns whether it is local or remote.
 *
 * The viewer performs no layout. The server returns a finished SVG; this is a
 * viewport and interaction layer over someone else's picture.
 */

import { createInteractions, type InteractionHandle } from './interaction.ts'
import { loadTubeMap, TubeMapLoadError } from './loadTubeMap.ts'
import { createNavigator, type NavigatorHandle } from './navigator.ts'
import { SURFACE_STYLES } from './surfaceStyles.ts'
import {
    MAX_SCALE,
    clamp,
    clampToViewport,
    fitScale,
    fitToWidth,
    pan,
    panToContentPoint,
    zoomAbout,
    type Point,
    type Size,
    type Transform
} from './viewportTransform.ts'

const STYLE_ELEMENT_ID = 'stm-surface-styles'

export interface TubeMapSurfaceOptions {
    /**
     * Enable `Shift`-held strand feeling. Off by default: on real maps the
     * per-hover restyle of ~10,000 track elements tears and renders partially.
     * See the note atop `interaction.ts`.
     */
    strandFeeler?: boolean
}

export interface TubeMapSurfaceHandle {
    /** Fetch, parse, and display the tube map at `url`. Rejects only on programmer error; load failures are shown in place. */
    open(url: string): Promise<void>
    /** Remove every listener and every node this mount created. */
    destroy(): void
}

export function mountTubeMapSurface(
    container: HTMLElement,
    options: TubeMapSurfaceOptions = {}
): TubeMapSurfaceHandle {

    const doc = container.ownerDocument
    const strandFeeler = true === options.strandFeeler

    installStyles(doc)

    const root = doc.createElement('div')
    root.className = 'stm-root'

    const surface = doc.createElement('div')
    surface.className = 'stm-surface'

    const content = doc.createElement('div')
    content.className = 'stm-content'

    const status = doc.createElement('div')
    status.className = 'stm-status'
    status.hidden = true

    surface.append(content)
    root.append(surface, status)

    // The badge announces a mode that cannot be entered unless the feeler is on,
    // so it is mounted only alongside it.
    if (strandFeeler) {
        const badge = doc.createElement('div')
        badge.className = 'stm-mode-badge'
        badge.textContent = 'feeler'
        root.append(badge)
    }
    container.append(root)

    let contentSize: Size | null = null
    let transform: Transform | null = null
    /** True until the researcher moves the view — resize re-fits only while the framing is still ours. */
    let untouched = true
    let pending: AbortController | null = null
    let frame = 0

    const mapNavigator: NavigatorHandle = createNavigator(root, {
        onNavigate(center: Point): void {
            if (null === transform) {
                return
            }
            commit(panToContentPoint(transform, center, viewportSize()))
        }
    })

    const interactions: InteractionHandle = createInteractions({
        root,
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
        mapNavigator.update(transform, viewportSize())
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

    function showStatus(message: string, isError: boolean): void {
        status.replaceChildren()
        status.classList.toggle('is-error', isError)

        const spinner = doc.createElement('div')
        spinner.className = 'stm-spinner'

        const text = doc.createElement('div')
        text.textContent = message

        status.append(spinner, text)
        status.hidden = false
    }

    function hideStatus(): void {
        status.hidden = true
        status.replaceChildren()
    }

    function clearMap(): void {
        interactions.reset()
        mapNavigator.clear()
        content.replaceChildren()
        content.style.removeProperty('transform')
        contentSize = null
        transform = null
        untouched = true
    }

    const observer = new ResizeObserver(() => {
        if (null === contentSize) {
            return
        }

        // Resizing reveals more or less of the map rather than re-framing it —
        // unless the researcher has not yet invested in a position, in which case
        // the opening framing should stay correct.
        if (untouched || null === transform) {
            fit()
        } else {
            // Re-clamp against the new viewport; `untouched` is already false here,
            // so committing cannot change which branch a later resize takes.
            commit(transform)
        }
    })

    observer.observe(surface)

    return {

        async open(url: string): Promise<void> {
            pending?.abort()
            const controller = new AbortController()
            pending = controller

            clearMap()
            showStatus('Loading tube map…', false)

            try {
                const map = await loadTubeMap(url, controller.signal)

                if (controller.signal.aborted) {
                    return
                }

                // The document is attached only once it is fully prepared, so the
                // map appears all at once rather than half-drawn or reflowing.
                content.style.width = `${map.content.width}px`
                content.style.height = `${map.content.height}px`
                content.append(map.svg)

                contentSize = map.content
                fit()
                render()
                hideStatus()

                void mapNavigator.setMap(map.source, map.content).then(() => {
                    if (false === controller.signal.aborted) {
                        render()
                    }
                })
            } catch (error) {
                if (controller.signal.aborted) {
                    return
                }

                clearMap()
                showStatus(describeFailure(error), true)
            } finally {
                if (pending === controller) {
                    pending = null
                }
            }
        },

        destroy(): void {
            pending?.abort()
            pending = null

            if (0 !== frame) {
                cancelAnimationFrame(frame)
                frame = 0
            }

            observer.disconnect()
            interactions.destroy()
            mapNavigator.destroy()
            root.remove()
        }
    }
}

function describeFailure(error: unknown): string {
    if (error instanceof TubeMapLoadError) {
        return 'network' === error.kind
            ? `Could not load the tube map.\n${error.message}`
            : `No tube map to show.\n${error.message}`
    }

    return `Could not load the tube map.\n${error instanceof Error ? error.message : String(error)}`
}

function installStyles(doc: Document): void {
    if (null !== doc.getElementById(STYLE_ELEMENT_ID)) {
        return
    }

    const style = doc.createElement('style')
    style.id = STYLE_ELEMENT_ID
    style.textContent = SURFACE_STYLES
    doc.head.append(style)
}
