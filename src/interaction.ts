/**
 * Interaction — pointer and keyboard handling, mode switching, highlight rules,
 * tooltips.
 *
 * `Shift` arbitrates pointer ownership, which makes the two interaction sets
 * mutually exclusive by construction rather than by hit-test arbitration:
 *
 *                     feeler (Shift held)        inspect (Shift released)
 *   strands           own the cursor             inert
 *   segment boxes     pointer-events: none       hoverable, tooltip
 *   pan / zoom        suppressed                 live
 *
 * Pan and zoom mirror the PGB browser, which drives three.js `MapControls`: drag
 * with the primary button to pan, and wheel or Magic Mouse swipe to zoom about the
 * cursor. A researcher moves between the 3D graph and this magnifying glass
 * constantly, and a viewer that answered the same gesture differently would be a
 * standing hazard — reaching for a pan and getting a zoom.
 *
 * Segment boxes paint after tracks and are hit-testable across their whole fill —
 * `fill-opacity: 0.4` does not disable pointer events. They occupy narrow vertical
 * bands and strands run horizontally, so sweeping a strand set means moving
 * vertically at a fixed x: without the rule above, some x values would silently
 * fail to highlight anything, reading as a random dead zone rather than a rule.
 *
 * Feeler mode is **off by default** (`strandFeeler`). Swapping the highlight rule
 * is O(1) to author but not to honour: each swap invalidates style for every one of
 * the map's ~10,000 track children, each carrying an opacity transition, and a sweep
 * asks for that several times a second. Real maps tear and render partially. Nothing
 * here is tuned around that — the wall is the approach, not the constants — so the
 * mechanism stays whole behind the flag while strand selection is reconsidered as
 * something chosen indirectly (a list, or the host) rather than felt at pointer rate.
 */

import { createPointerDrag } from './pointerDrag.ts'
import { wheelZoomFactor, type Point } from './viewportTransform.ts'

const TRACK_CLASS_PATTERN = /^track\d+$/

export interface InteractionOptions {
    /** Carries the mode class and hosts the swapped highlight rule. */
    root: HTMLElement
    /** The clipping viewport: wheel target and tooltip frame. */
    surface: HTMLElement
    /** Enable `Shift`-held strand feeling. Off by default — see the note above. */
    strandFeeler?: boolean
    onPan(dx: number, dy: number): void
    onZoom(cursor: Point, factor: number): void
}

export interface InteractionHandle {
    /** Drop any highlight and leave feeler mode — used when the map is replaced or cleared. */
    reset(): void
    destroy(): void
}

export function createInteractions(options: InteractionOptions): InteractionHandle {

    const { root, surface } = options
    const doc = root.ownerDocument
    const view = doc.defaultView ?? window
    const strandFeeler = true === options.strandFeeler

    // Unmounted when the feeler is off: with no `Shift` listeners nothing can ever
    // write to it, and its absence is the plainest statement that no rule is armed.
    const highlightStyle = strandFeeler ? doc.createElement('style') : null

    if (null !== highlightStyle) {
        root.append(highlightStyle)
    }

    const tooltip = doc.createElement('div')
    tooltip.className = 'stm-tooltip'
    tooltip.hidden = true
    surface.append(tooltip)

    const selected = new Set<string>()
    let feeling = false
    let lastPointer: Point | null = null
    /** Where the dragging pointer was last seen, in client coordinates. */
    let dragFrom: Point | null = null

    function applyHighlight(): void {
        if (null === highlightStyle) {
            return
        }

        if (0 === selected.size) {
            highlightStyle.textContent = ''
            return
        }

        // One rule, swapped wholesale: highlighting is O(1) per hover regardless of
        // element count. De-emphasizing the others rather than brightening the
        // selection keeps the ancestry coloring of the selected strands undistorted.
        const exceptions = Array.from(selected, name => `:not(.${name})`).join('')
        highlightStyle.textContent = `.stm-content g.track > *${exceptions} { opacity: var(--stm-recede); }`
    }

    function showTooltip(text: string, at: Point): void {
        tooltip.textContent = text
        tooltip.hidden = false

        const bounds = surface.getBoundingClientRect()
        const width = tooltip.offsetWidth
        const height = tooltip.offsetHeight
        const x = Math.min(Math.max(0, at.x + 16), Math.max(0, bounds.width - width))
        const y = at.y - height - 12 >= 0 ? at.y - height - 12 : at.y + 20

        tooltip.style.transform = `translate(${x}px, ${y}px)`
    }

    function hideTooltip(): void {
        tooltip.hidden = true
    }

    function localPoint(event: { clientX: number, clientY: number }): Point {
        const bounds = surface.getBoundingClientRect()
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    }

    function trackClassOf(element: Element | null): string | null {
        if (null === element || false === element instanceof SVGElement) {
            return null
        }

        for (const name of Array.from(element.classList)) {
            if (TRACK_CLASS_PATTERN.test(name)) {
                return name
            }
        }

        return null
    }

    function attribute(element: Element, name: string): string | null {
        return element.getAttribute(name) ?? element.getAttribute(name.toLowerCase())
    }

    function feel(element: Element | null, at: Point): void {
        const trackClass = trackClassOf(element)

        if (null === trackClass || null === element) {
            // The selection accumulates, but the label must not: it names the strand
            // under the cursor, and there is none.
            hideTooltip()
            return
        }

        // Strands accumulate as the researcher sweeps; releasing Shift clears the set.
        if (false === selected.has(trackClass)) {
            selected.add(trackClass)
            applyHighlight()
        }

        showTooltip(attribute(element, 'trackName') ?? trackClass, at)
    }

    function inspect(element: Element | null, at: Point): void {
        if (null === element || false === element instanceof SVGElement) {
            hideTooltip()
            return
        }

        const isSegment = true === element.parentElement?.classList.contains('node')
        const id = attribute(element, 'id')

        if (false === isSegment || null === id) {
            hideTooltip()
            return
        }

        const sequence = attribute(element, 'sequence')
        showTooltip(null === sequence ? id : `${id}   ${sequence}`, at)
    }

    const drag = createPointerDrag(surface, {

        // Primary button only, and never while the map is being felt: a drag there
        // would slide the strand out from under the cursor mid-sweep.
        accepts: (event: PointerEvent): boolean => false === feeling && 0 === event.button,

        onStart(event: PointerEvent): void {
            dragFrom = { x: event.clientX, y: event.clientY }
            root.classList.add('is-panning')
            hideTooltip()
        },

        onMove(event: PointerEvent): void {
            if (null === dragFrom) {
                return
            }

            // Screen deltas move the map one-for-one, so the point grabbed stays
            // under the cursor for the whole drag.
            options.onPan(event.clientX - dragFrom.x, event.clientY - dragFrom.y)
            dragFrom = { x: event.clientX, y: event.clientY }
        },

        onEnd(): void {
            dragFrom = null
            root.classList.remove('is-panning')
        }
    })

    function enterFeelerMode(): void {
        if (feeling) {
            return
        }

        // Shift arbitrates: a drag in flight yields to the feeler immediately.
        drag.cancel()

        feeling = true
        root.classList.add('is-feeling')
        hideTooltip()

        // Probe immediately, so holding Shift over a strand acts without a nudge.
        if (null !== lastPointer) {
            const bounds = surface.getBoundingClientRect()
            const at = lastPointer
            feel(doc.elementFromPoint(bounds.left + at.x, bounds.top + at.y), at)
        }
    }

    function leaveFeelerMode(): void {
        if (false === feeling) {
            return
        }

        feeling = false
        root.classList.remove('is-feeling')
        selected.clear()
        applyHighlight()
        hideTooltip()
    }

    function onPointerMove(event: PointerEvent): void {
        const at = localPoint(event)
        lastPointer = at

        // No hover work while dragging: the cursor is holding the map, not pointing
        // at anything in it. The pan itself is the drag's own move handler.
        if (drag.active()) {
            return
        }

        if (feeling) {
            feel(event.target as Element | null, at)
        } else {
            inspect(event.target as Element | null, at)
        }
    }

    function onPointerLeave(): void {
        lastPointer = null
        hideTooltip()
    }

    function onWheel(event: WheelEvent): void {
        // Always swallow the gesture: the surface is a map, never a scrollable page.
        event.preventDefault()

        if (feeling) {
            // The map holds still while it is being felt — the strand under the
            // cursor must not slide away mid-gesture.
            return
        }

        // Every wheel source zooms, as in PGB: a Magic Mouse swipe, a conventional
        // wheel, and the ctrl+wheel macOS synthesizes for a trackpad pinch all
        // arrive here as deltaY and are answered the same way. Horizontal deltas
        // are ignored — panning is the drag.
        options.onZoom(localPoint(event), wheelZoomFactor(event.deltaY, event.deltaMode))
    }

    function onKeyDown(event: KeyboardEvent): void {
        if ('Shift' === event.key) {
            enterFeelerMode()
        }
    }

    function onKeyUp(event: KeyboardEvent): void {
        if ('Shift' === event.key) {
            leaveFeelerMode()
        }
    }

    function onWindowBlur(): void {
        leaveFeelerMode()
    }

    surface.addEventListener('pointermove', onPointerMove)
    surface.addEventListener('pointerleave', onPointerLeave)
    surface.addEventListener('wheel', onWheel, { passive: false })

    // The only door into feeler mode. Left shut, `feeling` stays false for the
    // mount's whole life and every branch that reads it takes the inspect side —
    // the mode is unreachable rather than merely unused.
    if (strandFeeler) {
        view.addEventListener('keydown', onKeyDown)
        view.addEventListener('keyup', onKeyUp)
        view.addEventListener('blur', onWindowBlur)
    }

    return {

        reset(): void {
            leaveFeelerMode()
            drag.cancel()
            lastPointer = null
        },

        destroy(): void {
            drag.destroy()
            surface.removeEventListener('pointermove', onPointerMove)
            surface.removeEventListener('pointerleave', onPointerLeave)
            surface.removeEventListener('wheel', onWheel)
            view.removeEventListener('keydown', onKeyDown)
            view.removeEventListener('keyup', onKeyUp)
            view.removeEventListener('blur', onWindowBlur)
            highlightStyle?.remove()
            tooltip.remove()
        }
    }
}
