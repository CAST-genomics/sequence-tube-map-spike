/**
 * Regex band parser — the throwaway half of the fidelity gate.
 *
 * DISPOSABLE. This is spike code, rewritten properly in step 1 of the brief once
 * the fidelity verdict is in. It exists to feed the renderer, not to be the parser.
 *
 * Deliberately regex over raw response text, never `DOMParser`: building 40,442 DOM
 * nodes is exactly the cost the WebGL renderer exists to escape, so measuring that
 * would measure the wrong thing. Kill criterion #3 (parse + upload under 500 ms) is
 * only meaningful against the real bytes, in the browser, at measurement time.
 *
 * A band is six floats — `x0, y0, width, y1, uTop, uBottom` — plus a `trackID`. The
 * two `u` values are the control abscissae of the *top* and *bottom* edges expressed
 * as a fraction of the span, and they differ (0.70000 vs 0.69874 in the first band of
 * `5520+`), so a band's vertical thickness varies along its length. The two edges are
 * not translates of each other and the "offset the top edge by THICKNESS" shortcut
 * would be wrong.
 *
 * They are stored normalized rather than absolute for precision, not tidiness.
 * `5514+` is 177,994 units wide, where a Float32 ulp is 0.0156 — enough to move a
 * control point measurably within a span of a few hundred units. Normalizing in
 * double before the cast confines the large magnitude to `x0` alone, whose 0.0156
 * worst-case error is ~0.06 CSS px even at MAX_SCALE and 64x smaller than the
 * 1.0-unit lap between consecutive pieces of a track.
 *
 * Document order is preserved through to the instance buffer, because bands are
 * opaque and SVG paints them with the painter's algorithm — order *is* z-order.
 */

/** Constant across all 127,101 surveyed track paths, and every `<rect>` height. */
export const THICKNESS = 15

export interface ParsedMap {
    /** Six floats per band, document order: x0, y0, width, y1, uTop, uBottom. */
    geometry: Float32Array
    /** One track id per band, parallel to `geometry`. */
    trackIds: Uint16Array
    bandCount: number
    /** RGB triples, one per track, indexed by track id. */
    trackColors: Uint8Array
    trackCount: number
    /** viewBox, in the order the attribute states it. */
    viewBox: { minX: number, minY: number, width: number, height: number }
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

    // Everything before `<g class="node">` is `g.track`; the 274 segment boxes after
    // it are the whitelisted exception and stay as DOM in the overlay. Slicing here
    // rather than filtering later is what keeps the gate written against `g.track`.
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
        const g = match
        const isRect = undefined !== g[1]

        let x0: number, y0: number, x1: number, y1: number, cx: number, dx: number
        let r: number, gr: number, b: number, id: number

        if (isRect) {
            x0 = +g[1]
            y0 = +g[2]
            x1 = x0 + +g[3]
            y1 = y0

            if (THICKNESS !== +g[4]) {
                throw new NonConformingDocument(`rect height ${g[4]}, expected ${THICKNESS}.`)
            }

            // Flat: both edges are horizontal, so any control abscissa reproduces it.
            cx = dx = x0 + (x1 - x0) * 0.5
            r = +g[5]; gr = +g[6]; b = +g[7]; id = +g[8]

            if (0 >= +g[3]) {
                throw new NonConformingDocument(`rect width ${g[3]}; width must be positive.`)
            }
        } else {
            x0 = +g[9]
            y0 = +g[10]
            cx = +g[11]
            x1 = +g[15]
            y1 = +g[16]
            dx = +g[18]

            assertGrammar(g, x0, y0, x1, y1, cx, dx)

            r = +g[24]; gr = +g[25]; b = +g[26]; id = +g[27]
        }

        // Normalize in double, store in float: see the precision note atop this file.
        const width = x1 - x0
        const o = bands * 6
        geometry[o] = x0
        geometry[o + 1] = y0
        geometry[o + 2] = width
        geometry[o + 3] = y1
        geometry[o + 4] = (cx - x0) / width
        geometry[o + 5] = (dx - x0) / width
        trackIds[bands] = id

        if (false === colors.has(id)) {
            colors.set(id, [r, gr, b])
        }

        if (id > maxTrackId) {
            maxTrackId = id
        }

        bands += 1
    }

    // The gate: anything in g.track the grammar did not match means the document is
    // not the one we know how to draw. Reject the whole thing rather than render a
    // silently incomplete map — this API already returns 200-with-plausible-nonsense.
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

    return { geometry, trackIds, bandCount: bands, trackColors, trackCount, viewBox }
}

/**
 * The grammar's redundancy is its own checksum: both control points of each cubic
 * share an abscissa, the cubics' ordinates repeat the endpoints, and the return edge
 * is the forward edge shifted by exactly THICKNESS. Verifying it costs nothing and
 * turns "the survey said 100%" into something this run re-establishes per document.
 */
function assertGrammar(
    g: RegExpExecArray,
    x0: number, y0: number, x1: number, y1: number, cx: number, dx: number
): void {
    const expect = (actual: number, wanted: number, what: string): void => {
        if (actual !== wanted) {
            throw new NonConformingDocument(`band ${what}: ${actual}, expected ${wanted}.`)
        }
    }

    expect(+g[12], y0, 'first control ordinate')
    expect(+g[13], cx, 'second control abscissa')
    expect(+g[14], y1, 'second control ordinate')
    expect(+g[17], y1 + THICKNESS, 'vertical closing edge')
    expect(+g[19], y1 + THICKNESS, 'return first control ordinate')
    expect(+g[20], dx, 'return second control abscissa')
    expect(+g[21], y0 + THICKNESS, 'return second control ordinate')
    expect(+g[22], x0, 'return endpoint abscissa')
    expect(+g[23], y0 + THICKNESS, 'return endpoint ordinate')

    if (false === (x1 > x0)) {
        throw new NonConformingDocument(`band spans ${x0} to ${x1}; x must increase.`)
    }
}

function parseViewBox(text: string): ParsedMap['viewBox'] {
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
