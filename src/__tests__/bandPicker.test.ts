/**
 * The pick pass answers in bytes, and the two ways to read those bytes wrongly are both
 * silent: a swapped byte order names a plausible wrong haplotype, and treating black as
 * empty space loses track 0 — which is `CHM13#0#chr1` on every document we have, a
 * reference and one of the tracks a researcher reaches for first.
 *
 * The pass itself needs a GPU and is judged by looking. This is the half that does not.
 */

import { describe, expect, it } from 'vitest'
import { decodeTrackId } from '../bandPicker.ts'

/** What the shader writes: low byte in red, high byte in green, alpha 1 for a hit. */
function hit(id: number): Uint8Array {
    return new Uint8Array([id % 256, Math.floor(id / 256), 0, 255])
}

describe('decodeTrackId', () => {

    it('reads the low byte from red and the high byte from green', () => {
        expect(decodeTrackId(hit(0))).toBe(0)
        expect(decodeTrackId(hit(1))).toBe(1)
        expect(decodeTrackId(hit(255))).toBe(255)
        expect(decodeTrackId(hit(256))).toBe(256)
        expect(decodeTrackId(hit(368))).toBe(368)
    })

    it('round-trips every id the parser will admit', () => {
        // MAX_TRACK_ID is 65535 precisely because two bytes is what this encoding has.
        for (let id = 0; id <= 65535; id += 1) {
            expect(decodeTrackId(hit(id))).toBe(id)
        }
    })

    it('does not confuse the byte order', () => {
        // 258 = 0x0102. Low first is red 2, green 1; the other way round reads 513.
        expect(decodeTrackId(new Uint8Array([2, 1, 0, 255]))).toBe(258)
    })

    it('reports empty space rather than a track', () => {
        expect(decodeTrackId(new Uint8Array([0, 0, 0, 0]))).toBeNull()
    })

    it('keeps track 0 distinguishable from empty space', () => {
        // Both are black. Only alpha separates them, which is the whole reason the pick
        // target is cleared transparent instead of to some reserved colour.
        expect(decodeTrackId(hit(0))).toBe(0)
        expect(decodeTrackId(new Uint8Array([0, 0, 0, 0]))).toBeNull()
    })
})
