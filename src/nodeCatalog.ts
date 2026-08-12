/**
 * The harness's list of openable tube maps.
 *
 * Every URL the viewer opens is derived from a minigraph node in a PGB dataset.
 * `scripts/build_node_table.py` does that derivation offline and writes
 * `data/nodeTable.json`; this module turns that table into something a picker can
 * show, and answers "which row is on screen right now?".
 *
 * Harness scaffolding, like `main.ts` — in production PGB constructs the URL from
 * the node the user clicked, and no table exists. The viewer itself still knows
 * nothing but `open(url)`.
 */

/** One minigraph node's GRCh38 placement and the URL it resolves to. */
export interface NodeRow {
    /** The dataset's key, id plus orientation, e.g. `5519+`. */
    node: string
    /** The id alone — what the API's `minigraphnode` parameter takes. */
    minigraphnode: string
    chrom: string
    start: number
    end: number
    length: number
    url: string
}

/** `data/nodeTable.json`, as written by `scripts/build_node_table.py`. */
export interface NodeTable {
    generatedAt: string
    source: string
    assembly: string
    endpoint: string
    fixedParameters: Record<string, string>
    queriedLocus: string | null
    actualLocus: string | null
    /** Nodes the dataset carries that GRCh38 doesn't place — these have no tube map. */
    nodesWithoutGrch38: string[]
    nodes: NodeRow[]
}

/** A row plus the one-line label the picker shows for it. */
export interface CatalogEntry extends NodeRow {
    label: string
}

/**
 * The table's rows in chromosome order, each labelled for display.
 *
 * Genomic order, not id order: the list is a walk along a locus, and the ids only
 * happen to ascend with it.
 */
export function catalogEntries(table: NodeTable): CatalogEntry[] {
    return [...table.nodes]
        .sort(
            (a, b) =>
                chromosomeRank(a.chrom) - chromosomeRank(b.chrom) ||
                a.chrom.localeCompare(b.chrom) ||
                a.start - b.start ||
                a.end - b.end
        )
        .map(row => ({ ...row, label: labelFor(row) }))
}

/**
 * The entry the viewer is currently showing, or `undefined` for anything not in the
 * table — the committed fixture, a hand-typed URL, a node from another dataset.
 *
 * Parameter order is not significant to the API, so it isn't significant here: a URL
 * that differs only in ordering is the same tube map.
 */
export function entryForUrl(entries: CatalogEntry[], url: string): CatalogEntry | undefined {
    const wanted = canonicalUrl(url)
    if (wanted === undefined) {
        return undefined
    }
    return entries.find(entry => canonicalUrl(entry.url) === wanted)
}

/** `chr1:25,331,046-25,331,646` — digit groups, because these are 8-digit numbers. */
export function formatLocus(interval: Pick<NodeRow, 'chrom' | 'start' | 'end'>): string {
    return `${interval.chrom}:${group(interval.start)}-${group(interval.end)}`
}

/**
 * `600 bp`, `35.9 kb`.
 *
 * Bases below 1 kb rather than a rounded `0.6 kb`: most segments in a node are
 * single-base variants, and a 1 bp node is a real and interesting thing to open.
 */
export function formatLength(bases: number): string {
    return bases < 1000 ? `${bases} bp` : `${(bases / 1000).toFixed(1)} kb`
}

function labelFor(row: NodeRow): string {
    return `${row.minigraphnode} · ${formatLocus(row)} · ${formatLength(row.length)}`
}

/**
 * Where a chromosome sits in the conventional order: 1…22, then X, Y, M, then
 * anything unrecognised, which falls back to name order.
 *
 * Textual order would put `chr10` before `chr2`. cici.json is chr1 only, so nothing
 * here exercises it yet — which is exactly why it's worth getting right now.
 */
function chromosomeRank(chrom: string): number {
    const name = chrom.replace(/^chr/i, '')
    const number = Number(name)
    if (Number.isInteger(number)) {
        return number
    }
    const named: Record<string, number> = { X: 1000, Y: 1001, M: 1002, MT: 1002 }
    return named[name.toUpperCase()] ?? 2000
}

function group(coordinate: number): string {
    return coordinate.toLocaleString('en-US')
}

/**
 * A URL reduced to what identifies the tube map: origin, path, and its parameters in
 * a fixed order. `undefined` when the string isn't an absolute URL — the fixture path
 * and typing mistakes both land here, and neither is in the table.
 */
function canonicalUrl(url: string): string | undefined {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return undefined
    }
    parsed.searchParams.sort()
    return `${parsed.origin}${parsed.pathname}?${parsed.searchParams}`
}
