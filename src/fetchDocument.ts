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
 */

export class TubeMapLoadError extends Error {

    constructor(message: string, readonly kind: 'network' | 'content') {
        super(message)
        this.name = 'TubeMapLoadError'
    }
}

export async function fetchDocument(url: string, signal?: AbortSignal): Promise<string> {
    let response: Response

    try {
        response = await fetch(url, { signal })
    } catch (error) {
        if (signal?.aborted) {
            throw error
        }
        throw new TubeMapLoadError(`Could not reach ${url} — ${describe(error)}`, 'network')
    }

    if (false === response.ok) {
        throw new TubeMapLoadError(`Server returned ${response.status} ${response.statusText} for ${url}`, 'network')
    }

    const text = await response.text()

    // Emptiness is a property of the response, not of either reading of it, so it is
    // named here. Left to the renderers it comes back as whatever each one's parser
    // happens to miss first — "no drawable elements in g.track" is a diagnosis of the
    // band grammar, and the document had no bytes.
    if (0 === text.trim().length) {
        throw new TubeMapLoadError('The response was empty — no tube map for this minigraph node.', 'content')
    }

    return text
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
