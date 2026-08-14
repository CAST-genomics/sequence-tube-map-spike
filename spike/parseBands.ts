/**
 * Band parser — copied into the spike, not imported, so the zero-imports rule holds
 * without exception. Originally written for the fidelity-gate spike and verified there
 * against all three fixtures.
 *
 * Deliberately regex over raw response text, never `DOMParser`: building 40,442 DOM
 * nodes is exactly the cost this renderer exists to escape.
 *
 * A band is six floats — `x0, y0, width, y1, uTop, uBottom` — plus a `trackID`. The two
 * `u` values are the control abscissae of the *top* and *bottom* edges as a fraction of
 * the span, and they differ (0.70000 vs 0.69874 in the first band of `5520+`), so a
 * band's thickness varies along its length. The two edges are not translates of each
 * other and the "offset the top edge by THICKNESS" shortcut would be wrong.
 *
 * ## Coordinates are converted here, once
 *
 * The SVG's y points down and its origin is the viewBox corner. Three.js's y points up
 * and PGB's camera sits at the origin with a symmetric frustum. Both differences are
 * resolved *in this file* and nowhere else: nothing downstream knows the source was SVG
 * or that y ever pointed down.
 *
 *     world.x = svg.x - centreX
 *     world.y = centreY - svg.y
 *
 * So `y0` and `y1` name the band's **upper** edge, and thickness extends in **-y**.
 * Centring also halves coordinate magnitudes, which buys back a little of the float32
 * headroom that uncapped zoom spends.
 *
 * World units stay SVG user units: a band is 15 units thick and `5520+` is 108,983 wide.
 * Rescaling would buy nothing and cost a second mental model when reading numbers.
 *
 * Document order is preserved through to the instance buffer, because bands are opaque
 * and SVG paints them with the painter's algorithm — order *is* z-order.
 */

/** Constant across all 127,101 surveyed track paths, and every `<rect>` height. */
export const THICKNESS = 15

/** Largest track id the Uint16 instance buffer can hold without wrapping. */
export const MAX_TRACK_ID = 65535

export interface ParsedMap {
    /** Six floats per band, document order: x0, y0, width, y1, uTop, uBottom. World
     *  coordinates, y up, centred on the origin. `y0`/`y1` are the upper edge. */
    geometry: Float32Array
    /** One track id per band, parallel to `geometry`. */
    trackIds: Uint16Array
    bandCount: number
    /** RGB triples, one per track, indexed by track id. */
    trackColors: Uint8Array
    trackCount: number
    /** Extent of the content, in world units. Centred on the origin. */
    content: { width: number, height: number }
}

export class NonConformingDocument extends Error {

    constructor(message: string) {
        super(message)
        this.name = 'NonConformingDocument'
    }
}

const N = '(-?[\\d.]+(?:[eE]-?\\d+)?)'
const FILL = 'style="fill: rgb\\((\\d+), (\\d+), (\\d+)\\); fill-opacity: 1;" trackID="(\\d+)"'

/** A degenerate band: flat, so its control abscissae carry no information. */
const RECT = `<rect x="${N}" y="${N}" width="${N}" height="${N}" ${FILL}`

/** `M x0 y0  C cx y0 cx y1  x1 y1  V y1+15  C dx y1+15 dx y0+15  x0 y0+15  Z` */
const PATH = `<path d="M ${N} ${N} C ${N} ${N} ${N} ${N} ${N} ${N} V ${N} `
    + `C ${N} ${N} ${N} ${N} ${N} ${N} Z" ${FILL}`

const ELEMENT = new RegExp(`(?:${RECT})|(?:${PATH})`, 'g')

export function parseBands(text: string): ParsedMap {
    const viewBox = parseViewBox(text)
    const centreX = viewBox.minX + viewBox.width * 0.5
    const centreY = viewBox.minY + viewBox.height * 0.5

    // Everything before `<g class="node">` is `g.track`; the segment boxes after it are
    // the whitelisted exception and are not this renderer's business. Slicing here
    // rather than filtering later is what keeps the grammar check written against
    // `g.track` specifically.
    const trackEnd = text.indexOf('<g class="node"')
    const track = -1 === trackEnd ? text : text.slice(0, trackEnd)

    const expected = count(track, '<rect') + count(track, '<path')

    if (0 === expected) {
        throw new NonConformingDocument('No drawable elements found in g.track.')
    }

    const geometry = new Float32Array(expected * 6)
    const trackIds = new Uint16Array(expected)
    const colors = new Map<number, [number, number, number]>()

    let bands = 0
    let maxTrackId = -1
    let match: RegExpExecArray | null

    ELEMENT.lastIndex = 0

    while (null !== (match = ELEMENT.exec(track))) {
        const isRect = undefined !== match[1]

        let x0: number
        let y0: number
        let x1: number
        let y1: number
        let controlTop: number
        let controlBottom: number
        let red: number
        let green: number
        let blue: number
        let id: number

        if (isRect) {
            x0 = +match[1]
            y0 = +match[2]
            x1 = x0 + +match[3]
            y1 = y0

            if (THICKNESS !== +match[4]) {
                throw new NonConformingDocument(`rect height ${match[4]}, expected ${THICKNESS}.`)
            }

            if (0 >= +match[3]) {
                throw new NonConformingDocument(`rect width ${match[3]}; width must be positive.`)
            }

            // Flat: both edges are horizontal, so any control abscissa reproduces it.
            controlTop = x0 + (x1 - x0) * 0.5
            controlBottom = controlTop

            red = +match[5]
            green = +match[6]
            blue = +match[7]
            id = +match[8]
        } else {
            x0 = +match[9]
            y0 = +match[10]
            controlTop = +match[11]
            x1 = +match[15]
            y1 = +match[16]
            controlBottom = +match[18]

            assertGrammar(match, x0, y0, x1, y1, controlTop, controlBottom)

            red = +match[24]
            green = +match[25]
            blue = +match[26]
            id = +match[27]
        }

        // The instance buffer stores ids as Uint16. Silently wrapping would draw a
        // plausible map of the wrong haplotypes, which is the failure this parser
        // exists to refuse.
        if (id > MAX_TRACK_ID) {
            throw new NonConformingDocument(`trackID ${id} exceeds the supported maximum of ${MAX_TRACK_ID}.`)
        }

        // Normalize the control abscissae in double before the cast to float. `5514+` is
        // 177,994 units wide, where a float32 ulp is 0.0156 — enough to move a control
        // point measurably within a span of a few hundred units. Storing them as
        // fractions confines the large magnitude to `x0` alone.
        const width = x1 - x0
        const at = bands * 6

        geometry[at] = x0 - centreX
        geometry[at + 1] = centreY - y0
        geometry[at + 2] = width
        geometry[at + 3] = centreY - y1
        geometry[at + 4] = (controlTop - x0) / width
        geometry[at + 5] = (controlBottom - x0) / width
        trackIds[bands] = id

        if (false === colors.has(id)) {
            colors.set(id, [red, green, blue])
        }

        if (id > maxTrackId) {
            maxTrackId = id
        }

        bands += 1
    }

    // Anything in g.track the grammar did not match means this is not the document we
    // know how to draw. Reject the whole thing rather than render a silently incomplete
    // map — this API already returns 200-with-plausible-nonsense for an unknown node,
    // and a half-drawn map looks like a correct map of different data.
    if (bands !== expected) {
        throw new NonConformingDocument(
            `${expected - bands} of ${expected} elements in g.track do not match the band grammar.`
        )
    }

    const trackCount = maxTrackId + 1
    const trackColors = new Uint8Array(trackCount * 3)

    for (const [id, rgb] of colors) {
        trackColors[id * 3] = rgb[0]
        trackColors[id * 3 + 1] = rgb[1]
        trackColors[id * 3 + 2] = rgb[2]
    }

    if (colors.size !== trackCount) {
        throw new NonConformingDocument(
            `track ids are not dense: ${colors.size} distinct ids but a maximum of ${maxTrackId}.`
        )
    }

    return {
        geometry,
        trackIds,
        bandCount: bands,
        trackColors,
        trackCount,
        content: { width: viewBox.width, height: viewBox.height }
    }
}

/**
 * The grammar's redundancy is its own checksum: both control points of each cubic share
 * an abscissa, the cubics' ordinates repeat the endpoints, and the return edge is the
 * forward edge shifted by exactly THICKNESS. Verifying it costs nothing and turns "the
 * survey said 100%" into something this run re-establishes per document.
 */
function assertGrammar(
    match: RegExpExecArray,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    controlTop: number,
    controlBottom: number
): void {
    const expect = (actual: number, wanted: number, what: string): void => {
        if (actual !== wanted) {
            throw new NonConformingDocument(`band ${what}: ${actual}, expected ${wanted}.`)
        }
    }

    expect(+match[12], y0, 'first control ordinate')
    expect(+match[13], controlTop, 'second control abscissa')
    expect(+match[14], y1, 'second control ordinate')
    expect(+match[17], y1 + THICKNESS, 'vertical closing edge')
    expect(+match[19], y1 + THICKNESS, 'return first control ordinate')
    expect(+match[20], controlBottom, 'return second control abscissa')
    expect(+match[21], y0 + THICKNESS, 'return second control ordinate')
    expect(+match[22], x0, 'return endpoint abscissa')
    expect(+match[23], y0 + THICKNESS, 'return endpoint ordinate')

    if (false === (x1 > x0)) {
        throw new NonConformingDocument(`band spans ${x0} to ${x1}; x must increase.`)
    }
}

function parseViewBox(text: string): { minX: number, minY: number, width: number, height: number } {
    const match = /viewBox="([^"]+)"/.exec(text)

    if (null === match) {
        throw new NonConformingDocument('The document declares no viewBox.')
    }

    const parts = match[1].trim().split(/[\s,]+/).map(Number)

    if (4 !== parts.length || false === parts.every(Number.isFinite)) {
        throw new NonConformingDocument(`Unusable viewBox "${match[1]}".`)
    }

    return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] }
}

function count(text: string, needle: string): number {
    let total = 0
    let at = text.indexOf(needle)

    while (-1 !== at) {
        total += 1
        at = text.indexOf(needle, at + needle.length)
    }

    return total
}
