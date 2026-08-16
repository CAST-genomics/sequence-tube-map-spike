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
 * A blank surface looks identical whichever of these happened, and the four have nothing
 * in common in what the reader should do next:
 *
 * - **unreachable** — the bytes never arrived. Look at the network, the URL, the server.
 *   The API's error responses carry no CORS headers, so a 500 reaches us as an opaque
 *   failure (`notes/2026-08-12-api-reachability-and-cors.md`); that is still this.
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

/** Which of the four things went wrong. The reader's next move differs for each. */
export type FailureKind = 'unreachable' | 'absent' | 'undrawable' | 'internal'

export interface LoadFailure {
    kind: FailureKind
    /** One sentence naming the class of failure — what the reader takes in first. */
    heading: string
    /** The specific reason, as a sentence. Never a stack trace. */
    reason: string
    /** What was asked for, shown verbatim so a bug report can quote it. */
    url: string
}

const HEADINGS: Record<FailureKind, string> = {
    unreachable: 'The tube map could not be fetched.',
    absent: 'There is no tube map here.',
    undrawable: 'This tube map cannot be drawn.',
    internal: 'The viewer failed while opening this tube map.'
}

export function describeFailure(url: string, error: unknown): LoadFailure {
    const kind = classify(error)

    return { kind, heading: HEADINGS[kind], reason: asSentence(reasonFor(error)), url }
}

function classify(error: unknown): FailureKind {
    if (error instanceof TubeMapLoadError) {
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
