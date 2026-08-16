/**
 * The viewer's single public entry point.
 *
 * `mountTubeMapSurface(container, { renderer })` renders a surface into any container and
 * knows nothing about panel chrome, cards, or PGB. Its entire input surface is
 * `open(url)`: the host constructs the URL — from a clicked minigraph node's id and
 * coordinates, or from a fixture in `public/` — and the viewer never builds one, never
 * inspects one, and never learns whether it is local or remote.
 *
 * The viewer performs no layout. The server returns a finished picture; this is a
 * viewport and interaction layer over someone else's drawing.
 *
 * ## What this file owns, and what it does not
 *
 * It owns the mounted root, the fetch and its abort, the spinner, and the error state —
 * the things that are the same whichever surface draws. What the error state *says* is
 * `loadFailure.ts`, which classifies the four ways this fails; the mount only draws it.
 * It owns nothing about the view:
 * fitting, zooming and what a resize does to the framing all belong to the renderer, and
 * the two renderers answer those in different vocabularies. See `surfaceRenderer.ts`.
 *
 * `renderer` selects between them. `webgl` is the band renderer, which is what
 * `notes/2026-08-14-three-js-renderer-verdict.md` settled on; `svg` is the original
 * surface, which stays because it is the only one with per-element hit-testing.
 *
 * **It is not a fallback and this mount will never reach for it.** A document the band
 * grammar refuses gets the error state and stops there — swapping surfaces underneath
 * the researcher would leave what they are looking at depending on a validation result
 * they never saw. Decided 2026-08-14; `CONTEXT.md` #1 carries the reasoning.
 */

import { createBandSurface } from './bandSurface.ts'
import { fetchDocument } from './fetchDocument.ts'
import { describeFailure, type LoadFailure } from './loadFailure.ts'
import { shieldFromMap } from './surfacePointer.ts'
import { SURFACE_STYLES } from './surfaceStyles.ts'
import { createSvgSurface } from './svgSurface.ts'
import type { RendererName, SurfaceRenderer } from './surfaceRenderer.ts'

const STYLE_ELEMENT_ID = 'stm-surface-styles'

export interface TubeMapSurfaceOptions {
    /** Which surface draws the map. Defaults to `webgl`. */
    renderer?: RendererName
    /**
     * Enable `Shift`-held strand feeling on the SVG surface. Off by default: on real maps
     * the per-hover restyle of ~10,000 track elements tears and renders partially.
     */
    strandFeeler?: boolean
    /**
     * Report the track under the cursor on the WebGL surface, with what the pick cost.
     * Harness instrumentation for #38; ignored by the SVG surface.
     */
    pickReadout?: boolean
}

export interface TubeMapSurfaceHandle {
    /** Fetch and display the tube map at `url`. Rejects only on programmer error; load failures are shown in place. */
    open(url: string): Promise<void>
    /** Remove every listener and every node this mount created. */
    destroy(): void
}

export function mountTubeMapSurface(
    container: HTMLElement,
    options: TubeMapSurfaceOptions = {}
): TubeMapSurfaceHandle {

    const doc = container.ownerDocument

    installStyles(doc)

    const root = doc.createElement('div')
    root.className = 'stm-root'

    const status = doc.createElement('div')
    status.className = 'stm-status'
    status.hidden = true

    // The spinner and the error state cover the root edge to edge, and the WebGL surface
    // takes its gestures on the root. Without this, panning a map that is not there yet
    // would move a camera the researcher cannot see.
    shieldFromMap(status)

    container.append(root)

    // The gate belongs to the band parser, so it is the WebGL surface that has one. The
    // SVG surface attaches whatever the server sent and draws it, which is the whole
    // reason it is still here — a document the band grammar refuses can be looked at
    // there. So "a non-conforming document is refused" is true of the surface that ships
    // and not of the one behind `?renderer=svg`, and it becomes true of the viewer
    // outright when #40 deletes that surface. Recorded rather than left to be inferred:
    // it is the last place the withdrawn fallback still half-exists.
    const renderer: SurfaceRenderer = 'svg' === options.renderer
        ? createSvgSurface(root, { strandFeeler: options.strandFeeler })
        : createBandSurface(root, { pickReadout: options.pickReadout })

    // Appended after the renderer's own nodes so the spinner and the error state cover
    // the picture rather than sitting under it.
    root.append(status)

    let pending: AbortController | null = null

    function line(className: string, text: string): HTMLElement {
        const element = doc.createElement('div')
        element.className = className
        element.textContent = text
        return element
    }

    function showLoading(): void {
        const spinner = doc.createElement('div')
        spinner.className = 'stm-spinner'

        status.replaceChildren(spinner, line('stm-status-heading', 'Loading tube map…'))
        status.classList.remove('is-error')
        status.hidden = false
    }

    /**
     * The error state, drawn as three elements rather than one string of newlines: the
     * status is laid out by CSS, which collapses them, so a pasted-together paragraph
     * arrives as a single run-on line with the heading buried in the middle of it.
     *
     * The mark is what stops this being read as a map that happens to be empty. A blank
     * surface is the one thing every failure here looks like, and the whole point of the
     * gate is that a refusal is unmistakable.
     */
    function showFailure(failure: LoadFailure): void {
        const card = doc.createElement('div')
        card.className = 'stm-status-card'

        card.append(
            line('stm-status-mark', '!'),
            line('stm-status-heading', failure.heading),
            line('stm-status-reason', failure.reason),
            line('stm-status-url', failure.url)
        )

        status.replaceChildren(card)
        status.classList.add('is-error')
        status.hidden = false
    }

    function hideStatus(): void {
        status.hidden = true
        status.replaceChildren()
    }

    const observer = new ResizeObserver(() => renderer.resize())

    observer.observe(root)

    return {

        async open(url: string): Promise<void> {
            pending?.abort()
            const controller = new AbortController()
            pending = controller

            renderer.clear()
            showLoading()

            try {
                const text = await fetchDocument(url, controller.signal)

                if (controller.signal.aborted) {
                    return
                }

                renderer.show(text)
                hideStatus()
            } catch (error) {
                if (controller.signal.aborted) {
                    return
                }

                // A document that got as far as the renderer and was refused leaves
                // whatever it managed to build behind it; clearing is what guarantees the
                // error state is not read against half a map.
                renderer.clear()
                showFailure(describeFailure(url, error))
            } finally {
                if (pending === controller) {
                    pending = null
                }
            }
        },

        destroy(): void {
            pending?.abort()
            pending = null

            observer.disconnect()
            renderer.destroy()
            root.remove()
        }
    }
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
