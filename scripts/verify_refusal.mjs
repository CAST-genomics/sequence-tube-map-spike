/**
 * #35's acceptance, run rather than argued, against the live surface.
 *
 * The gate itself is unit-tested — `rejectionReasons.test.ts` drives thirteen corruptions
 * through both parsers and reads the sentence each produces. What that cannot check is the
 * product behaviour the ticket is actually about: that a refusal *arrives*, that it does
 * not leave the previous map underneath it, and above all that it cannot be taken for a
 * tube map that happens to be empty. Those are properties of a mounted surface, so they
 * are checked on one.
 *
 * The broken documents are served by intercepting the request rather than by committing
 * malformed fixtures — a corrupted SVG in `public/` is a thing that outlives the reason it
 * was added, and would show up in the harness's own node list.
 *
 * Screenshots land in /tmp/stm-refusal-*.png so that looking at the four states is one
 * step rather than a setup.
 *
 *     node scripts/verify_refusal.mjs   # with `npm run dev` already up
 */

import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const ORIGIN = 'http://localhost:5173'
const DOCUMENT = '/stm-chr1-25331046-25331646.svg'
const GOOD = readFileSync('public/stm-chr1-25331046-25331646.svg', 'utf8')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

const results = []
const check = (name, passed, detail) => {
    results.push({ name, passed })
    console.log(`${true === passed ? '  ok  ' : '  FAIL'}  ${name}${undefined === detail ? '' : ` — ${detail}`}`)
}

/** What the status region is showing, read out of the DOM rather than off the screenshot. */
async function status() {
    return page.evaluate(() => {
        const status = document.querySelector('.stm-status')
        const text = selector => status?.querySelector(selector)?.textContent ?? null

        return {
            hidden: status?.hidden ?? null,
            isError: status?.classList.contains('is-error') ?? null,
            mark: text('.stm-status-mark'),
            heading: text('.stm-status-heading'),
            reason: text('.stm-status-reason'),
            url: text('.stm-status-url'),
            // What the researcher actually reads, with CSS applied — the defect this
            // replaced was a single \n-joined string, which renders as one run-on line.
            lines: [ ...status?.querySelector('.stm-status-card')?.children ?? [] ]
                .filter(child => 0 < (child.textContent ?? '').length)
                .map(child => child.getBoundingClientRect().top)
        }
    })
}

/** Is any of the map still on screen behind the error state? */
async function mapRemains() {
    return page.evaluate(() => {
        const canvas = document.querySelector('.stm-canvas')
        const boxes = document.querySelectorAll('.stm-segment')
        const navigator = document.querySelector('.stm-navigator')

        if (null === canvas) {
            return 0 < boxes.length
        }

        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
        const pixels = new Uint8Array(4)

        gl?.readPixels(
            Math.floor(canvas.width / 2), Math.floor(canvas.height / 2),
            1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels
        )

        return 0 < boxes.length
            || false === (navigator?.hidden ?? true)
            || (undefined !== gl && 0 !== pixels[3] && false === (pixels[0] > 240 && pixels[1] > 240))
    })
}

async function openWith(serve, screenshot) {
    await page.unrouteAll()

    // Matched on the pathname, not by glob: the harness carries the document in its own
    // query string, so `**/stm-….svg` matches the page navigation too and kills the app.
    if (null !== serve) {
        await page.route(url => DOCUMENT === url.pathname, serve)
    }

    await page.goto(`${ORIGIN}/?url=${DOCUMENT}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)

    if (undefined !== screenshot) {
        await page.screenshot({ path: `/tmp/stm-refusal-${screenshot}.png` })
    }

    return status()
}

// A conforming document is unaffected — asserted first, because every check below is a
// claim about a departure from this.
{
    const shown = await openWith(null, 'conforming')

    check('a conforming document still draws, with no status over it', true === shown.hidden, `hidden=${shown.hidden}`)
    check('and the map is on screen', true === await mapRemains())
}

// The fetch never arrived.
{
    const shown = await openWith(route => route.abort('failed'), 'unreachable')

    check('an unreachable document shows an error', true === shown.isError && false === shown.hidden)
    check('  headed as a fetch failure', /could not be fetched/i.test(shown.heading ?? ''), shown.heading)
    check('  naming the URL asked for', shown.url?.includes(DOCUMENT) === true, shown.url)
}

// Bytes arrived and are not a tube map.
{
    const shown = await openWith(
        route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '' }),
        'absent'
    )

    check('an empty response shows an error', true === shown.isError)
    check('  headed as an absence, not as a fetch failure', /no tube map here/i.test(shown.heading ?? ''), shown.heading)
}

// A tube map arrived that the band grammar refuses. This is the gate firing.
{
    const broken = GOOD.replace('height="15"', 'height="16"')
    const shown = await openWith(
        route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: broken }),
        'undrawable'
    )

    check('a document off the grammar shows an error', true === shown.isError)
    check('  headed as undrawable, distinctly from a fetch failure',
        /cannot be drawn/i.test(shown.heading ?? ''), shown.heading)
    check('  naming what was wrong with it', /16/.test(shown.reason ?? ''), shown.reason)
    check('  and not as a stack trace', false === /\bat \w+ \(/.test(shown.reason ?? ''))

    // The defect this replaced: heading, reason and URL pasted into one textContent with
    // newlines, which CSS collapses into a single line with the heading buried mid-sentence.
    check('  laid out as separate lines, not one collapsed paragraph',
        4 === new Set(shown.lines).size, `${shown.lines.length} elements on ${new Set(shown.lines).size} rows`)

    check('  marked as an error rather than left as bare text', '!' === shown.mark, shown.mark)
}

// The one that matters most: a refusal arriving over a map that was already drawn.
{
    await openWith(null)
    const drawnFirst = await mapRemains()

    const broken = GOOD.replace('height="15"', 'height="16"')
    const shown = await openWith(
        route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: broken }),
        'no-partial-map'
    )

    check('the previous map was really there to begin with', true === drawnFirst)
    check('a refusal leaves no part of a map behind it', false === await mapRemains())
    check('  and the error state covers the surface', true === shown.isError && false === shown.hidden)
}

await browser.close()

const failed = results.filter(result => false === result.passed)

console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log('screenshots: /tmp/stm-refusal-{conforming,unreachable,absent,undrawable,no-partial-map}.png')

process.exit(0 === failed.length ? 0 : 1)
