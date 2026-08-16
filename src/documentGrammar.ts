/**
 * What the two parsers share about reading the server's document.
 *
 * `parseBands.ts` reads `g.track` and `parseSegmentBoxes.ts` reads `g.node`. They recognise
 * different grammars and produce different things, and they agree about exactly three:
 *
 * - **What a number looks like.** One pattern, so the two cannot disagree about whether
 *   `1e-5` or a leading `-` is a coordinate.
 * - **How many elements were there to read.** Both count the elements in their own slice
 *   and compare that to how many the grammar matched, because a regex that quietly skips
 *   what it cannot read is how a document loses a feature without anyone noticing.
 * - **What to do when the two numbers differ**, which is to refuse the whole document.
 *
 * That last one is the policy, and it is the same policy for both: a half-drawn map looks
 * like a correct map of different data. This API already answers an unknown node with
 * 200-and-plausible-nonsense, so partial rendering is never offered.
 */

/** A document this renderer will not draw, and why. Shown in the mount's error state. */
export class NonConformingDocument extends Error {

    constructor(message: string) {
        super(message)
        this.name = 'NonConformingDocument'
    }
}

/** One capture of a coordinate, in every spelling the documents use. */
export const NUMBER = '(-?[\\d.]+(?:[eE]-?\\d+)?)'

/**
 * How many times `needle` occurs in `text`. Non-allocating: this runs over a 346 KB slice
 * of a document whose whole point is that it is never turned into objects.
 */
export function countOccurrences(text: string, needle: string): number {
    let total = 0
    let at = text.indexOf(needle)

    while (-1 !== at) {
        total += 1
        at = text.indexOf(needle, at + needle.length)
    }

    return total
}
