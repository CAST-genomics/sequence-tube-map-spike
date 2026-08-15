/**
 * Same reason `parseBands.test.ts` exists: a mis-numbered regex group yields a plausible
 * rectangle, and a coordinate conversion applied twice yields boxes that are merely upside
 * down somewhere else. The numbers below are the ones #37 measured off the fixtures before
 * anything was built, so a change in the document's grammar shows up here as a count that
 * moved rather than as a picture nobody looked at closely enough.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NonConformingDocument } from '../documentGrammar.ts'
import { parseBands } from '../parseBands.ts'
import { BOX_STROKE, parseSegmentBoxes } from '../parseSegmentBoxes.ts'

const FIXTURES = {
    small: {
        path: 'public/stm-chr1-25331046-25331646.svg',
        boxes: 75,
        width: { min: 18, median: 18, max: 77 },
        height: { min: 33, median: 5418, max: 5553 },
        sequence: { min: 1, median: 1, max: 130 }
    },
    '5520+': {
        path: 'public/stm-node-5520-chr1-25331646-25335796.svg',
        boxes: 274,
        width: { min: 18, median: 18, max: 109 },
        height: { min: 33, median: 5463, max: 6978 },
        sequence: { min: 1, median: 1, max: 1764 }
    },
    '5514+': {
        path: 'public/stm-node-5514-chr1-25301271-25309238.svg',
        boxes: 767,
        width: { min: 18, median: 18, max: 91 },
        height: { min: 33, median: 5613, max: 5688 },
        sequence: { min: 1, median: 1, max: 430 }
    }
}

/** min / median / max of a list, the shape the survey in #37 reported. */
function spread(values: number[]): { min: number, median: number, max: number } {
    const sorted = [...values].sort((a, b) => a - b)

    return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1] }
}

function read(path: string): string {
    return readFileSync(path, 'utf8')
}

describe('parseSegmentBoxes', () => {

    for (const [name, fixture] of Object.entries(FIXTURES)) {

        it(`reproduces the surveyed box dimensions for ${name}`, () => {
            const boxes = parseSegmentBoxes(read(fixture.path), { x: 0, y: 0 })

            expect(boxes).toHaveLength(fixture.boxes)
            expect(spread(boxes.map(box => box.width))).toEqual(fixture.width)
            expect(spread(boxes.map(box => box.height))).toEqual(fixture.height)
            expect(spread(boxes.map(box => box.sequence.length))).toEqual(fixture.sequence)
        })

        it(`gives every box a distinct id and a sequence for ${name}`, () => {
            const boxes = parseSegmentBoxes(read(fixture.path), { x: 0, y: 0 })

            expect(new Set(boxes.map(box => box.id)).size).toBe(boxes.length)

            for (const box of boxes) {
                expect(box.id).toMatch(/^\d+$/)
                expect(box.sequence).toMatch(/^[ACGT]+$/)
            }
        })
    }

    it('translates by the centre it is given, and nothing else', () => {
        const text = read(FIXTURES.small.path)
        const origin = parseSegmentBoxes(text, { x: 0, y: 0 })
        const centred = parseSegmentBoxes(text, { x: 100, y: 40 })

        for (let i = 0; i < origin.length; i += 1) {
            expect(centred[i].x).toBeCloseTo(origin[i].x - 100, 9)
            // y points up once the centre is applied, so the top edge moves the other way.
            expect(centred[i].y).toBeCloseTo(origin[i].y + 40, 9)
            expect(centred[i].width).toBe(origin[i].width)
            expect(centred[i].height).toBe(origin[i].height)
        }
    })

    it('reads the top edge as the larger world y, since y points up', () => {
        const boxes = parseSegmentBoxes(read(FIXTURES.small.path), { x: 0, y: 0 })

        // Every box has positive extent, and `y` names the edge the height descends from.
        for (const box of boxes) {
            expect(box.width).toBeGreaterThan(0)
            expect(box.height).toBeGreaterThan(0)
        }

        // The first box in the fixture: `M 11 20 Q 11 11 20 11 L 67 11 … L 76 5564 …`.
        expect(boxes[0].x).toBe(11)
        expect(boxes[0].y).toBe(-11)
        expect(boxes[0].width).toBe(65)
        expect(boxes[0].height).toBe(5553)
    })

    it('reads both spellings of the same rectangle', () => {
        // A box exactly 2·radius wide has no straight run along its top or bottom, so the
        // server omits the two horizontal `L` commands. 479 of `5514+`'s 767 boxes are
        // written that way, and they are every 1 bp variant in the document — the boxes it
        // would be least obvious were missing.
        const boxes = parseSegmentBoxes(read(FIXTURES['5514+'].path), { x: 0, y: 0 })
        const narrow = boxes.filter(box => box.width === 2 * box.radius)

        expect(narrow).toHaveLength(479)
        expect(boxes.length - narrow.length).toBe(288)
    })

    it('refuses the whole document when a box is off-grammar', () => {
        const text = read(FIXTURES.small.path)

        expect(() => parseSegmentBoxes(text.replace('fill-opacity: 0.4', 'fill-opacity: 0.5'), { x: 0, y: 0 }))
            .toThrow(NonConformingDocument)
    })

    it('refuses a box whose corner arithmetic does not close', () => {
        const text = read(FIXTURES.small.path)

        // The first box's opening `M 11 20`, which every other number in its outline is
        // checked against. Moved, the box is still a plausible path and no longer a rectangle.
        expect(() => parseSegmentBoxes(text.replace('d="M 11 20 Q 11 11', 'd="M 11 21 Q 11 11'), { x: 0, y: 0 }))
            .toThrow(NonConformingDocument)
    })

    it('refuses a document that drops a box from g.node', () => {
        const text = read(FIXTURES.small.path)
        // Not deleted — mangled into something the grammar cannot read, which is how a
        // silently absent variant would actually arrive.
        const broken = text.replace(' sequence="AGAGCCTGTCTTCTGCTTTTACACTTCTGGTGTCATCTTCCTTTTTTTT"', ' sequence=')

        expect(() => parseSegmentBoxes(broken, { x: 0, y: 0 })).toThrow(NonConformingDocument)
    })

    it('reads the corner radius off every box, and finds the surveyed one', () => {
        const boxes = parseSegmentBoxes(read(FIXTURES['5514+'].path), { x: 0, y: 0 })

        expect(new Set(boxes.map(box => box.radius))).toEqual(new Set([9]))
        expect(BOX_STROKE).toBe(2)
    })
})

describe('the two parsers, on one document', () => {

    for (const [name, fixture] of Object.entries(FIXTURES)) {

        it(`puts ${name}'s boxes in the same centred world frame as its bands`, () => {
            const map = parseBands(read(fixture.path))
            const boxes = parseSegmentBoxes(read(fixture.path), map.centre)

            expect(boxes).toHaveLength(fixture.boxes)

            // Inside the declared extent, like the bands — the camera frustum is built from
            // it, so a box outside it would be positioned somewhere the map is not.
            for (const box of boxes) {
                expect(box.x).toBeGreaterThanOrEqual(-map.content.width * 0.5 - 1)
                expect(box.x + box.width).toBeLessThanOrEqual(map.content.width * 0.5 + 1)
                expect(box.y).toBeLessThanOrEqual(map.content.height * 0.5 + 1)
                expect(box.y - box.height).toBeGreaterThanOrEqual(-map.content.height * 0.5 - 1)
            }
        })
    }

    it('centres the boxes on the same origin the bands are centred on', () => {
        // Both frames come from the viewBox, so this is really asking whether the centre
        // travelled between the two parsers intact — the one thing that could put a
        // perfectly-parsed box over the wrong part of a perfectly-parsed map.
        const map = parseBands(read(FIXTURES['5520+'].path))
        const boxes = parseSegmentBoxes(read(FIXTURES['5520+'].path), map.centre)

        const left = Math.min(...boxes.map(box => box.x))
        const right = Math.max(...boxes.map(box => box.x + box.width))

        expect(Math.abs(left + right)).toBeLessThan(map.content.width * 0.02)
    })
})
