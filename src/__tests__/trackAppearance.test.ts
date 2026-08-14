/**
 * The appearance table is the one part of highlighting that can be silently wrong.
 *
 * Everything else about feeler mode is judged by looking — a highlight that fails to read is
 * visible immediately. These are not: a table indexed by the wrong row width emphasizes a
 * different haplotype than the cursor is on, and both pictures look like working
 * highlighting; a table sized from a constant works on every document with fewer tracks than
 * the constant and truncates the rest; an emphasis column that forgets to restore leaves a
 * map permanently receded with the feeler away; and a focus that fails to *un*-emphasize the
 * track it moved off is the trail-behind-the-cursor bug this file exists to keep dead.
 */

import { describe, expect, it } from 'vitest'
import {
    APPEARANCE_ROW,
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

/** Every track drawn as the document drew it, which is what the feeler away looks like. */
function nothingReceded(appearance: TrackAppearance, trackCount: number): boolean {
    for (let id = 0; id < trackCount; id += 1) {
        if (PLAIN !== texel(appearance, id)[3]) {
            return false
        }
    }

    return true
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

    it('carries the document colours, undimmed, with the feeler away', () => {
        const appearance = createTrackAppearance(document(464))

        expect(appearance.focused()).toBe(null)
        expect(texel(appearance, 0)).toEqual([0, 0, 0, PLAIN])
        expect(texel(appearance, 7)).toEqual([7, 14, 21, PLAIN])
        expect(texel(appearance, 463)).toEqual([463 % 256, 463 * 2 % 256, 463 * 3 % 256, PLAIN])
    })

    it('emphasizes one track and recedes every other', () => {
        const appearance = createTrackAppearance(document(464))

        expect(appearance.focus(300)).toBe(true)
        expect(appearance.focused()).toBe(300)
        expect(texel(appearance, 300)[3]).toBe(PLAIN)
        expect(texel(appearance, 299)[3]).toBe(RECEDED)
        expect(texel(appearance, 301)[3]).toBe(RECEDED)
        expect(texel(appearance, 0)[3]).toBe(RECEDED)
        expect(texel(appearance, 463)[3]).toBe(RECEDED)
    })

    it('does not accumulate: the track it moves off recedes with the rest', () => {
        // The behaviour this file was rewritten for. A sweep hands the emphasis along; it
        // does not leave a trail of lit tracks behind the cursor.
        const appearance = createTrackAppearance(document(464))

        appearance.focus(300)
        expect(appearance.focus(301)).toBe(true)

        expect(appearance.focused()).toBe(301)
        expect(texel(appearance, 301)[3]).toBe(PLAIN)
        expect(texel(appearance, 300)[3]).toBe(RECEDED)

        // And across a whole sweep, exactly one track is ever emphasized.
        for (let id = 0; id < 200; id += 1) {
            appearance.focus(id)

            let plain = 0

            for (let other = 0; other < 464; other += 1) {
                if (PLAIN === texel(appearance, other)[3]) {
                    plain += 1
                }
            }

            expect(plain).toBe(1)
        }
    })

    it('recedes the whole map over empty space, rather than springing back', () => {
        // A sweep crosses gaps between bands constantly. Restoring full colour in each of
        // them would strobe, and would also read as the mode switching itself off.
        const appearance = createTrackAppearance(document(464))

        appearance.focus(300)

        expect(appearance.focus(null)).toBe(true)
        expect(appearance.focused()).toBe(null)
        expect(texel(appearance, 300)[3]).toBe(RECEDED)
        expect(texel(appearance, 0)[3]).toBe(RECEDED)
        expect(nothingReceded(appearance, 464)).toBe(false)
    })

    it('recedes on the key alone, before the cursor has touched anything', () => {
        const appearance = createTrackAppearance(document(369))

        expect(appearance.focus(null)).toBe(true)
        expect(texel(appearance, 0)[3]).toBe(RECEDED)
        expect(texel(appearance, 368)[3]).toBe(RECEDED)
    })

    it('leaves the colours themselves alone — PCLAI is the map primary channel', () => {
        const appearance = createTrackAppearance(document(464))

        appearance.focus(300)

        expect(texel(appearance, 300).slice(0, 3)).toEqual([300 % 256, 600 % 256, 900 % 256])
        expect(texel(appearance, 299).slice(0, 3)).toEqual([299 % 256, 598 % 256, 897 % 256])
    })

    it('reports an unchanged focus as no change, so nothing is uploaded for it', () => {
        const appearance = createTrackAppearance(document(464))

        expect(appearance.focus(12)).toBe(true)
        expect(appearance.focus(12)).toBe(false)
        expect(appearance.focus(null)).toBe(true)
        expect(appearance.focus(null)).toBe(false)
    })

    it('treats a track the document does not have as empty space', () => {
        const appearance = createTrackAppearance(document(369))

        expect(appearance.focus(369)).toBe(true)
        expect(appearance.focused()).toBe(null)
        expect(texel(appearance, 0)[3]).toBe(RECEDED)

        expect(appearance.focus(-1)).toBe(false)
        expect(appearance.focused()).toBe(null)
    })

    it('restores the whole map when the feeler goes away', () => {
        const appearance = createTrackAppearance(document(464))

        appearance.focus(300)

        expect(appearance.release()).toBe(true)
        expect(appearance.focused()).toBe(null)
        expect(nothingReceded(appearance, 464)).toBe(true)

        expect(appearance.release()).toBe(false)
    })

    it('costs the same to move the focus as to set it, and nothing scales with the map', () => {
        // Not a timing test — the claim is structural. Each write touches one byte per track
        // and nothing per band, so what it costs cannot depend on where the focus was, where
        // it is going, or how far the cursor moved. Timing lives in
        // `scripts/verify_highlight.mjs`, on a real GPU.
        const appearance = createTrackAppearance(document(464))
        const touched: number[] = []
        const data = bytes(appearance)

        for (let id = 0; id < 200; id += 1) {
            const before = Array.from(data)

            appearance.focus(id)

            let changed = 0

            for (let byte = 0; byte < data.length; byte += 1) {
                if (data[byte] !== before[byte]) {
                    changed += 1
                }
            }

            touched.push(changed)
        }

        // The first focus recedes 463 tracks and leaves one alone. Every move after it
        // un-emphasizes one track and emphasizes another: two bytes, forever.
        expect(touched[0]).toBe(463)
        expect(touched.slice(1)).toEqual(new Array(199).fill(2))
    })
})
