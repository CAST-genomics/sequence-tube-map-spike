/**
 * The partition, enforced.
 *
 * The spike must not reach into the SVG viewer's source, because the friction of having
 * to retype something is the only thing that reliably keeps SVG-era structures out of a
 * three.js renderer. A rule nobody checks erodes on the first inconvenient afternoon.
 *
 * The reverse direction is checked too: nothing shipping may come to depend on code
 * whose stated contract is that it gets deleted.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const IMPORT = /(?:^|\n)\s*(?:import|export)[^\n]*?from\s+['"]([^'"]+)['"]/g

describe('the spike is partitioned from the SVG viewer', () => {

    it('imports nothing from src/', () => {
        const offenders: string[] = []

        for (const file of sourceFiles('spike')) {
            for (const specifier of imports(file)) {
                if (/(^|\/)src\//.test(specifier) || specifier.startsWith('../src')) {
                    offenders.push(`${file} → ${specifier}`)
                }
            }
        }

        expect(offenders).toEqual([])
    })

    it('is imported by nothing outside itself', () => {
        const offenders: string[] = []

        for (const file of sourceFiles('src')) {
            for (const specifier of imports(file)) {
                if (specifier.includes('spike')) {
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
