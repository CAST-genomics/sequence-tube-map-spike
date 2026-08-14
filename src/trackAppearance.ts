/**
 * How each track looks, as a table on the GPU: one texel per haplotype, RGB plus an
 * emphasis byte.
 *
 * This replaces the per-instance colour attribute the spike shipped with, and the reason is
 * the whole of #39. Colour as an attribute means the appearance of a track lives in as many
 * places as the track has bands — 87 of them on `5520+`, scattered through the document —
 * so changing how one haplotype looks means finding and rewriting its share of a 162 KB
 * buffer. Here it means writing **one texel**. Nothing about the geometry moves, and the
 * instance buffer is never touched again after the document loads.
 *
 * ## What the cost actually is
 *
 * Lighting a track writes one byte per *track* — not per band, and not per lit track. With
 * nothing lit no track recedes, so the first touch of a sweep also has to write the other
 * 463 emphasis bytes; every touch after it writes one. Both figures are independent of how
 * many tracks are already lit, which is what makes lighting one strand and lighting two
 * hundred cost the same. The upload that follows is the whole table — 2 KB at every track
 * count the survey found — and it happens at most once per frame, because a frame is what
 * consumes it.
 *
 * That is the number that retires the ~28 ms style invalidation of the SVG surface
 * (`CONTEXT.md` #15). Measured on a real GPU in `scripts/verify_highlight.mjs`.
 *
 * ## Emphasis is alpha, and colour is never touched
 *
 * The RGB half of a texel is the document's own colour for that track and nothing ever
 * writes it again: PCLAI colour is shared vocabulary with PGB's 3D graph and its PCLAI
 * chart, and a researcher reads the three panels together
 * (`docs/DISAMBIGUATING-TRACKS.md`, constraint 1). Only emphasis moves.
 *
 * The fragment shader multiplies coverage by emphasis, so a receded band becomes a ghost of
 * itself: whatever is behind it — the ground, or a lit track it crosses — shows through.
 * Of the four treatments weighed in `docs/DISAMBIGUATING-TRACKS.md` this is "translucent",
 * chosen over desaturation because grey already means something here (`pclaiX="None"`,
 * including `GRCh38#0#chr1`) and over removal because a haplotype's path is read against
 * its neighbours. The risk that document names is real and specific — at fit the map is
 * already washed toward white, so receding the crowd could leave the lit strand with
 * nothing to sit against — which is why `RECEDED` is a value that was looked at rather than
 * a constant chosen for its roundness.
 *
 * ## Why a 256-wide grid rather than one long row
 *
 * `MAX_TEXTURE_SIZE` is only guaranteed to be 2048 in WebGL2, and the parser admits track
 * ids up to 65535, so a table one texel high is a table that works until it doesn't. A row
 * of 256 caps the width and puts the whole admissible range inside 256 rows. The height
 * comes from the document's own track count — 369, 378 and 464 all occur, and nothing here
 * may assume one of them.
 */

import { DataTexture, NearestFilter } from 'three'
import type { ParsedMap } from './parseBands.ts'

/** Texels per row. See the note above: not a document quantity, a texture-size bound. */
export const APPEARANCE_ROW = 256

/**
 * The emphasis byte has three states, not two, and the third is why.
 *
 * `PLAIN` is a map with nothing lit: every track is drawn exactly as the document drew it,
 * which is the state the surface is in whenever `Shift` is not held.
 *
 * `RECEDED` is a track the feeler has not touched, once something has been touched. 8% is
 * dim enough that a lit strand reads out of a crowd of 463 instantly, and not so dim that
 * the crowd stops being there — the envelope of the bundle is the context that makes a
 * single path meaningful.
 *
 * `EMPHASIZED` is a track the feeler has touched, and it is a state of its own rather than
 * "the ones that are not receded" because receding the crowd is not sufficient at fit —
 * looked at, not predicted. A band is 0.59 css pixels tall at fit on the fixture, so the
 * most ink it can put anywhere is 59% of its colour and a lit strand starts out washed
 * before the crowd is even considered. The fragment shader draws a band in this state as
 * though it were **at least one pixel thick**; past one pixel per band that does nothing at
 * all. See `FRAGMENT` in `bandSurface.ts`.
 *
 * This is not brightening the one instead of dimming the others (`CONTEXT.md` #15): it never
 * touches colour, and it can only ever give a sub-pixel band the ink a pixel-tall band of
 * the same colour would already have had.
 */
export const PLAIN = 255
export const EMPHASIZED = 128
export const RECEDED = 20

/** The document's appearance table, and the only thing highlighting writes. */
export interface TrackAppearance {
    /** Sampled by track id in the vertex shader. `uAppearanceRow` texels per row. */
    texture: DataTexture
    width: number
    height: number
    /** How many tracks are currently lit. Harness instrumentation reads it. */
    litCount(): number
    /** Light `trackId`, receding everything else. True if the table changed. */
    light(trackId: number): boolean
    /** Drop every highlight, restoring the document's own appearance. True if it changed. */
    clear(): boolean
    dispose(): void
}

export function createTrackAppearance(
    map: Pick<ParsedMap, 'trackColors' | 'trackCount'>
): TrackAppearance {

    const { trackCount } = map
    const width = APPEARANCE_ROW
    const height = Math.max(1, Math.ceil(trackCount / APPEARANCE_ROW))
    const data = new Uint8Array(width * height * 4)

    // Padding texels beyond the last track are never sampled — ids come from the document
    // — but they are left plain rather than receded so that a table dumped for debugging
    // reads as "nothing is emphasized" rather than as a partially receded map.
    data.fill(PLAIN)

    for (let id = 0; id < trackCount; id += 1) {
        const at = texelOf(id, width)

        data[at] = map.trackColors[id * 3]
        data[at + 1] = map.trackColors[id * 3 + 1]
        data[at + 2] = map.trackColors[id * 3 + 2]
    }

    const texture = new DataTexture(data, width, height)

    // Nearest, and no mipmaps: the shader reads exact texels by integer id, so any
    // filtering here would only be a chance to blend two haplotypes' appearance together.
    texture.magFilter = NearestFilter
    texture.minFilter = NearestFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true

    const lit = new Set<number>()

    /** Write the emphasis column: a plain map, or the lit set against a receded one. */
    function writeEmphasis(): void {
        const nothingLit = 0 === lit.size

        for (let id = 0; id < trackCount; id += 1) {
            data[texelOf(id, width) + 3] = nothingLit
                ? PLAIN
                : lit.has(id) ? EMPHASIZED : RECEDED
        }

        texture.needsUpdate = true
    }

    return {

        texture,
        width,
        height,

        litCount(): number {
            return lit.size
        },

        light(trackId: number): boolean {
            // A sweep crosses the same haplotype over and over — it is 87 bands wide on
            // `5520+` — so the common case is a touch that changes nothing, and saying so
            // is what keeps a held pointer from uploading the same table every frame.
            if (0 > trackId || trackId >= trackCount || lit.has(trackId)) {
                return false
            }

            lit.add(trackId)
            writeEmphasis()

            return true
        },

        clear(): boolean {
            if (0 === lit.size) {
                return false
            }

            lit.clear()
            writeEmphasis()

            return true
        },

        dispose(): void {
            texture.dispose()
        }
    }
}

/** Where a track's texel starts, in bytes. The vertex shader's addressing, in TypeScript. */
function texelOf(trackId: number, width: number): number {
    return (Math.floor(trackId / APPEARANCE_ROW) * width + trackId % APPEARANCE_ROW) * 4
}
