/**
 * The viewer's single public entry point.
 *
 * `mountTubeMapSurface(container)` renders the surface into any container and knows
 * nothing about panel chrome, cards, or PGB. Its entire input surface is
 * `open(url)`: the host constructs the URL — from a clicked minigraph node's id and
 * coordinates, or from a fixture in `public/` — and the viewer never builds one, never
 * inspects one, and never learns whether it is local or remote.
 *
 * The viewer performs no layout. The server returns a finished picture; this is a
 * viewport and interaction layer over someone else's drawing.
 *
 * ## What this file owns, and what it does not
 *
 * It owns the mounted root, the fetch and its abort, the spinner, and the error state.
 * What the error state *says* is `loadFailure.ts`, which classifies the four ways this
 * fails; the mount only draws it. It owns nothing about the view: fitting, zooming and
 * what a resize does to the framing all belong to `bandSurface.ts`, behind the four calls
 * of `BandSurface`.
 *
 * ## There is one surface, and no way to ask for another
 *
 * This mount chose between two until #40 (2026-08-16), and the choice is gone rather than
 * defaulted: no `renderer` option, no `?renderer=`, nothing to select. **A document the
 * band grammar refuses gets the error state and stops there.** That was already true —
 * the fallback was rejected 2026-08-14 and this mount never reached for the other surface
 * even while it existed, because swapping surfaces underneath the researcher would leave
 * what they are looking at depending on a validation result they never saw. What is new
 * is that there is nothing left to reach for. `CONTEXT.md` #1 and ADR `0001` carry the
 * reasoning, and the ADR records what withdrawing the fallback costs.
 */

import { createBandSurface, type BandSurface } from './bandSurface.ts'
import { fetchDocument } from './fetchDocument.ts'
import { describeFailure, type LoadFailure } from './loadFailure.ts'
import { shieldFromMap } from './surfacePointer.ts'
import { SURFACE_STYLES } from './surfaceStyles.ts'

const STYLE_ELEMENT_ID = 'stm-surface-styles'

export interface TubeMapSurfaceOptions {
    /**
     * Report the track under the cursor, with what the pick cost. Harness
     * instrumentation for #38.
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

    // The spinner and the error state cover the root edge to edge, and the surface
    // takes its gestures on the root. Without this, panning a map that is not there yet
    // would move a camera the researcher cannot see.
    shieldFromMap(status)

    container.append(root)

    // The gate belongs to the band parser, and the band parser is the only way in. "A
    // non-conforming document is refused" is therefore true of the viewer outright, with
    // no surface left that would draw one anyway.
    const surface: BandSurface = createBandSurface(root, { pickReadout: options.pickReadout })

    // Appended after the surface's own nodes so the spinner and the error state cover
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

    const observer = new ResizeObserver(() => surface.resize())

    observer.observe(root)

    return {

        async open(url: string): Promise<void> {
            pending?.abort()
            const controller = new AbortController()
            pending = controller

            surface.clear()
            showLoading()

            try {
                const text = await fetchDocument(url, controller.signal)

                if (controller.signal.aborted) {
                    return
                }

                surface.show(text)
                hideStatus()
            } catch (error) {
                if (controller.signal.aborted) {
                    return
                }

                // A document that got as far as the surface and was refused leaves
                // whatever it managed to build behind it; clearing is what guarantees the
                // error state is not read against half a map.
                surface.clear()
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
            surface.destroy()
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
