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
 * the things that are the same whichever surface draws. It owns nothing about the view:
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
import { fetchDocument, TubeMapLoadError } from './fetchDocument.ts'
import { NonConformingDocument } from './documentGrammar.ts'
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

    const renderer: SurfaceRenderer = 'svg' === options.renderer
        ? createSvgSurface(root, { strandFeeler: options.strandFeeler })
        : createBandSurface(root, { pickReadout: options.pickReadout })

    // Appended after the renderer's own nodes so the spinner and the error state cover
    // the picture rather than sitting under it.
    root.append(status)

    let pending: AbortController | null = null

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

    const observer = new ResizeObserver(() => renderer.resize())

    observer.observe(root)

    return {

        async open(url: string): Promise<void> {
            pending?.abort()
            const controller = new AbortController()
            pending = controller

            renderer.clear()
            showStatus('Loading tube map…', false)

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
                showStatus(describeFailure(url, error), true)
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

/**
 * What the error state says. It names the URL and what went wrong with it, because the
 * three ways this fails are indistinguishable from a blank surface: the node was never
 * fetchable (13 of 30 are not), the response was not a tube map, or it was a tube map
 * this renderer cannot draw.
 */
function describeFailure(url: string, error: unknown): string {
    if (error instanceof TubeMapLoadError) {
        return 'network' === error.kind
            ? `Could not load the tube map.\n${error.message}`
            : `No tube map to show.\n${error.message}\n${url}`
    }

    if (error instanceof NonConformingDocument) {
        return `This document cannot be drawn.\n${error.message}\n${url}`
    }

    return `Could not load the tube map.\n${error instanceof Error ? error.message : String(error)}\n${url}`
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
