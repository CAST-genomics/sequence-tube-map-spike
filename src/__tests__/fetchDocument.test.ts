/**
 * When the fetch gives up, and which of the ways it stopped it reports.
 *
 * This is the seam the guardrail can be silently wrong at. A timeout that reported itself
 * as a caller abort would leave the mount returning quietly with the spinner still up —
 * the exact indefinite hang the limit exists to end, now unreachable by any other code
 * path. And a caller abort that reported itself as a timeout would put a failure card on
 * the screen every time a researcher opened a second node before the first had finished.
 * Both look fine in a browser until the day they don't.
 *
 * The clock is real rather than faked, so the patience is passed in at milliseconds.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDocument, PATIENCE_MS, TubeMapLoadError } from '../fetchDocument.ts'

const URL = 'https://api.example/tubemap?minigraphnode=5520'

/** A server that accepts the request and never finishes it — the #23 failure mode. */
function neverAnswers(): typeof fetch {
    return ((_input: unknown, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(abortError()))
    })) as unknown as typeof fetch
}

/** Headers arrive promptly; the body never does. */
function answersThenStalls(): typeof fetch {
    return ((_input: unknown, init?: { signal?: AbortSignal }) => Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => new Promise<string>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(abortError()))
        })
    })) as unknown as typeof fetch
}

function abortError(): Error {
    const error = new Error('The operation was aborted.')
    error.name = 'AbortError'
    return error
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchDocument', () => {

    it('gives up on a server that never answers, and calls it slow', async () => {
        vi.stubGlobal('fetch', neverAnswers())

        const failure = await fetchDocument(URL, undefined, 20).catch(error => error)

        expect(failure).toBeInstanceOf(TubeMapLoadError)
        expect((failure as TubeMapLoadError).kind).toBe('slow')
        expect(failure.message).toMatch(/did not answer/)
    })

    it('holds the body to the same clock as the headers', async () => {
        vi.stubGlobal('fetch', answersThenStalls())

        const failure = await fetchDocument(URL, undefined, 20).catch(error => error)

        // A 14 MB response whose first byte is prompt and whose last never comes is still
        // an indefinite spinner. Stopping the clock once the headers land sails past it.
        expect((failure as TubeMapLoadError).kind).toBe('slow')
    })

    it('leaves a caller abort as an abort, so a superseded load stays silent', async () => {
        vi.stubGlobal('fetch', neverAnswers())

        const controller = new AbortController()
        const pending = fetchDocument(URL, controller.signal, 10_000).catch(error => error)

        controller.abort()

        const failure = await pending

        // The mount checks `signal.aborted` and returns without drawing. Wrapping this in a
        // TubeMapLoadError would show a failure card for ordinary housekeeping.
        expect(failure).not.toBeInstanceOf(TubeMapLoadError)
        expect((failure as Error).name).toBe('AbortError')
    })

    it('still names an ordinary network failure a network failure', async () => {
        vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))

        const failure = await fetchDocument(URL, undefined, 10_000).catch(error => error)

        expect((failure as TubeMapLoadError).kind).toBe('network')
    })

    it('waits longer than the slowest response ever measured', () => {
        // 65.6 s, `5511+` at 7,632 bp (`data/failureProbe.json`). A limit under that would
        // refuse nodes that work, which is worse than the hang it replaces.
        expect(PATIENCE_MS).toBeGreaterThan(65_600)
    })
})
