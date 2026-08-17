/**
 * The segment boxes, as HTML `<div>`s over the canvas, and the tooltip that names the one
 * under the cursor.
 *
 * They are divs because that is what they are: every child of `<g class="node">` is a
 * rectangle with quadratic corners of radius 9, `fill-opacity: 0.4` and a 2 px black stroke,
 * which `border-radius`, `background` and `border` reproduce exactly. Geometry would have
 * needed a stroked translucent material, its own draw order, a raycaster — and a DOM tooltip
 * anyway. See `docs/adr/0001-webgl-band-renderer.md`, amended 2026-08-15.
 *
 * ## Why this is not the layer that broke on 2026-08-13
 *
 * The rule that survives from that failure is stated as a mechanism, not as a medium: *no
 * DOM layer whose rasterization the browser must redo at the camera's scale over a display
 * list the size of the band population.* That population — 40,442 bands — stays on the GPU
 * permanently. This is **767 rectangles at most**, `g.node`'s entire contents, and the
 * wrapper carries **no `will-change`**, which is the property that promoted the SVG
 * surface's transformed wrapper to the layer that came apart. It is still the same *class*
 * of thing, so it is judged by looking at `5514+` at 200× rather than by argument.
 *
 * ## Nothing per box on a pan or a zoom
 *
 * One wrapper carries `translate(…) scale(zoom)`, written from the camera in the same
 * `requestAnimationFrame` that renders the canvas — see `overlayTranslation` in
 * `bandCamera.ts`. Boxes are positioned inside it once, in world units, with the
 * document's own numbers. A pan is one string.
 *
 * The one per-box decision is visibility, and it is incremental. Boxes are held sorted by
 * width, widest first, so "wide enough to be worth drawing at this zoom" is a prefix of that
 * list: a zoom step moves the boundary by however many boxes crossed it and touches nothing
 * else. At fit on `5514+` that prefix is empty and 767 sub-pixel hairlines are absent rather
 * than drawn as a picket fence over the map; closing the camera hands them back
 * largest-first, so the map resolves rather than switching on.
 *
 * ## What is not corrected
 *
 * The 2-unit stroke and the radius-9 corners scale with the camera like everything else.
 * `docs/RENDERING.md` has the numbers under *What the renderer corrects, and what it leaves
 * alone*: a scaling stroke spans 0.016 css px at fit and 3.1 px at 200×, and there was never
 * anything to fix. Nor is the arrival animated — a box reaching the threshold already has a
 * 0.17 px stroke the browser antialiases to a faint line, which thickens on its own.
 *
 * ## Pointer rules
 *
 * The boxes take real pointer events and own hover; the map's own gestures reach the root
 * regardless, because `MapControls` and the pick listeners are bound there rather than to the
 * canvas (`surfacePointer.ts`, #53). So a drag that starts on a box pans, a wheel aimed at a
 * box zooms into it, and `Shift` still feels the strand underneath — a box is an annotation
 * on the map, not a piece of chrome beside it.
 *
 * No key is needed to read one. `CONTEXT.md` #13, amended 2026-08-15: mousing over a thing
 * and being told what it is is the plainest interaction there is, and `Shift` *adds* the
 * strand emphasis rather than taking the tooltip away.
 */

import { overlayTranslation, type CameraView, type Viewport } from './bandCamera.ts'
import type { Point, Size } from './geometry.ts'
import type { SegmentBox } from './parseSegmentBoxes.ts'

/**
 * How wide a box must be on screen, in css pixels, before it is drawn at all.
 *
 * At fit on `5514+` an 18-unit box is 0.14 css px. 767 of those are a picket fence that can
 * be neither read nor hovered, so the honest correction is to withhold the box rather than
 * to inflate it. 1.5 rather than 3 because 3 would put the 1 bp boxes past the 200× clamp,
 * and raising `MAX_ZOOM_FACTOR` is a larger decision than this.
 */
export const MIN_SEGMENT_WIDTH = 1.5

/** How much of a long sequence the tooltip shows before it gives up. */
export const SEQUENCE_PREVIEW = 32

/** Where the tooltip sits relative to the cursor, in css pixels, when there is room. */
const TOOLTIP_OFFSET = { x: 14, y: 16 }

export interface SegmentOverlay {
    /** Mount one document's boxes, replacing whatever was there. */
    show(boxes: SegmentBox[]): void
    /** Place the boxes for the camera. Called from the surface's render frame. */
    update(view: CameraView, viewport: Viewport): void
    /** Empty the overlay, in the same call that empties the scene. */
    clear(): void
    destroy(): void
}

/** How wide the div drawn for `box` is, in world units.
 *
 *  Wider than the path, by half a stroke on each side. An SVG stroke straddles the path it
 *  outlines and a CSS border sits inside the box, so the two cover the same units only when
 *  the box is grown to the stroke's outer bounds. This is the number the element has, which
 *  is why it is also the number the visibility threshold is measured against. */
export function drawnWidth(box: SegmentBox): number {
    return box.width + box.stroke
}

/**
 * How many of `widths` — sorted widest first — reach `MIN_SEGMENT_WIDTH` on screen at
 * `zoom`, searched outward from `from`.
 *
 * The answer does not depend on `from`; only the work does. Sorted input makes the visible
 * set a prefix, so a zoom step walks the few boxes that crossed the boundary instead of
 * asking 767 elements a question 765 of them would answer the same way as last frame.
 */
export function visibleCount(widths: number[], zoom: number, from: number): number {
    const enough = MIN_SEGMENT_WIDTH / zoom

    let count = Math.min(Math.max(from, 0), widths.length)

    while (count < widths.length && widths[count] >= enough) {
        count += 1
    }

    while (count > 0 && widths[count - 1] < enough) {
        count -= 1
    }

    return count
}

/** `430 bp`. Never abbreviated: a segment is a handful of bases and `1.8 kb` would lose the
 *  one number the row exists to give. */
export function formatBases(bases: number): string {
    return `${bases} bp`
}

/** The sequence as the tooltip shows it, short enough that `.graph-tooltip`'s `nowrap` and
 *  `.look-tooltip`'s 300 px cap never disagree. The full 430 characters need an affordance
 *  that outlives the cursor, which is not this. */
export function previewSequence(sequence: string): string {
    return sequence.length <= SEQUENCE_PREVIEW ? sequence : `${sequence.slice(0, SEQUENCE_PREVIEW)}…`
}

export function createSegmentOverlay(root: HTMLElement): SegmentOverlay {

    const doc = root.ownerDocument

    // Positioned in world units and moved as a whole. Deliberately no `will-change`.
    const wrapper = doc.createElement('div')
    wrapper.className = 'stm-segments'

    const tooltip = doc.createElement('div')
    tooltip.className = 'graph-tooltip'

    root.append(wrapper, tooltip)

    /** One document's boxes, widest first, parallel to `elements` and `widths`. */
    let boxes: SegmentBox[] = []
    let elements: HTMLElement[] = []
    /** `drawnWidth` of each, in the same order — what the visibility threshold gates on. */
    let widths: number[] = []
    /** How many of them are currently mounted visible — the prefix `visibleCount` returns. */
    let shown = 0

    /** Which box the cursor is over, as an index into the sorted arrays, or -1. */
    let hovered = -1
    /** True from `pointerdown` to `pointerup`: a drag is a grip on the map, and a tooltip
     *  following the cursor through it is reading out boxes nobody asked about. */
    let dragging = false
    /** The surface's own corner and extent, and the tooltip's, all read on hover-enter. Kept
     *  so that moving the tooltip never reads layout back out immediately after writing it. */
    let corner: Point = { x: 0, y: 0 }
    let surface: Size = { width: 0, height: 0 }
    let size: Size = { width: 0, height: 0 }

    function segmentIndex(target: EventTarget | null): number {
        if (false === (target instanceof HTMLElement)) {
            return -1
        }

        const at = target.dataset.stmSegment

        return undefined === at ? -1 : Number(at)
    }

    function onPointerOver(event: PointerEvent): void {
        const at = segmentIndex(event.target)

        if (-1 === at || at === hovered) {
            return
        }

        hovered = at

        // A drag still moves the hover from box to box — it just does not report it. The
        // release picks the answer up from here.
        if (false === dragging) {
            reveal(event)
        }
    }

    /** Say what `hovered` is, and put it beside the cursor. */
    function reveal(event: PointerEvent): void {
        fill(boxes[hovered])

        // Both reads happen here, once per box entered, and never again while the cursor
        // travels across it — see the comment on `corner`.
        const rect = root.getBoundingClientRect()

        corner = { x: rect.left, y: rect.top }
        surface = { width: rect.width, height: rect.height }
        size = { width: tooltip.offsetWidth, height: tooltip.offsetHeight }

        place(event)
    }

    function onPointerOut(event: PointerEvent): void {
        // Only when the cursor actually left the box. `pointerout` also fires on the way to
        // a descendant, and the boxes have none — but the wrapper hears both boxes' events
        // when one is entered from another, and this is what keeps that from hiding it.
        if (segmentIndex(event.target) === hovered && -1 !== hovered) {
            leave()
        }
    }

    function leave(): void {
        hovered = -1
        tooltip.classList.remove('is-shown')
    }

    function fill(box: SegmentBox): void {
        const section = doc.createElement('div')
        section.className = 'node-section'

        const title = doc.createElement('div')
        title.className = 'node-title'
        title.textContent = box.id

        const table = doc.createElement('table')
        table.className = 'node-details-table'

        table.append(
            detailRow('Length', formatBases(box.sequence.length)),
            detailRow('Sequence', previewSequence(box.sequence))
        )

        section.append(title, table)

        const look = doc.createElement('div')
        look.className = 'look-tooltip'
        look.append(section)

        tooltip.replaceChildren(look)

        // Shown before it is placed, because `offsetWidth` on a `display: none` element is
        // zero and the clamp below is measured against it.
        tooltip.classList.add('is-shown')
    }

    function detailRow(label: string, value: string): HTMLTableRowElement {
        const row = doc.createElement('tr')
        row.className = 'node-detail-row'

        const name = doc.createElement('td')
        name.className = 'node-detail-label'
        name.textContent = label

        const detail = doc.createElement('td')
        detail.className = 'node-detail-value'
        detail.textContent = value

        row.append(name, detail)

        return row
    }

    /**
     * Follow the cursor, staying inside the surface.
     *
     * Written as a `transform` rather than as `left`/`top`: a transform does not invalidate
     * layout, so a tooltip crossing a box cannot make the surface's own
     * `getBoundingClientRect` per pointer move into a forced reflow.
     */
    function place(event: PointerEvent): void {
        const x = event.clientX - corner.x
        const y = event.clientY - corner.y

        // Flipped to the other side of the cursor rather than merely clamped: pinned against
        // the right edge it would sit under the pointer and hide the box being read.
        const left = x + TOOLTIP_OFFSET.x + size.width > surface.width
            ? Math.max(0, x - TOOLTIP_OFFSET.x - size.width)
            : x + TOOLTIP_OFFSET.x

        const top = y + TOOLTIP_OFFSET.y + size.height > surface.height
            ? Math.max(0, y - TOOLTIP_OFFSET.y - size.height)
            : y + TOOLTIP_OFFSET.y

        tooltip.style.transform = `translate(${left}px, ${top}px)`
    }

    function onPointerMove(event: PointerEvent): void {
        if (-1 !== hovered && false === dragging) {
            place(event)
        }
    }

    function onPointerDown(): void {
        dragging = true
        tooltip.classList.remove('is-shown')
    }

    function onPointerUp(event: PointerEvent): void {
        dragging = false

        // The drag may well have ended over a different box, or over none. `pointerover`
        // fired for it during the drag and set `hovered`, so this only has to say what was
        // already decided.
        if (-1 !== hovered) {
            reveal(event)
        }
    }

    wrapper.addEventListener('pointerover', onPointerOver)
    wrapper.addEventListener('pointerout', onPointerOut)
    root.addEventListener('pointermove', onPointerMove)
    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('pointerleave', leave)

    // On the document, not the root: a drag released off the surface — which is most of
    // them, since the map is dragged edge to edge — would otherwise leave `dragging` set
    // and the tooltip suppressed for the rest of the session.
    doc.addEventListener('pointerup', onPointerUp)
    doc.addEventListener('pointercancel', onPointerUp)

    return {

        show(mounted: SegmentBox[]): void {
            // Widest first, so the visibility threshold is a prefix rather than a scan.
            // Document order carries no z-order here: the boxes do not overlap.
            boxes = [...mounted].sort((a, b) => drawnWidth(b) - drawnWidth(a))
            widths = boxes.map(drawnWidth)
            elements = []
            hovered = -1
            shown = 0

            const fragment = doc.createDocumentFragment()

            for (let at = 0; at < boxes.length; at += 1) {
                const element = doc.createElement('div')
                const box = boxes[at]

                element.className = 'stm-segment'
                element.dataset.stmSegment = String(at)
                element.hidden = true

                // Grown to the stroke's outer bounds — see `drawnWidth`. The radius grows
                // with it, so the border's outer edge keeps the curve the path had.
                const inset = box.stroke * 0.5

                element.style.left = `${box.x - inset}px`
                // The wrapper lays its contents out with y down; `box.y` is the top edge
                // with y up. See `overlayTranslation`.
                element.style.top = `${-box.y - inset}px`
                element.style.width = `${drawnWidth(box)}px`
                element.style.height = `${box.height + box.stroke}px`
                element.style.borderWidth = `${box.stroke}px`
                element.style.borderRadius = `${box.radius + inset}px`

                elements.push(element)
                fragment.append(element)
            }

            wrapper.replaceChildren(fragment)
            tooltip.classList.remove('is-shown')
        },

        update(view: CameraView, viewport: Viewport): void {
            const translate = overlayTranslation(view, viewport)

            wrapper.style.transform = `translate(${translate.x}px, ${translate.y}px) scale(${view.zoom})`

            const wanted = visibleCount(widths, view.zoom, shown)

            for (; shown < wanted; shown += 1) {
                elements[shown].hidden = false
            }

            for (; shown > wanted; shown -= 1) {
                elements[shown - 1].hidden = true
            }

            // A box that shrank out of view takes its tooltip with it. `pointerout` does not
            // fire for an element that is merely hidden underneath a stationary cursor, so
            // the tooltip would otherwise stand over a box that is no longer drawn.
            if (hovered >= shown) {
                leave()
            }
        },

        clear(): void {
            boxes = []
            elements = []
            widths = []
            shown = 0
            hovered = -1

            wrapper.replaceChildren()
            tooltip.classList.remove('is-shown')
        },

        destroy(): void {
            wrapper.removeEventListener('pointerover', onPointerOver)
            wrapper.removeEventListener('pointerout', onPointerOut)
            root.removeEventListener('pointermove', onPointerMove)
            root.removeEventListener('pointerdown', onPointerDown)
            root.removeEventListener('pointerleave', leave)
            doc.removeEventListener('pointerup', onPointerUp)
            doc.removeEventListener('pointercancel', onPointerUp)

            wrapper.remove()
            tooltip.remove()
        }
    }
}
