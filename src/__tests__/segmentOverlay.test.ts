/**
 * The overlay itself is judged by looking at it — that is the spike's rule, and a stroke
 * that tears or a wrapper that drops tiles is not a thing a unit test can see.
 *
 * These cover the two decisions inside it that *can* be silently wrong: which boxes are
 * wide enough to be worth drawing, and what the tooltip says about the one under the
 * cursor. The first is incremental across frames, so its correctness is a claim about
 * something stateful, and this is where that claim is pinned down.
 */

import { describe, expect, it } from 'vitest'
import {
    MIN_SEGMENT_WIDTH,
    SEQUENCE_PREVIEW,
    drawnWidth,
    formatBases,
    previewSequence,
    visibleCount
} from '../segmentOverlay.ts'

/**
 * The surveyed spread of `5514+`, widest first: 288 wide boxes and 479 at the 18-unit floor,
 * each grown to the width the div actually has. That is the number the threshold gates on —
 * the drawn box is what a researcher can read and hover, so it is what "wide enough" is
 * about, and measuring the gate against the path instead would be off by a stroke.
 */
const WIDTHS = [
    ...Array.from({ length: 288 }, (_, at) => drawnWidth(box(91 - at * (91 - 19) / 287))),
    ...Array.from({ length: 479 }, () => drawnWidth(box(18)))
]

/** A box of the given path width, with the stroke every surveyed document carries. */
function box(width: number) {
    return { id: '1', sequence: 'A', x: 0, y: 0, width, height: 5613, radius: 9, stroke: 2 }
}

describe('visibleCount', () => {

    it('hides every box at fit on 5514+, and none of them at 200×', () => {
        // 177,994 units into a 1400 px viewport: an 18-unit box is 0.14 css px, and 767 of
        // those are a picket fence over the map rather than a set of segments.
        const fit = 1400 / 177993.5714285708

        expect(visibleCount(WIDTHS, fit, 0)).toBe(0)
        expect(visibleCount(WIDTHS, fit * 200, 0)).toBe(WIDTHS.length)
    })

    it('hands the boxes back largest-first as the camera closes', () => {
        let previous = 0

        for (let zoom = 0.005; zoom < 1.6; zoom *= 1.2) {
            const count = visibleCount(WIDTHS, zoom, 0)

            expect(count).toBeGreaterThanOrEqual(previous)
            previous = count
        }

        expect(previous).toBe(WIDTHS.length)
    })

    it('answers the same however far the search starts from the answer', () => {
        // The incremental walk is the whole point — 767 elements are not asked a question
        // 765 of them would answer the same way as last frame — so its independence from
        // where the last frame left off is the property worth asserting.
        for (const zoom of [0.004, 0.02, 0.08, 0.3, 1.2]) {
            const answer = visibleCount(WIDTHS, zoom, 0)

            for (const from of [0, 1, 100, 288, 500, WIDTHS.length]) {
                expect(visibleCount(WIDTHS, zoom, from)).toBe(answer)
            }
        }
    })

    it('draws a box the moment its own screen width reaches the threshold', () => {
        // Per box, not per document: the threshold is about whether *this* outline can be
        // read, so a wide box arrives while a 1 bp box beside it is still absent.
        const widths = [100, 20, 10]

        expect(visibleCount(widths, MIN_SEGMENT_WIDTH / 10, 0)).toBe(3)
        expect(visibleCount(widths, MIN_SEGMENT_WIDTH / 20, 0)).toBe(2)
        expect(visibleCount(widths, MIN_SEGMENT_WIDTH / 100, 0)).toBe(1)
        expect(visibleCount(widths, MIN_SEGMENT_WIDTH / 101, 0)).toBe(0)
    })

    it('gates on the width the element has, not the width the path had', () => {
        // The div is grown to the stroke's outer bounds, so a 18-unit box is drawn 20 units
        // wide. Gating on 18 would withhold a box that is already over the threshold.
        const drawn = drawnWidth(box(18))

        expect(drawn).toBe(20)
        expect(visibleCount([drawn], MIN_SEGMENT_WIDTH / drawn, 0)).toBe(1)
    })

    it('holds the threshold at 1.5 css pixels', () => {
        // 3 px would put the 1 bp boxes past the 200× clamp, and raising MAX_ZOOM_FACTOR is
        // a larger decision than this one.
        expect(MIN_SEGMENT_WIDTH).toBe(1.5)
    })
})

describe('the tooltip’s two rows', () => {

    it('gives the length in bases, never abbreviated', () => {
        // A segment is a handful of bases — median 1 — and `1.8 kb` would lose the one
        // number the row exists to give, which is why nodeCatalog's formatter is not reused.
        expect(formatBases(1)).toBe('1 bp')
        expect(formatBases(430)).toBe('430 bp')
        expect(formatBases(1764)).toBe('1764 bp')
    })

    it('shows a short sequence whole', () => {
        expect(previewSequence('ACGT')).toBe('ACGT')
        expect(previewSequence('A'.repeat(SEQUENCE_PREVIEW))).toBe('A'.repeat(SEQUENCE_PREVIEW))
    })

    it('truncates a long one, so nowrap and the 300 px cap never disagree', () => {
        // The longest sequence in any surveyed document is 1,764 characters. Left whole it
        // would be a tooltip wider than the screen, since `.graph-tooltip` says `nowrap`.
        const preview = previewSequence('ACGT'.repeat(441))

        expect(preview).toHaveLength(SEQUENCE_PREVIEW + 1)
        expect(preview.endsWith('…')).toBe(true)
        expect(preview.slice(0, SEQUENCE_PREVIEW)).toBe('ACGT'.repeat(441).slice(0, SEQUENCE_PREVIEW))
    })
})
