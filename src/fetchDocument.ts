/**
 * Fetching a tube map document, which is all the mount does with a URL.
 *
 * `open(url)` is the entire input surface (`CONTEXT.md` #2): the host constructs the URL
 * from a clicked minigraph node's id and coordinates, and the viewer never builds one,
 * never checks eligibility, and never learns whether it is local or remote. A fixture in
 * `public/` is just another URL.
 *
 * The response comes back as text rather than as a parsed document, because the two
 * surfaces read the same bytes in incompatible ways — `DOMParser` into a live tree, or a
 * regex into six floats per band — and neither reading belongs to the fetch.
 *
 * Note from the CORS survey (`notes/2026-08-12-api-reachability-and-cors.md`): the API's
 * error responses carry no CORS headers, so a 500 reaches the browser as an opaque
 * network failure rather than a status. Both paths below are therefore live.
 *
 * The failures below say what went wrong and not *what it went wrong with*: the error
 * state shows the URL on a line of its own (`loadFailure.ts`), and a message that names it
 * again puts it on the screen twice.
 *
 * ## Why the fetch gives up
 *
 * The API crashes while generating large responses (#23) and does it slowly: probed
 * failures came back at 33–100 s, and two catalogued nodes never answered at all. Without
 * a limit those become an indefinite spinner, which is the one outcome that tells the
 * researcher nothing — a viewer that is still trying looks exactly like a viewer that is
 * hung.
 *
 * `PATIENCE_MS` is 90 s, and it is a *guardrail, not a diagnosis*. The slowest observed
 * success took 65.6 s, so the limit sits above every response known to arrive and gives up
 * on the rest. Diagnosing why the server takes that long is UCSD's, and deliberately not
 * this viewer's — see `notes/2026-08-13-api-fetch-ceiling.md`.
 */

/**
 * How long to wait before calling it a server-side problem.
 *
 * Above the slowest success ever measured (65.6 s, `5511+` at 7,632 bp) with room to
 * spare, because aborting a request that would have arrived is the worse error: the
 * researcher gets a failure card for a node that works, and no way to tell that from a
 * node that doesn't.
 */
export const PATIENCE_MS = 90_000

export class TubeMapLoadError extends Error {

    constructor(message: string, readonly kind: 'network' | 'content' | 'slow') {
        super(message)
        this.name = 'TubeMapLoadError'
    }
}

export async function fetchDocument(
    url: string,
    signal?: AbortSignal,
    patienceMs: number = PATIENCE_MS
): Promise<string> {

    // Our own controller rather than the caller's, so the two reasons a request stops stay
    // distinguishable: the caller aborting is silent housekeeping — a second `open()`
    // overtaking the first — and running out of patience is a failure the researcher must
    // be shown. Both arrive at the `catch` below as the same `AbortError`, and only
    // `expired` tells them apart.
    const attempt = new AbortController()
    let expired = false

    const timer = setTimeout(() => {
        expired = true
        attempt.abort()
    }, patienceMs)

    const relay = (): void => attempt.abort()

    signal?.addEventListener('abort', relay, { once: true })

    // The body is read inside the timer's reach as well as the headers. A 14 MB response
    // whose first byte arrives quickly and whose last never does is exactly the hang this
    // exists to end, and stopping the clock at the headers would sail straight past it.
    try {
        let response: Response

        try {
            response = await fetch(url, { signal: attempt.signal })
        } catch (error) {
            throw translate(error, expired, signal, patienceMs)
        }

        if (false === response.ok) {
            throw new TubeMapLoadError(`The server answered ${response.status} ${response.statusText}`, 'network')
        }

        let text: string

        try {
            text = await response.text()
        } catch (error) {
            throw translate(error, expired, signal, patienceMs)
        }

        // Emptiness is a property of the response, not of either reading of it, so it is
        // named here. Left to the renderers it comes back as whatever each one's parser
        // happens to miss first — "no drawable elements in g.track" is a diagnosis of the
        // band grammar, and the document had no bytes.
        if (0 === text.trim().length) {
            throw new TubeMapLoadError('The response was empty — no tube map for this minigraph node.', 'content')
        }

        return text
    } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', relay)
    }
}

/**
 * Which of the three ways a stopped request stopped.
 *
 * Order matters. The caller's abort is checked first and rethrown untouched, because the
 * mount reads it as "this load was superseded" and returns without drawing anything;
 * wrapping it in a `TubeMapLoadError` would put a failure card on the screen every time a
 * researcher opened a second node before the first finished.
 */
function translate(error: unknown, expired: boolean, signal: AbortSignal | undefined, patienceMs: number): unknown {
    if (signal?.aborted) {
        return error
    }

    if (expired) {
        return new TubeMapLoadError(
            `The server did not answer within ${Math.round(patienceMs / 1000)} seconds`,
            'slow'
        )
    }

    return new TubeMapLoadError(`The request did not complete — ${describe(error)}`, 'network')
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
