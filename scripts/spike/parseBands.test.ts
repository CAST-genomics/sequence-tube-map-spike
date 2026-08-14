/**
 * The parser is the one part of the spike that can be silently wrong without
 * looking wrong: a mis-numbered regex group yields plausible geometry. These run
 * against the committed fixtures and check the counts the node survey recorded.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NonConformingDocument, THICKNESS, parseBands } from './parseBands.ts'

const FIXTURES = {
    // 10,270 bands, not the 10,345 drawables CONTEXT.md counts: the difference is the
    // 75 segment boxes in g.node, which the parser deliberately never sees.
    small: { path: 'public/stm-chr1-25331046-25331646.svg', bands: 10270, tracks: 369, width: 35562.42857142856 },
    '5520+': { path: 'public/stm-node-5520-chr1-25331646-25335796.svg', bands: 40442, tracks: 464, width: 108982.57142857135 },
    '5514+': { path: 'public/stm-node-5514-chr1-25301271-25309238.svg', bands: 38423, tracks: 378, width: 177993.5714285708 }
}

describe('parseBands', () => {

    for (const [name, fixture] of Object.entries(FIXTURES)) {

        it(`reproduces the surveyed counts for ${name}`, () => {
            const parsed = parseBands(readFileSync(fixture.path, 'utf8'))

            expect(parsed.bandCount).toBe(fixture.bands)
            expect(parsed.trackCount).toBe(fixture.tracks)
            expect(parsed.viewBox.width).toBeCloseTo(fixture.width, 6)
        })

        it(`yields well formed geometry for ${name}`, () => {
            const parsed = parseBands(readFileSync(fixture.path, 'utf8'))

            for (let i = 0; i < parsed.bandCount; i += 1) {
                const [, y0, width, , uTop, uBottom] = Array.from(parsed.geometry.subarray(i * 6, i * 6 + 6))

                expect(width).toBeGreaterThan(0)
                expect(parsed.trackIds[i]).toBeLessThan(parsed.trackCount)

                // The control abscissae sit inside the middle 40% of the span, which
                // is what keeps x(t) monotone and per-pixel coverage well defined.
                // Tolerance is Float32 storage only — the survey found u pinned to
                // [0.30, 0.70] exactly, and normalizing before the cast is what keeps
                // that true on the 177,994-unit-wide 5514+.
                for (const u of [uTop, uBottom]) {
                    expect(u).toBeGreaterThanOrEqual(0.3 - 1e-6)
                    expect(u).toBeLessThanOrEqual(0.7 + 1e-6)
                }

                expect(Number.isFinite(y0)).toBe(true)
            }
        })
    }

    it('finds the two edges of a curved band to have different control abscissae', () => {
        // If these ever coincide the renderer could offset one edge by THICKNESS and
        // skip half its work — they do not, and this is the assertion that says so.
        const parsed = parseBands(readFileSync(FIXTURES['5520+'].path, 'utf8'))

        let curved = 0
        let differing = 0

        for (let i = 0; i < parsed.bandCount; i += 1) {
            const g = parsed.geometry

            if (g[i * 6 + 1] === g[i * 6 + 3]) {
                continue
            }

            curved += 1

            if (g[i * 6 + 4] !== g[i * 6 + 5]) {
                differing += 1
            }
        }

        expect(curved).toBe(23430)
        expect(differing / curved).toBeGreaterThan(0.99)
    })

    it('rejects the whole document when anything in g.track is off-grammar', () => {
        const text = readFileSync(FIXTURES.small.path, 'utf8')
        const broken = text.replace('height="15"', 'height="16"')

        expect(() => parseBands(broken)).toThrow(NonConformingDocument)
    })

    it('rejects a document whose track ids are sparse', () => {
        const text = readFileSync(FIXTURES.small.path, 'utf8')
        const broken = text.replaceAll('trackID="0"', 'trackID="9000"')

        expect(() => parseBands(broken)).toThrow(NonConformingDocument)
    })

    it('holds THICKNESS at the surveyed constant', () => {
        expect(THICKNESS).toBe(15)
    })
})
