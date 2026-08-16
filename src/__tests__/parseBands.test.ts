/**
 * The parser is the one part of the renderer that can be silently wrong without looking
 * wrong: a mis-numbered regex group yields plausible geometry, and a coordinate
 * conversion applied twice yields a picture that is merely upside down somewhere else.
 *
 * These run against the committed fixtures and check the counts the node survey
 * recorded, plus the conversion this copy adds.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NonConformingDocument } from '../documentGrammar.ts'
import { MAX_TRACK_ID, THICKNESS, parseBands } from '../parseBands.ts'

const FIXTURES = {
    small: { path: 'public/stm-chr1-25331046-25331646.svg', bands: 10270, tracks: 369, width: 35562.42857142856 },
    '5520+': { path: 'public/stm-node-5520-chr1-25331646-25335796.svg', bands: 40442, tracks: 464, width: 108982.57142857135 },
    '5514+': { path: 'public/stm-node-5514-chr1-25301271-25309238.svg', bands: 38423, tracks: 378, width: 177993.5714285708 }
}

describe('parseBands', () => {

    for (const [name, fixture] of Object.entries(FIXTURES)) {

        it(`reproduces the surveyed counts for ${name}`, () => {
            const map = parseBands(readFileSync(fixture.path, 'utf8'))

            expect(map.bandCount).toBe(fixture.bands)
            expect(map.trackCount).toBe(fixture.tracks)
            expect(map.content.width).toBeCloseTo(fixture.width, 6)
        })

        it(`emits world coordinates centred on the origin for ${name}`, () => {
            const map = parseBands(readFileSync(fixture.path, 'utf8'))

            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity

            for (let i = 0; i < map.bandCount; i += 1) {
                const x0 = map.geometry[i * 6]
                const y0 = map.geometry[i * 6 + 1]
                const width = map.geometry[i * 6 + 2]
                const y1 = map.geometry[i * 6 + 3]

                minX = Math.min(minX, x0)
                maxX = Math.max(maxX, x0 + width)
                minY = Math.min(minY, y0 - THICKNESS, y1 - THICKNESS)
                maxY = Math.max(maxY, y0, y1)
            }

            // Symmetric about the origin on both axes, within the margin the viewBox
            // leaves around the drawing.
            expect(Math.abs(minX + maxX)).toBeLessThan(map.content.width * 0.02)
            expect(Math.abs(minY + maxY)).toBeLessThan(map.content.height * 0.10)

            // And inside the declared extent, which is what the camera frustum is built
            // from — geometry outside it would be invisible at fit.
            expect(minX).toBeGreaterThanOrEqual(-map.content.width * 0.5 - 1)
            expect(maxX).toBeLessThanOrEqual(map.content.width * 0.5 + 1)
        })

        it(`yields well formed geometry for ${name}`, () => {
            const map = parseBands(readFileSync(fixture.path, 'utf8'))

            for (let i = 0; i < map.bandCount; i += 1) {
                const [, y0, width, y1, uTop, uBottom] =
                    Array.from(map.geometry.subarray(i * 6, i * 6 + 6))

                expect(width).toBeGreaterThan(0)
                expect(map.trackIds[i]).toBeLessThan(map.trackCount)
                expect(Number.isFinite(y0)).toBe(true)
                expect(Number.isFinite(y1)).toBe(true)

                // The control abscissae sit inside the middle 40% of the span, which is
                // what keeps x(t) monotone and per-pixel coverage well defined. Tolerance
                // is float32 storage only — the survey found u pinned to [0.30, 0.70]
                // exactly, and normalizing before the cast is what keeps that true on the
                // 177,994-unit-wide 5514+.
                for (const u of [uTop, uBottom]) {
                    expect(u).toBeGreaterThanOrEqual(0.3 - 1e-6)
                    expect(u).toBeLessThanOrEqual(0.7 + 1e-6)
                }
            }
        })
    }

    it('places tracks with no gap between them', () => {
        // Pitch 15 against thickness 15, so the map is a solid field of colour rather
        // than thin ribbons on white. This is load-bearing for what the renderer has to
        // preserve at fit scale, so it is asserted rather than remembered.
        const map = parseBands(readFileSync(FIXTURES['5520+'].path, 'utf8'))
        const first = new Map<number, number>()

        for (let i = 0; i < map.bandCount; i += 1) {
            const id = map.trackIds[i]

            if (false === first.has(id)) {
                first.set(id, map.geometry[i * 6 + 1])
            }
        }

        const ys = [...first.values()].sort((a, b) => b - a)
        const pitches = new Set<number>()

        for (let i = 1; i < ys.length; i += 1) {
            pitches.add(Number((ys[i - 1] - ys[i]).toFixed(4)))
        }

        expect([...pitches]).toEqual([THICKNESS])
    })

    it('rejects the whole document when anything in g.track is off-grammar', () => {
        const text = readFileSync(FIXTURES.small.path, 'utf8')

        expect(() => parseBands(text.replace('height="15"', 'height="16"')))
            .toThrow(NonConformingDocument)
    })

    it('says a response is not an SVG before it says anything about bands', () => {
        // The common way to arrive with the wrong bytes is an HTML error page. Diagnosing
        // that as a defect in the band grammar sends the reader hunting for a malformed
        // tube map that was never there.
        expect(() => parseBands('<!doctype html><html><body>500</body></html>'))
            .toThrow(/not an SVG document/)
    })

    it('rejects a document whose track ids are sparse', () => {
        const text = readFileSync(FIXTURES.small.path, 'utf8')

        expect(() => parseBands(text.replaceAll('trackID="0"', 'trackID="9000"')))
            .toThrow(NonConformingDocument)
    })

    it('reads the degenerate flat bands as level, mid-controlled bands', () => {
        // The `<rect>` elements are the same primitive with y0 == y1. They are a third
        // of the document and the shader draws them through the identical code path, so
        // the parser has to hand them geometry a curve shader can consume: level, and
        // with control abscissae that reproduce a straight edge.
        const map = parseBands(readFileSync(FIXTURES.small.path, 'utf8'))

        let flat = 0

        for (let i = 0; i < map.bandCount; i += 1) {
            if (map.geometry[i * 6 + 1] !== map.geometry[i * 6 + 3]) {
                continue
            }

            flat += 1

            expect(map.geometry[i * 6 + 4]).toBeCloseTo(0.5, 6)
            expect(map.geometry[i * 6 + 5]).toBeCloseTo(0.5, 6)
        }

        // Every `<rect>` in the fixture, and nothing else is level.
        expect(flat).toBe(4603)
    })

    it('rejects a track id too large for the instance buffer', () => {
        const text = readFileSync(FIXTURES.small.path, 'utf8')
        const broken = text.replaceAll('trackID="0"', `trackID="${MAX_TRACK_ID + 1}"`)

        expect(() => parseBands(broken)).toThrow(NonConformingDocument)
    })

    it('holds THICKNESS at the surveyed constant', () => {
        expect(THICKNESS).toBe(15)
    })
})
