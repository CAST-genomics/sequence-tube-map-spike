/**
 * What the researcher is told when a tube map does not appear.
 *
 * The whole point of the gate is that a refusal is legible, so the message is worth
 * testing as data rather than as a string the mount happens to paste together: the
 * classification is what decides whether the reader goes looking at the network, at the
 * minigraph node they asked for, or at the document the server sent back.
 */

import { describe, expect, it } from 'vitest'
import { NonConformingDocument } from '../documentGrammar.ts'
import { TubeMapLoadError } from '../fetchDocument.ts'
import { describeFailure } from '../loadFailure.ts'

const REQUESTED_URL = 'https://api.example/tubemap?minigraphnode=5520'

describe('describeFailure', () => {

    it('names a fetch that never arrived as unreachable', () => {
        const failure = describeFailure(REQUESTED_URL, new TubeMapLoadError('Could not reach it — offline', 'network'))

        expect(failure.kind).toBe('unreachable')
        expect(failure.reason).toBe('Could not reach it — offline.')
        expect(failure.url).toBe(REQUESTED_URL)
    })

    it('separates a response that is not a tube map from a fetch that failed', () => {
        const missing = describeFailure(REQUESTED_URL, new TubeMapLoadError('The response was empty.', 'content'))

        expect(missing.kind).toBe('absent')
        expect(missing.heading).not.toBe(describeFailure(REQUESTED_URL, new TubeMapLoadError('x', 'network')).heading)
    })

    it('separates a server that is too slow from one that could not be reached', () => {
        const slow = describeFailure(REQUESTED_URL, new TubeMapLoadError('The server did not answer within 90 seconds', 'slow'))
        const unreachable = describeFailure(REQUESTED_URL, new TubeMapLoadError('offline', 'network'))

        expect(slow.kind).toBe('slow')
        expect(slow.heading).not.toBe(unreachable.heading)
    })

    it('tells the reader a slow server is not theirs to fix, and says so only there', () => {
        const slow = describeFailure(REQUESTED_URL, new TubeMapLoadError('The server did not answer within 90 seconds', 'slow'))

        // The whole point of the note: without it, "could not be fetched" sends someone to
        // look at a network that is working.
        expect(slow.note).toMatch(/server/i)
        expect(slow.note).not.toBeUndefined()

        for (const other of [
            new TubeMapLoadError('offline', 'network'),
            new TubeMapLoadError('empty', 'content'),
            new NonConformingDocument('a band is 20 tall'),
            new TypeError('boom')
        ]) {
            expect(describeFailure(REQUESTED_URL, other).note).toBeUndefined()
        }
    })

    it('names a document off the grammar as one that cannot be drawn', () => {
        const failure = describeFailure(REQUESTED_URL, new NonConformingDocument('A band is drawn 20 units tall; every band is 15.'))

        expect(failure.kind).toBe('undrawable')
        expect(failure.reason).toBe('A band is drawn 20 units tall; every band is 15.')
    })

    it('gives an undrawable document a heading of its own, so it is not read as a fetch failure', () => {
        const undrawable = describeFailure(REQUESTED_URL, new NonConformingDocument('nope'))
        const unreachable = describeFailure(REQUESTED_URL, new TubeMapLoadError('nope', 'network'))

        expect(undrawable.heading).not.toBe(unreachable.heading)
    })

    it('does not disguise a viewer fault as a fetch failure', () => {
        const internal = describeFailure(REQUESTED_URL, new TypeError('r.uniforms is undefined'))
        const unreachable = describeFailure(REQUESTED_URL, new TubeMapLoadError('offline', 'network'))

        expect(internal.kind).toBe('internal')
        expect(internal.heading).not.toBe(unreachable.heading)
        // Left uncapitalized: it names an identifier, and `R.uniforms` is not one.
        expect(internal.reason).toBe('r.uniforms is undefined.')
    })

    it('carries a reason for anything thrown, including what was never an Error', () => {
        expect(describeFailure(REQUESTED_URL, 'exploded').reason).toBe('Exploded.')
        expect(describeFailure(REQUESTED_URL, undefined).reason.length).toBeGreaterThan(0)
        expect(describeFailure(REQUESTED_URL, new Error('   ')).reason.length).toBeGreaterThan(0)
    })

    it('states every reason as a sentence, so none of it reads as a fragment of a trace', () => {
        const failures = [
            describeFailure(REQUESTED_URL, new TubeMapLoadError('Could not reach it', 'network')),
            describeFailure(REQUESTED_URL, new TubeMapLoadError('The response was empty', 'content')),
            describeFailure(REQUESTED_URL, new NonConformingDocument('A band is 20 tall')),
            describeFailure(REQUESTED_URL, new TypeError('boom')),
            describeFailure(REQUESTED_URL, 42)
        ]

        for (const failure of failures) {
            expect(failure.heading).toMatch(/^[A-Z].*\.$/)
            expect(failure.reason).toMatch(/^[A-Z0-9]/)
            expect(failure.reason).toMatch(/\.$/)
            expect(failure.reason).not.toMatch(/\n\s+at /)
        }
    })
})
