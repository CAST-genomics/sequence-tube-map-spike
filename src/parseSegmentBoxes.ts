/**
 * Segment-box parser — the second and last thing the WebGL surface reads out of the
 * server's document.
 *
 * `parseBands.ts` slices the document at `<g class="node">` and reads what comes before it.
 * This reads what comes after: the translucent, black-stroked outlines that mark where each
 * sequence segment sits. They are drawn as HTML `<div>`s rather than as geometry
 * (`docs/adr/0001-webgl-band-renderer.md`, amended 2026-08-15), which is possible because
 * every one of them is literally a rounded rectangle:
 *
 *     M 11 20 Q 11 11 20 11 L 67 11 Q 76 11 76 20 L 76 5555 Q 76 5564 67 5564
 *     L 20 5564 Q 11 5564 11 5555 L 11 20
 *
 * — left 11, top 11, right 76, bottom 5564, corners of radius 9. Nothing about that needs a
 * path renderer, and `border-radius` reproduces it exactly.
 *
 * ## Two spellings of one rectangle
 *
 * A box exactly `2·radius` wide has no straight run along its top or bottom edge, so the
 * server omits the two horizontal `L` commands and the corners meet:
 *
 *     M 2138.14 35 Q 2138.14 26 2147.14 26 Q 2156.14 26 2156.14 35 L 2156.14 5630 …
 *
 * That is not a different shape and it is not an edge case — **479 of `5514+`'s 767 boxes
 * are written that way**, and they are every 1 bp variant in the document. One grammar with
 * two optional runs, rather than two grammars, so the arithmetic that checks the corners is
 * written once.
 *
 * ## Refusal is the same policy as for bands
 *
 * Anything in `g.node` the grammar cannot read refuses the whole document. A silently
 * absent box is a variant nobody would notice was missing, and the short boxes — the ones
 * only a few samples carry — are exactly the ones hardest to miss the absence of. The
 * grammar's own redundancy is the check: every number in the outline but five is a copy or
 * a `±radius` of one of the others, so reading five and verifying twenty-one turns "the
 * survey said 100%" into something each document re-establishes for itself.
 *
 * ## Coordinates
 *
 * Converted here, once, into the same world frame `parseBands.ts` emits: y up, centred on
 * the origin. So `y` names the box's **top** edge and `height` descends from it — the same
 * convention the bands' `y0`/`y1` follow, and nothing downstream knows the source was SVG.
 */

import { NUMBER as N, NonConformingDocument, countOccurrences } from './documentGrammar.ts'
import type { Point } from './viewportTransform.ts'

/** One segment's outline, in world units: y up, centred on whatever centre was given. */
export interface SegmentBox {
    /** The segment's id, as the document spells it. Shown in the tooltip. */
    id: string
    /** The segment's sequence, verbatim. Its length is the segment's length in bases. */
    sequence: string
    /** Left edge. */
    x: number
    /** Top edge — the larger world y, since y points up. */
    y: number
    width: number
    /** Extent downward from `y`. */
    height: number
    /** Corner radius, in the same units. 9 in every surveyed document; read, not assumed. */
    radius: number
    /** How wide the outline's stroke is, in the same units. 2 everywhere surveyed; read for
     *  the same reason the radius is — the overlay has to lay a CSS border over exactly the
     *  units the SVG stroke covered, and a number nobody read is a number that can be wrong. */
    stroke: number
}

/**
 * The outline, as the numbers arrive. The two `(?:L …)?` runs are the horizontal edges,
 * which vanish when the box is exactly as wide as its corners are round.
 */
const OUTLINE = `M ${N} ${N} Q ${N} ${N} ${N} ${N} (?:L ${N} ${N} )?Q ${N} ${N} ${N} ${N} `
    + `L ${N} ${N} Q ${N} ${N} ${N} ${N} (?:L ${N} ${N} )?Q ${N} ${N} ${N} ${N} L ${N} ${N}`

/**
 * The colours and the fill opacity are matched **literally**: an appearance this does not
 * describe is a document to refuse rather than one to reproduce, and the overlay's stylesheet
 * carries exactly these three declarations back. The stroke *width* is captured instead,
 * because it is a dimension, and dimensions are read.
 */
const STYLE = 'fill: rgb\\(255, 255, 255\\); fill-opacity: 0\\.4; '
    + `stroke: rgb\\(0, 0, 0\\); stroke-width: ${N}px;`

const BOX = new RegExp(`<path id="(\\d+)" d="${OUTLINE}" sequence="([^"]*)" style="${STYLE}"`, 'g')

/**
 * Where each of the outline's 26 numbers sits in the match, counted from the first one.
 * Absent optional runs read as `undefined`, which is how `HORIZONTAL_TOP` doubles as the
 * test for which spelling this box used.
 */
const MOVE = 0            // left, top + radius
const CORNER_TOP_LEFT = 2 // left, top  →  left + radius, top
const HORIZONTAL_TOP = 6  // right - radius, top
const CORNER_TOP_RIGHT = 8 // right, top  →  right, top + radius
const VERTICAL_RIGHT = 12 // right, bottom - radius
const CORNER_LOW_RIGHT = 14 // right, bottom  →  right - radius, bottom
const HORIZONTAL_LOW = 18 // left + radius, bottom
const CORNER_LOW_LEFT = 20 // left, bottom  →  left, bottom - radius
const VERTICAL_LEFT = 24  // left, top + radius

/** Where the numbers start in the match, after the `id` capture. */
const FIRST_NUMBER = 2

/** The captures after the outline's 26 numbers: the sequence, then the stroke width. */
const SEQUENCE = FIRST_NUMBER + 26
const STROKE = SEQUENCE + 1

/**
 * Every segment box in the document, in document order.
 *
 * `centre` is the viewBox's centre in the document's own units — the same translation
 * `parseBands.ts` applies, passed in rather than re-derived so the boxes and the bands
 * cannot end up in two different frames.
 */
export function parseSegmentBoxes(text: string, centre: Point): SegmentBox[] {
    const start = text.indexOf('<g class="node"')

    // No node group is no segments. That is not the same thing as a group whose contents
    // cannot be read, which is refused below — this is a document that drew none.
    if (-1 === start) {
        return []
    }

    const node = text.slice(start)
    const expected = countOccurrences(node, '<path')
    const boxes: SegmentBox[] = []

    let match: RegExpExecArray | null

    BOX.lastIndex = 0

    while (null !== (match = BOX.exec(node))) {
        boxes.push(readBox(match, centre))
    }

    if (boxes.length !== expected) {
        throw new NonConformingDocument(
            `${expected - boxes.length} of ${expected} segment boxes in g.node do not match the box grammar.`
        )
    }

    return boxes
}

function readBox(match: RegExpExecArray, centre: Point): SegmentBox {
    const at = (index: number): number => +match[FIRST_NUMBER + index]
    const present = (index: number): boolean => undefined !== match[FIRST_NUMBER + index]

    const left = at(MOVE)
    const top = at(CORNER_TOP_LEFT + 1)
    const right = at(CORNER_TOP_RIGHT)
    const bottom = at(CORNER_LOW_RIGHT + 1)
    const radius = at(MOVE + 1) - top

    const expect = (index: number, wanted: number, what: string): void => {
        if (at(index) !== wanted) {
            throw new NonConformingDocument(`segment box ${match[1]} ${what}: ${at(index)}, expected ${wanted}.`)
        }
    }

    if (false === (radius > 0)) {
        throw new NonConformingDocument(`segment box ${match[1]} has corner radius ${radius}; it must be positive.`)
    }

    // Both runs are omitted together or not at all, and only for a box as wide as its
    // corners are round. A box shorter than its corners are round would need the *vertical*
    // runs omitted too; none exists — the shortest in any surveyed document is 33 against a
    // radius of 9 — so that spelling is refused rather than guessed at.
    const square = right - left === 2 * radius

    if (present(HORIZONTAL_TOP) === square || present(HORIZONTAL_LOW) === square) {
        throw new NonConformingDocument(
            `segment box ${match[1]} is ${right - left} wide with radius ${radius}, and spells its edges inconsistently.`
        )
    }

    expect(CORNER_TOP_LEFT, left, 'top-left control abscissa')
    expect(CORNER_TOP_LEFT + 2, left + radius, 'top-left corner end abscissa')
    expect(CORNER_TOP_LEFT + 3, top, 'top-left corner end ordinate')

    if (false === square) {
        expect(HORIZONTAL_TOP, right - radius, 'top edge end abscissa')
        expect(HORIZONTAL_TOP + 1, top, 'top edge ordinate')
        expect(HORIZONTAL_LOW, left + radius, 'bottom edge end abscissa')
        expect(HORIZONTAL_LOW + 1, bottom, 'bottom edge ordinate')
    }

    expect(CORNER_TOP_RIGHT + 1, top, 'top-right control ordinate')
    expect(CORNER_TOP_RIGHT + 2, right, 'top-right corner end abscissa')
    expect(CORNER_TOP_RIGHT + 3, top + radius, 'top-right corner end ordinate')

    expect(VERTICAL_RIGHT, right, 'right edge abscissa')
    expect(VERTICAL_RIGHT + 1, bottom - radius, 'right edge end ordinate')

    expect(CORNER_LOW_RIGHT, right, 'bottom-right control abscissa')
    expect(CORNER_LOW_RIGHT + 2, right - radius, 'bottom-right corner end abscissa')
    expect(CORNER_LOW_RIGHT + 3, bottom, 'bottom-right corner end ordinate')

    expect(CORNER_LOW_LEFT, left, 'bottom-left control abscissa')
    expect(CORNER_LOW_LEFT + 1, bottom, 'bottom-left control ordinate')
    expect(CORNER_LOW_LEFT + 2, left, 'bottom-left corner end abscissa')
    expect(CORNER_LOW_LEFT + 3, bottom - radius, 'bottom-left corner end ordinate')

    expect(VERTICAL_LEFT, left, 'left edge abscissa')
    expect(VERTICAL_LEFT + 1, top + radius, 'closing ordinate')

    if (false === (right - left >= 2 * radius) || false === (bottom - top >= 2 * radius)) {
        throw new NonConformingDocument(
            `segment box ${match[1]} is ${right - left} by ${bottom - top}, smaller than its radius ${radius} allows.`
        )
    }

    const stroke = +match[STROKE]

    if (false === (stroke > 0)) {
        throw new NonConformingDocument(`segment box ${match[1]} has stroke width ${stroke}; it must be positive.`)
    }

    return {
        id: match[1],
        sequence: match[SEQUENCE],
        x: left - centre.x,
        y: centre.y - top,
        width: right - left,
        height: bottom - top,
        radius,
        stroke
    }
}
