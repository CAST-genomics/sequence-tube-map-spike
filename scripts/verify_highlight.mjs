/**
 * What feeler mode does and what it costs — #39's acceptance, run rather than argued.
 *
 * Two claims are under test. The first is the one the appearance table exists to make:
 * emphasis is a table write and a 2 KB upload, so moving it costs the same wherever it moves
 * and whatever the document. The second is the behaviour the user corrected on looking at the
 * built thing: **the emphasis follows the cursor and does not accumulate** — a sweep hands it
 * along rather than leaving a trail of lit tracks behind. `trackAppearance.test.ts` pins that
 * structurally, by counting texels; the sweep's screenshot here is what shows it.
 *
 * Same two rules as `verify_pick.mjs`, for the same reasons:
 *
 * - **Headed, so it runs on the real GPU.** Headless chromium falls back to SwiftShader,
 *   where a readback is software rasterization and the numbers say nothing.
 * - **Nothing is predicted that can be read.** The focused track and the costs come out of
 *   the surface's own readout, which is the state the interaction actually reached.
 *
 *     node scripts/verify_highlight.mjs                    # the committed 600 bp fixture
 *     node scripts/verify_highlight.mjs '<url>'            # a live node; 5520 is the record
 */

import { chromium } from 'playwright'

const DOCUMENT = process.argv[2] ?? '/stm-chr1-25331046-25331646.svg'
const URL = `http://localhost:5173/?pick&fps&url=${encodeURIComponent(DOCUMENT)}`
/** A vertical sweep crosses the bundle, which is what a researcher does with a feeler. */
const SWEEP_STEPS = 260
const SHOTS = 'notes'
/** Screenshots are named for the document, so two runs do not overwrite each other. */
const LABEL = /minigraphnode=(\d+)/.exec(DOCUMENT)?.[1] ?? 'fixture'

const browser = await chromium.launch({ headless: false })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

await page.goto(URL, { waitUntil: 'networkidle' })
await page.bringToFront()
await page.waitForSelector('.stm-pick')
await page.waitForFunction(() => document.querySelector('.stm-status')?.hidden === true)

const map = await page.evaluate(async source => {
    const { parseBands } = await import('/src/parseBands.ts')
    const parsed = parseBands(await (await fetch(source)).text())

    return { tracks: parsed.trackCount, bands: parsed.bandCount }
}, DOCUMENT)

const canvas = await page.locator('canvas.stm-canvas').boundingBox()
const rows = Math.ceil(map.tracks / 256)

console.log(`document:  ${map.tracks} tracks · ${map.bands} bands · ${DOCUMENT}`)
console.log(`viewport:  ${canvas.width} x ${canvas.height} css px`)
console.log(`table:     ${rows * 256 * 4} bytes, ${rows} rows of 256 texels\n`)

/**
 * The surface's own readout: the pick, the focused track, and what table writes cost.
 *
 * Waits for a pick to have run, because pointer events do get dropped between the driver and
 * the page, and the readout says `track —` both before the first pick of a move and after the
 * pointer has left the canvas.
 */
async function state() {
    await page.waitForFunction(
        () => document.querySelector('.stm-pick').textContent.includes(' ms'),
        null,
        { timeout: 4000 }
    )

    const text = await page.locator('.stm-pick').textContent()
    const focus = /focus (\S+)/.exec(text)

    if (null === focus) {
        throw new Error(`readout does not parse: "${text}"`)
    }

    return {
        track: /^track (\S+)/.exec(text)[1],
        pick: Number(/· ([\d.]+) ms/.exec(text)[1]),
        focus: '—' === focus[1] ? null : Number(focus[1]),
        write: Number(/table ([\d.]+) ms/.exec(text)[1]),
        worstWrite: Number(/table [\d.]+ ms, worst ([\d.]+) ms/.exec(text)[1])
    }
}

async function worstFrame() {
    return Number(/worst ([\d.]+) ms/.exec(await page.locator('.harness-fps').textContent())[1])
}

async function resetFrameMeter() {
    await page.locator('.harness-fps').click()
}

async function settle() {
    await page.evaluate(() => new Promise(done =>
        requestAnimationFrame(() => requestAnimationFrame(done))))
}

const middle = { x: canvas.x + canvas.width * 0.5, y: canvas.y + canvas.height * 0.5 }
const at = i => middle.y - SWEEP_STEPS * 0.5 + i

// ── Hover without Shift does nothing ────────────────────────────────────────────────
await page.mouse.move(middle.x, middle.y)
await settle()

for (let i = 0; i < 40; i += 1) {
    await page.mouse.move(middle.x, middle.y - 120 + i * 6)
}

await settle()

const hovered = await state()

console.log(`hover, no Shift · picks answer (track ${hovered.track}) and nothing emphasizes: `
    + `${null === hovered.focus ? 'focus — ✓' : `focus ${hovered.focus} ✗`}`)

await page.screenshot({ path: `${SHOTS}/highlight-${LABEL}-plain.png` })

// ── The same moves, without Shift: what the harness itself costs per frame ───────────
// The sweep below is measured against this. A pointer move with the readout on already runs a
// pick and a synchronous readback, so anything the two figures share is not the highlight.
await resetFrameMeter()
await page.mouse.move(middle.x, middle.y)

for (let i = 0; i < SWEEP_STEPS; i += 1) {
    await page.mouse.move(middle.x, at(i))
    await settle()
}

const baselineFrame = await worstFrame()

// ── One strand, which is the picture the treatment has to be judged on ──────────────
// Twice, because the two regimes are different pictures: at fit a band is a fraction of a
// pixel and only low-frequency cues survive, and zoomed in it is many pixels tall.
async function feelOne(label, shot) {
    await page.keyboard.down('Shift')

    let found = null

    for (let i = 0; i < SWEEP_STEPS && null === found; i += 1) {
        await page.mouse.move(middle.x, at(i))
        await settle()

        const now = await state()

        if (null !== now.focus) {
            found = now
        }
    }

    await page.screenshot({ path: `${SHOTS}/${shot}` })
    await page.keyboard.up('Shift')
    await settle()

    console.log(`one strand, ${label} · track ${found?.focus ?? 'none found'}`
        + ` · table write ${found?.write.toFixed(3) ?? '—'} ms · ${SHOTS}/${shot}`)
}

await feelOne('at fit', `highlight-${LABEL}-one-at-fit.png`)

await page.mouse.move(middle.x, middle.y)

// A middling zoom, which is where the strip is actually read: a band a few pixels tall, with
// hundreds of its neighbours still on screen. The deep end resolves itself.
for (let i = 0; i < 24; i += 1) {
    await page.mouse.wheel(0, -120)
}

await settle()
await feelOne('zoomed in', `highlight-${LABEL}-one-zoomed.png`)

// Out to fit, then a few steps back in for the sweep. Not at fit itself: on `5520+` the
// bundle is 81 css pixels tall there and 5.7 tracks share every pixel row, so a sweep would
// only ever reach the topmost few dozen of them. Every band is drawn at either zoom.
for (let i = 0; i < 40; i += 1) {
    await page.mouse.wheel(0, 120)
}

for (let i = 0; i < 12; i += 1) {
    await page.mouse.wheel(0, -120)
}

await settle()

// ── The sweep: does the emphasis follow, and does moving it drift in cost? ───────────
await resetFrameMeter()
await page.mouse.move(middle.x, at(0))
await page.keyboard.down('Shift')
await settle()

const moves = []
const visited = new Set()
let previous = (await state()).focus

for (let i = 0; i < SWEEP_STEPS; i += 1) {
    await page.mouse.move(middle.x, at(i))
    await settle()

    const now = await state()

    if (null !== now.focus) {
        visited.add(now.focus)
    }

    // Only the samples where the focus actually moved are samples of what moving it costs.
    // The rest are frames where the cursor was still on the same haplotype and the table was
    // deliberately not rewritten.
    if (now.focus !== previous) {
        moves.push({ index: moves.length, write: now.write })
        previous = now.focus
    }
}

const swept = await state()
const sweepWorstFrame = await worstFrame()

await page.screenshot({ path: `${SHOTS}/highlight-${LABEL}-swept.png` })

const summarise = values => {
    const sorted = [...values].sort((a, b) => a - b)

    return `median ${sorted[sorted.length >> 1].toFixed(3)} ms`
        + ` · worst ${sorted[sorted.length - 1].toFixed(3)} ms`
}

console.log(`\nsweep · ${SWEEP_STEPS} pointer moves down the middle of the map at ~6x fit, Shift held`)
console.log(`  the focus moved ${moves.length} times, across ${visited.size} distinct tracks`)
console.log(null === swept.focus
    ? `  and ends emphasizing none of them: the sweep ran off the bundle, so the map is receded`
        + ` and nothing is at full colour — which is a state, not a trail`
    : `  and ends emphasizing one of them, not ${visited.size}: focus ${swept.focus}`)
console.log(`  cost of moving the focus, by how many moves had already happened:`)

for (const [low, high] of [[0, 10], [10, 25], [25, 50], [50, 100], [100, 1e9]]) {
    const window = moves
        .filter(move => move.index >= low && move.index < high)
        .map(move => move.write)

    if (window.length > 0) {
        console.log(`    moves ${String(low).padStart(3)}-${high === 1e9 ? 'end' : high - 1}: ${summarise(window)}`)
    }
}

console.log(`  worst table write over the whole sweep: ${swept.worstWrite.toFixed(3)} ms`)
console.log(`  worst frame during the sweep: ${sweepWorstFrame.toFixed(1)} ms`)
console.log(`  worst frame over the same moves without Shift: ${baselineFrame.toFixed(1)} ms`)
console.log(`  a 60 Hz frame is 16.67 ms; the SVG surface cost ~28 ms per swap`)

// ── Panning and zooming with the key held ────────────────────────────────────────────
// The map holds still while it is being felt, so this is what a wheel and a drag must do:
// nothing at all. What is compared is the *view*, read off the navigator rect — the camera's
// own arithmetic, already in the DOM. Not the focused track: a drag moves the cursor, so the
// feeler lands on a different haplotype whether or not the map moved under it.
const viewRect = () => page.evaluate(() => {
    const rect = document.querySelector('.stm-navigator-rect')

    return `${rect.style.left} ${rect.style.top} ${rect.style.width} ${rect.style.height}`
})

const parked = await viewRect()

await page.mouse.wheel(0, -240)
await page.mouse.down()
await page.mouse.move(middle.x + 200, middle.y + 40)
await page.mouse.up()
await settle()

const moved = await viewRect()

console.log(`\nShift held, pan and zoom suppressed: `
    + `${parked === moved ? 'the view did not move under the feeler ✓' : `the view moved ✗  ${parked} → ${moved}`}`)

// ── Release ─────────────────────────────────────────────────────────────────────────
await page.keyboard.up('Shift')
await settle()
await page.mouse.move(middle.x, middle.y + 3)
await settle()

const released = await state()

console.log(`release · ${null === released.focus ? 'the map came back whole ✓' : `focus ${released.focus} ✗`}`)

await page.screenshot({ path: `${SHOTS}/highlight-${LABEL}-released.png` })

console.log(`\nscreenshots: ${SHOTS}/highlight-${LABEL}-{plain,one-at-fit,one-zoomed,swept,released}.png`)

await browser.close()
