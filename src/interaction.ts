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
 * Segment boxes paint after tracks and are hit-testable across their whole fill —
 * `fill-opacity: 0.4` does not disable pointer events. They occupy narrow vertical
 * bands and strands run horizontally, so sweeping a strand set means moving
 * vertically at a fixed x: without the rule above, some x values would silently
 * fail to highlight anything, reading as a random dead zone rather than a rule.
 */

import type { Point } from './viewportTransform.ts'

const TRACK_CLASS_PATTERN = /^track\d+$/
const ZOOM_SENSITIVITY = 0.01

export interface InteractionOptions {
    /** Carries the mode class and hosts the swapped highlight rule. */
    root: HTMLElement
    /** The clipping viewport: wheel target and tooltip frame. */
    surface: HTMLElement
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

    const highlightStyle = doc.createElement('style')
    root.append(highlightStyle)

    const tooltip = doc.createElement('div')
    tooltip.className = 'stm-tooltip'
    tooltip.hidden = true
    surface.append(tooltip)

    const selected = new Set<string>()
    let feeling = false
    let lastPointer: Point | null = null

    function applyHighlight(): void {
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

    function enterFeelerMode(): void {
        if (feeling) {
            return
        }

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

        if (event.ctrlKey) {
            // macOS synthesizes ctrl+wheel for a trackpad pinch.
            options.onZoom(localPoint(event), Math.exp(-event.deltaY * ZOOM_SENSITIVITY))
            return
        }

        options.onPan(-event.deltaX, -event.deltaY)
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
    view.addEventListener('keydown', onKeyDown)
    view.addEventListener('keyup', onKeyUp)
    view.addEventListener('blur', onWindowBlur)

    return {

        reset(): void {
            leaveFeelerMode()
            lastPointer = null
        },

        destroy(): void {
            surface.removeEventListener('pointermove', onPointerMove)
            surface.removeEventListener('pointerleave', onPointerLeave)
            surface.removeEventListener('wheel', onWheel)
            view.removeEventListener('keydown', onKeyDown)
            view.removeEventListener('keyup', onKeyUp)
            view.removeEventListener('blur', onWindowBlur)
            highlightStyle.remove()
            tooltip.remove()
        }
    }
}
