/**
 * The spike's stated contract, enforced at the end of it.
 *
 * `spike/` existed to answer one question — does a three.js renderer of the tube map look
 * good and feel right under pan and zoom — and said in its own README that it would be
 * deleted or rewritten, never promoted. The verdict came in
 * (`notes/2026-08-14-three-js-renderer-verdict.md`) and it was rewritten: the parser and
 * the surface live in `src/` now, typechecked and reachable from the shipping entry point.
 *
 * This replaces `spike/importGuard.test.ts`, which enforced the partition while the spike
 * was alive. What is worth checking now is the other end of the contract: that the
 * directory is gone and that nothing has quietly grown a path back into it — including
 * `scripts/spike/`, the retired fidelity-gate record, which is a committed artifact and
 * not code anything may depend on.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const IMPORT = /(?:^|\n)\s*(?:import|export)[^\n]*?from\s+['"]([^'"]+)['"]/g

describe('the spike is gone', () => {

    it('has no spike/ directory', () => {
        expect(existsSync('spike')).toBe(false)
    })

    it('is imported by nothing', () => {
        const offenders: string[] = []

        for (const file of sourceFiles('src')) {
            for (const specifier of imports(file)) {
                if (/(^|\/)spike\//.test(specifier)) {
                    offenders.push(`${file} → ${specifier}`)
                }
            }
        }

        expect(offenders).toEqual([])
    })
})

function sourceFiles(root: string): string[] {
    const found: string[] = []

    const walk = (directory: string): void => {
        for (const entry of readdirSync(directory)) {
            const path = join(directory, entry)

            if (statSync(path).isDirectory()) {
                walk(path)
            } else if (/\.tsx?$/.test(entry)) {
                found.push(path)
            }
        }
    }

    walk(root)

    return found
}

function imports(file: string): string[] {
    const text = readFileSync(file, 'utf8')
    const specifiers: string[] = []
    let match: RegExpExecArray | null

    IMPORT.lastIndex = 0

    while (null !== (match = IMPORT.exec(text))) {
        specifiers.push(match[1])
    }

    return specifiers
}
