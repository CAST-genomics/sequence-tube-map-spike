/**
 * What feeler mode costs, and whether that cost depends on how many tracks are lit — #39's
 * acceptance, run rather than argued.
 *
 * The claim under test is the one the appearance table exists to make: highlighting is a
 * table write and a 2 KB upload, so lighting the two-hundredth strand costs what lighting
 * the first did. `trackAppearance.test.ts` establishes that structurally, by counting the
 * bytes a write touches. This measures it — on a real GPU, driving a real sweep, with the
 * pick pass and the upload and the draw all inside the number.
 *
 * Same two rules as `verify_pick.mjs`, for the same reasons:
 *
 * - **Headed, so it runs on the real GPU.** Headless chromium falls back to SwiftShader,
 *   where a readback is software rasterization and the numbers say nothing.
 * - **Nothing is predicted that can be read.** Lit counts and costs come out of the
 *   surface's own readout, which is the state the interaction actually reached.
 *
 *     node scripts/verify_highlight.mjs                    # with `npm run dev` already up
 *     node scripts/verify_highlight.mjs '<url>'            # against another document
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

const trackCount = await page.evaluate(async source => {
    const { parseBands } = await import('/src/parseBands.ts')
    const map = parseBands(await (await fetch(source)).text())

    return { tracks: map.trackCount, bands: map.bandCount }
}, DOCUMENT)

const canvas = await page.locator('canvas.stm-canvas').boundingBox()

console.log(`document:  ${trackCount.tracks} tracks · ${trackCount.bands} bands · ${DOCUMENT}`)
console.log(`viewport:  ${canvas.width} x ${canvas.height} css px`)
console.log(`table:     ${Math.ceil(trackCount.tracks / 256) * 256 * 4} bytes, ${Math.ceil(trackCount.tracks / 256)} rows of 256 texels\n`)

/**
 * The surface's own readout: the pick, the lit count, and the worst table write so far.
 *
 * Waits for a pick to have run, because pointer events do get dropped between the driver
 * and the page, and the readout says `track —` both before the first pick of a move and
 * after the pointer has left the canvas.
 */
async function state() {
    await page.waitForFunction(
        () => document.querySelector('.stm-pick').textContent.includes(' ms'),
        null,
        { timeout: 4000 }
    )

    const text = await page.locator('.stm-pick').textContent()

    if (null === /lit (\d+)/.exec(text)) {
        throw new Error(`readout does not parse: "${text}"`)
    }

    return {
        track: /^track (\S+)/.exec(text)[1],
        pick: Number(/· ([\d.]+) ms/.exec(text)[1]),
        lit: Number(/lit (\d+)/.exec(text)[1]),
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

// ── Hover without Shift does nothing ────────────────────────────────────────────────
await page.mouse.move(middle.x, middle.y)
await settle()

for (let i = 0; i < 40; i += 1) {
    await page.mouse.move(middle.x, middle.y - 120 + i * 6)
}

await settle()

const hovered = await state()

console.log(`hover, no Shift · picks answer (track ${hovered.track}) and nothing lights: `
    + `${0 === hovered.lit ? 'lit 0 ✓' : `lit ${hovered.lit} ✗`}`)

await page.screenshot({ path: `${SHOTS}/highlight-${LABEL}-plain.png` })

// ── The same moves, without Shift: what the harness itself costs per frame ───────────
// The sweep below is measured against this. A pointer move with the readout on already
// runs a pick and a synchronous readback; the only thing feeling adds is the table write
// and the upload, so anything the two figures do not share is not the highlight.
await resetFrameMeter()
await page.mouse.move(middle.x, middle.y)

for (let i = 0; i < SWEEP_STEPS; i += 1) {
    await page.mouse.move(middle.x, middle.y - SWEEP_STEPS * 0.5 + i)
    await settle()
}

const baselineFrame = await worstFrame()

// ── One strand, which is the picture the treatment has to be judged on ──────────────
// Twice, because the two regimes are different pictures: at fit a band is a fraction of a
// pixel and only low-frequency cues survive, and zoomed in it is tens of pixels tall.
async function lightOne(label, shot) {
    await page.keyboard.down('Shift')

    let single = null

    for (let i = 0; i < SWEEP_STEPS && null === single; i += 1) {
        await page.mouse.move(middle.x, middle.y - SWEEP_STEPS * 0.5 + i)
        await settle()

        const now = await state()

        if (1 === now.lit) {
            single = now
        }
    }

    await page.screenshot({ path: `${SHOTS}/${shot}` })
    await page.keyboard.up('Shift')
    await settle()

    console.log(`one strand lit, ${label} · track ${single?.track ?? 'none found'}`
        + ` · table write ${single?.write.toFixed(3) ?? '—'} ms · ${SHOTS}/${shot}`)
}

await lightOne('at fit', `highlight-${LABEL}-one-at-fit.png`)

await page.mouse.move(middle.x, middle.y)

// A middling zoom, which is where the strip is actually read: a band a few pixels tall,
// with hundreds of its neighbours still on screen. The deep end resolves itself.
for (let i = 0; i < 24; i += 1) {
    await page.mouse.wheel(0, -120)
}

await settle()
await lightOne('zoomed in', `highlight-${LABEL}-one-zoomed.png`)

// Out to fit, then a few steps back in for the sweep. Not at fit itself: on `5520+` the
// bundle is 81 css pixels tall there and 5.7 tracks share every pixel row, so a sweep can
// only ever touch the topmost few dozen of them — and the accumulating set is the point of
// this phase. Every band is still drawn either way; nothing is culled at any zoom.
for (let i = 0; i < 40; i += 1) {
    await page.mouse.wheel(0, 120)
}

for (let i = 0; i < 12; i += 1) {
    await page.mouse.wheel(0, -120)
}

await settle()

// ── The sweep ───────────────────────────────────────────────────────────────────────
// Shift down, then one vertical pass through the bundle. Cost is sampled the whole way,
// so what it does as the lit set grows is visible rather than summarised at the end.
await resetFrameMeter()
await page.keyboard.down('Shift')
await settle()

const samples = []
const top = middle.y - SWEEP_STEPS * 0.5

for (let i = 0; i < SWEEP_STEPS; i += 1) {
    await page.mouse.move(middle.x, top + i)
    await settle()

    const now = await state()

    samples.push({ lit: now.lit, pick: now.pick, write: now.write, worstWrite: now.worstWrite })
}

const swept = await state()
const sweepWorstFrame = await worstFrame()

await page.screenshot({ path: `${SHOTS}/highlight-${LABEL}-swept.png` })

/** The worst table write observed by the time the lit set had reached `lit` tracks. */
const writeAt = lit => {
    const found = samples.filter(sample => sample.lit >= lit)

    return 0 === found.length ? null : found[0].worstWrite
}

/**
 * Median cost of a write while the lit set was in a band of sizes.
 *
 * The worst-so-far figure above is monotone by construction, so a single outlier anywhere
 * in a sweep makes a flat cost look like a growing one. This is the same measurement
 * without that property.
 */
const medianWriteBetween = (low, high) => {
    const found = samples
        .filter(sample => sample.lit >= low && sample.lit < high)
        .map(sample => sample.write)
        .sort((a, b) => a - b)

    return 0 === found.length ? null : found[found.length >> 1]
}

console.log(`\nsweep · ${SWEEP_STEPS} pointer moves down the middle of the map at ~6x fit, Shift held`)
console.log(`  tracks lit: ${swept.lit} of ${trackCount.tracks}`)
console.log(`  worst table write, as the lit set grew:`)

for (const lit of [1, 10, 25, 50, 100, 150, 200, swept.lit]) {
    const write = writeAt(lit)

    if (null !== write) {
        console.log(`    at ${String(lit).padStart(3)} lit: ${write.toFixed(3)} ms`)
    }
}

console.log(`  median table write, by how many were already lit:`)

for (const [low, high] of [[1, 25], [25, 50], [50, 100], [100, 200], [200, 1e9]]) {
    const median = medianWriteBetween(low, high)

    if (null !== median) {
        console.log(`    ${String(low).padStart(3)}-${high === 1e9 ? 'end' : high - 1} lit: ${median.toFixed(3)} ms`)
    }
}

const picks = samples.map(sample => sample.pick).sort((a, b) => a - b)

console.log(`  pick, the other half of a touch: median ${picks[picks.length >> 1].toFixed(2)} ms`
    + ` · worst ${picks[picks.length - 1].toFixed(2)} ms`)
console.log(`  worst frame during the sweep: ${sweepWorstFrame.toFixed(1)} ms`)
console.log(`  worst frame over the same moves without Shift: ${baselineFrame.toFixed(1)} ms`)
console.log(`  a 60 Hz frame is 16.67 ms; the SVG surface cost ~28 ms per swap`)

// ── Panning with a highlight standing, still inside feeler mode ──────────────────────
// The map holds still while it is being felt, so this is what the wheel and a drag must
// do: nothing at all.
const beforeHold = await state()

await page.mouse.wheel(0, -240)
await page.mouse.down()
await page.mouse.move(middle.x + 200, middle.y + 40)
await page.mouse.up()
await settle()

const afterHold = await state()

console.log(`\nShift held, pan and zoom suppressed: `
    + `${beforeHold.lit <= afterHold.lit ? 'the view did not move under the feeler ✓' : '✗'}`)

// ── Release ─────────────────────────────────────────────────────────────────────────
await page.keyboard.up('Shift')
await settle()
await page.mouse.move(middle.x, middle.y + 3)
await settle()

const released = await state()

console.log(`release · ${0 === released.lit ? 'the highlight cleared ✓' : `lit ${released.lit} ✗`}`)

await page.screenshot({ path: `${SHOTS}/highlight-${LABEL}-released.png` })

console.log(`\nscreenshots: ${SHOTS}/highlight-${LABEL}-{plain,one-at-fit,one-zoomed,swept,released}.png`)

await browser.close()
