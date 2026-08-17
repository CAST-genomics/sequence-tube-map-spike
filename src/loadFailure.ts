/**
 * What the researcher is told when no tube map appears, and why it is four things
 * rather than one.
 *
 * ADR `0001` traded away displaying the server's picture for interpreting its geometry,
 * and paid for it with a gate that refuses a document off the band grammar. The fallback
 * that once caught a refusal is withdrawn (`CONTEXT.md` #1, 2026-08-14), so this is where
 * a refusal ends: an error state, in place of the map, naming what was wrong.
 *
 * ## The classification is the message
 *
 * A blank surface looks identical whichever of these happened, and the five have nothing
 * in common in what the reader should do next:
 *
 * - **unreachable** — the bytes never arrived. Look at the network, the URL, the server.
 *   The API's error responses carry no CORS headers, so a 500 reaches us as an opaque
 *   failure (`notes/2026-08-12-api-reachability-and-cors.md`); that is still this.
 * - **slow** — the server accepted the request and did not finish it inside
 *   `PATIENCE_MS`. Kept apart from `unreachable` for the reader's sake: nothing is wrong
 *   with the network, the URL or the browser, and every one of those is where
 *   "could not be fetched" sends someone to look. This is the known server-side defect
 *   (#23) surfacing, and the only useful next move is a smaller node or a word to UCSD —
 *   so the message says so instead of implying there is something here to fix.
 * - **absent** — bytes arrived and are not a tube map. 13 of 30 catalogued minigraph
 *   nodes answer this way. Nothing is broken; there is no map for what was asked for.
 * - **undrawable** — a tube map arrived that this renderer will not draw. This is the
 *   gate firing, and it is the one that is worth a bug report: the grammar has drifted,
 *   or the document is genuinely of something else. The API answers an unknown node with
 *   200-and-plausible-nonsense, so this is also what stands between the researcher and a
 *   correct-looking map of different data.
 * - **internal** — the viewer itself threw. Kept apart from `unreachable` because a
 *   viewer fault dressed as a network failure sends the reader to look at the network.
 *
 * ## It returns parts, not a paragraph
 *
 * The mount draws heading, reason and URL as three elements. Pasting them into one string
 * with newlines is how the error state ended up rendering as a single run-on line — HTML
 * collapses them — and the heading is the half a reader takes in first.
 */

import { NonConformingDocument } from './documentGrammar.ts'
import { TubeMapLoadError } from './fetchDocument.ts'

/** Which of the five things went wrong. The reader's next move differs for each. */
export type FailureKind = 'unreachable' | 'slow' | 'absent' | 'undrawable' | 'internal'

export interface LoadFailure {
    kind: FailureKind
    /** One sentence naming the class of failure — what the reader takes in first. */
    heading: string
    /** The specific reason, as a sentence. Never a stack trace. */
    reason: string
    /** What was asked for, shown verbatim so a bug report can quote it. */
    url: string
    /** Where the fault actually lies, when that is not obvious from the reason. */
    note?: string
}

const HEADINGS: Record<FailureKind, string> = {
    unreachable: 'The tube map could not be fetched.',
    slow: 'The server is taking too long to answer.',
    absent: 'There is no tube map here.',
    undrawable: 'This tube map cannot be drawn.',
    internal: 'The viewer failed while opening this tube map.'
}

/**
 * A second sentence, and only where one earns its place.
 *
 * `slow` is the one failure here the researcher can neither fix nor learn anything from by
 * retrying, so it is the one that has to say where the fault is. Left with a bare reason it
 * reads as an accusation against their connection, and the next twenty minutes go into the
 * wrong thing.
 */
const NOTES: Partial<Record<FailureKind, string>> = {
    slow: 'This is a known problem at the server, not with this viewer or your connection. Larger minigraph nodes fail this way; a smaller one will usually load.'
}

export function describeFailure(url: string, error: unknown): LoadFailure {
    const kind = classify(error)

    return { kind, heading: HEADINGS[kind], reason: asSentence(reasonFor(error)), url, note: NOTES[kind] }
}

function classify(error: unknown): FailureKind {
    if (error instanceof TubeMapLoadError) {
        if ('slow' === error.kind) {
            return 'slow'
        }

        return 'network' === error.kind ? 'unreachable' : 'absent'
    }

    if (error instanceof NonConformingDocument) {
        return 'undrawable'
    }

    return 'internal'
}

/**
 * The thrown thing's own words, and only its words. `Error.stack` is deliberately not
 * consulted: the frames name this file's internals, which is not what went wrong with
 * the document, and a trace in the error state teaches a reader to stop reading it.
 */
function reasonFor(error: unknown): string {
    if (error instanceof Error) {
        return error.message
    }

    if (undefined === error || null === error) {
        return 'The viewer stopped without saying why'
    }

    return String(error)
}

/**
 * A reason arrives from a parser, a fetch, or whatever the viewer threw; the error state
 * shows it as prose. Opening capital and closing stop, so a reason written as a fragment
 * still reads as a sentence under the heading.
 *
 * A first word that is an identifier is left alone — `r.uniforms is undefined` is a fault
 * report about a name, and `R.uniforms` is a name that does not exist.
 */
function asSentence(reason: string): string {
    const trimmed = reason.trim()

    if (0 === trimmed.length) {
        return 'The viewer stopped without saying why.'
    }

    // A dotted first word is a name — `r.uniforms is undefined` — and `R.uniforms` is a
    // name that does not exist. Nothing else is exempt: a reason opening with a digit
    // capitalizes to itself, so the narrow test costs nothing and cannot swallow a
    // sentence that merely begins with a number.
    const [ first ] = trimmed.split(/\s/)
    const opened = first.includes('.')
        ? trimmed
        : trimmed[0].toUpperCase() + trimmed.slice(1)

    return /[.!?]$/.test(opened) ? opened : `${opened}.`
}
