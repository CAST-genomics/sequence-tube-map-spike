/**
 * Who owns a pointer event once the map's listeners live on the root.
 *
 * `MapControls` and the strand feeler used to be bound to the canvas, which made the
 * question trivial: an event arriving *was* an event over the map, and `offsetX`/`offsetY`
 * were already canvas coordinates. Bound to the root — which is what keeps anything mounted
 * over the canvas from becoming a hole in pan, zoom and the feeler, since a sibling of the
 * canvas bubbles to their common ancestor and not to the canvas — neither holds. The root
 * is larger than the canvas and it also hosts the navigator, the badge and the status
 * layer, so two things have to be decided per event that the canvas decided by existing:
 *
 * 1. **Where.** The offset must come from the canvas's own bounds, because `event.target`
 *    is no longer necessarily the canvas. That is `canvasPoint`, and it is pure.
 * 2. **Whether.** Chrome layered over the map answers its own pointer events and must not
 *    also pan the map underneath itself. That is `shieldFromMap`, which both marks such an
 *    element and stops the gestures `MapControls` starts from reaching the root.
 *
 * The distinction that matters: chrome is the navigator and the status layer — surfaces
 * that sit *beside* the map in the z-order and mean something else. Overlays that annotate
 * the map, like #37's segment boxes, are not chrome: an event over one of those is an event
 * over the part of the map it covers, and it should pan, zoom and feel exactly as the bare
 * canvas does.
 *
 * The mode badge and the `?pick` readout are neither, and are marked as neither. They are
 * `pointer-events: none` in the stylesheet, so they are never an event's target and a
 * pointer "over" them is genuinely a pointer over the map underneath — which is the answer
 * the researcher wants, since they cannot interact with either. The stylesheet is what
 * decides that; a badge that ever took its own events would have to call `shieldFromMap`.
 */

import type { Point } from './geometry.ts'

/** The half-open rectangle a `DOMRect` describes, which is all `canvasPoint` reads of one. */
export interface Bounds {
    left: number
    top: number
    right: number
    bottom: number
}

/** Marks an element as chrome. Its presence anywhere up the ancestor chain answers `overChrome`. */
export const CHROME_ATTRIBUTE = 'data-stm-chrome'

/**
 * Where `client` is in css pixels from the canvas's top-left, or `null` if it is not over
 * the canvas at all.
 *
 * Half-open: the top-left corner is the origin and the far edges are outside, so the point
 * indexes the pixel under it rather than the boundary after it. A canvas with no area is
 * therefore nowhere, which is the right answer for one that has not been laid out yet.
 */
export function canvasPoint(client: Point, bounds: Bounds): Point | null {
    if (client.x < bounds.left || client.x >= bounds.right) {
        return null
    }

    if (client.y < bounds.top || client.y >= bounds.bottom) {
        return null
    }

    return { x: client.x - bounds.left, y: client.y - bounds.top }
}

/** Whether `target` is inside something that has claimed its own pointer events. */
export function overChrome(target: EventTarget | null): boolean {
    return target instanceof Element && null !== target.closest(`[${CHROME_ATTRIBUTE}]`)
}

/**
 * Declare `element` chrome: it answers its own pointer events, and the map does not also
 * answer them.
 *
 * Marking alone is enough for the handlers in this codebase, which ask `overChrome`.
 * `MapControls` cannot be asked — it binds `pointerdown`, `wheel` and `contextmenu` to
 * whatever element it was given — so those three are stopped here instead, at the element,
 * after its own listeners have had them. `contextmenu` is in the list for what it prevents
 * rather than what it starts: the controls suppress the browser's menu wherever they are
 * bound, and on the root that would mean suppressing it over the navigator and the status
 * layer, which never asked for that and used to keep it.
 *
 * Nothing else is stopped: `pointermove` still reaches the root, where it reads as the
 * cursor having left the map, which is what makes the emphasis recede when a sweep wanders
 * onto the navigator.
 *
 * No teardown, deliberately: these listeners are on the element itself and go with it.
 */
export function shieldFromMap(element: HTMLElement): void {
    element.setAttribute(CHROME_ATTRIBUTE, '')

    element.addEventListener('pointerdown', stop)
    element.addEventListener('wheel', stop)
    element.addEventListener('contextmenu', stop)
}

function stop(event: Event): void {
    event.stopPropagation()
}
