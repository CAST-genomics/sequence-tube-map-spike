/**
 * The appearance table is the one part of highlighting that can be silently wrong.
 *
 * Everything else about feeler mode is judged by looking — a highlight that fails to read
 * is visible immediately. These are not: a table indexed by the wrong row width lights a
 * different haplotype than the cursor touched, and both pictures look like working
 * highlighting; a table sized from a constant works on every document with fewer tracks
 * than the constant and truncates the rest; and an emphasis column that forgets to restore
 * leaves a map permanently receded with nothing lit.
 */

import { describe, expect, it } from 'vitest'
import {
    APPEARANCE_ROW,
    EMPHASIZED,
    PLAIN,
    RECEDED,
    createTrackAppearance,
    type TrackAppearance
} from '../trackAppearance.ts'

/** A document of `trackCount` tracks, track `i` coloured `rgb(i, 2i, 3i)`. */
function document(trackCount: number): { trackColors: Uint8Array, trackCount: number } {
    const trackColors = new Uint8Array(trackCount * 3)

    for (let id = 0; id < trackCount; id += 1) {
        trackColors[id * 3] = id % 256
        trackColors[id * 3 + 1] = (id * 2) % 256
        trackColors[id * 3 + 2] = (id * 3) % 256
    }

    return { trackColors, trackCount }
}

/** The table itself. `image.data` is typed as a bare view; every byte in it is a texel byte. */
function bytes(appearance: TrackAppearance): Uint8Array {
    return appearance.texture.image.data as Uint8Array
}

/** The four bytes the shader will fetch for `trackId`, addressed the way it addresses them. */
function texel(appearance: TrackAppearance, trackId: number): number[] {
    const data = bytes(appearance)
    const at = ((trackId / APPEARANCE_ROW | 0) * appearance.width + trackId % APPEARANCE_ROW) * 4

    return Array.from(data.subarray(at, at + 4))
}

describe('createTrackAppearance', () => {

    it('sizes the table from the document, not from a constant', () => {
        // The three track counts the survey actually found. None of them may be assumed.
        for (const trackCount of [369, 378, 464]) {
            const appearance = createTrackAppearance(document(trackCount))

            expect(appearance.width).toBe(APPEARANCE_ROW)
            expect(appearance.height).toBe(Math.ceil(trackCount / APPEARANCE_ROW))
            expect(bytes(appearance).length).toBe(appearance.width * appearance.height * 4)

            // Every track has a texel of its own, including the last one.
            expect(texel(appearance, trackCount - 1).slice(0, 3))
                .toEqual([(trackCount - 1) % 256, (trackCount - 1) * 2 % 256, (trackCount - 1) * 3 % 256])
        }
    })

    it('is a couple of kilobytes at every real track count', () => {
        for (const trackCount of [369, 378, 464]) {
            expect(bytes(createTrackAppearance(document(trackCount))).length).toBe(2048)
        }
    })

    it('carries the document colours, undimmed, with nothing lit', () => {
        const appearance = createTrackAppearance(document(464))

        expect(appearance.litCount()).toBe(0)
        expect(texel(appearance, 0)).toEqual([0, 0, 0, PLAIN])
        expect(texel(appearance, 7)).toEqual([7, 14, 21, PLAIN])
        expect(texel(appearance, 463)).toEqual([463 % 256, 463 * 2 % 256, 463 * 3 % 256, PLAIN])
    })

    it('recedes every track but the lit one, and accumulates', () => {
        const appearance = createTrackAppearance(document(464))

        expect(appearance.light(300)).toBe(true)
        expect(appearance.litCount()).toBe(1)
        expect(texel(appearance, 300)[3]).toBe(EMPHASIZED)
        expect(texel(appearance, 299)[3]).toBe(RECEDED)
        expect(texel(appearance, 301)[3]).toBe(RECEDED)

        expect(appearance.light(0)).toBe(true)
        expect(appearance.litCount()).toBe(2)
        expect(texel(appearance, 0)[3]).toBe(EMPHASIZED)
        expect(texel(appearance, 300)[3]).toBe(EMPHASIZED)
        expect(texel(appearance, 1)[3]).toBe(RECEDED)
    })

    it('leaves the colours themselves alone — PCLAI is the map primary channel', () => {
        const appearance = createTrackAppearance(document(464))

        appearance.light(300)

        expect(texel(appearance, 300).slice(0, 3)).toEqual([300 % 256, 600 % 256, 900 % 256])
        expect(texel(appearance, 299).slice(0, 3)).toEqual([299 % 256, 598 % 256, 897 % 256])
    })

    it('reports a repeated touch as no change, so nothing is uploaded for it', () => {
        const appearance = createTrackAppearance(document(464))

        expect(appearance.light(12)).toBe(true)
        expect(appearance.light(12)).toBe(false)
        expect(appearance.litCount()).toBe(1)
    })

    it('ignores a track the document does not have', () => {
        const appearance = createTrackAppearance(document(369))

        expect(appearance.light(369)).toBe(false)
        expect(appearance.light(-1)).toBe(false)
        expect(appearance.litCount()).toBe(0)
    })

    it('restores the whole map on release, however many were lit', () => {
        const appearance = createTrackAppearance(document(464))

        for (let id = 0; id < 200; id += 1) {
            appearance.light(id)
        }

        expect(appearance.litCount()).toBe(200)
        expect(texel(appearance, 400)[3]).toBe(RECEDED)

        expect(appearance.clear()).toBe(true)
        expect(appearance.litCount()).toBe(0)

        // Not merely the ones that were lit: with nothing lit, nothing recedes.
        expect(texel(appearance, 0)[3]).toBe(PLAIN)
        expect(texel(appearance, 400)[3]).toBe(PLAIN)
        expect(texel(appearance, 463)[3]).toBe(PLAIN)

        expect(appearance.clear()).toBe(false)
    })

    it('costs the same to light the two-hundredth track as the first', () => {
        // Not a timing test — the claim is structural. Each write touches one byte per
        // track and nothing per lit track, so what it costs cannot depend on how many are
        // already lit. Timing lives in `scripts/verify_highlight.mjs`, on a real GPU.
        const appearance = createTrackAppearance(document(464))
        const touched: number[] = []
        const data = bytes(appearance)

        for (let id = 0; id < 200; id += 1) {
            const before = Array.from(data)

            appearance.light(id)

            let changed = 0

            for (let byte = 0; byte < data.length; byte += 1) {
                if (data[byte] !== before[byte]) {
                    changed += 1
                }
            }

            touched.push(changed)
        }

        // The first light moves the whole column: 463 tracks recede and the touched one
        // goes from plain to emphasized. Every light after it moves exactly one byte.
        // Neither figure grows with the size of the lit set.
        expect(touched[0]).toBe(464)
        expect(touched.slice(1)).toEqual(new Array(199).fill(1))
    })
})
