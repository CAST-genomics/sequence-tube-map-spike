/**
 * Verify the pick pass against the document — #38's acceptance, run rather than argued.
 *
 * The predictor here is ground truth computed on the CPU from the same parsed bands the
 * GPU was handed: for a world point, which bands put ink in the pick pixel, and which of
 * them is last in document order. The pass has to agree.
 *
 * Two things this deliberately does not assume:
 *
 * - **Headed, so it runs on the real GPU.** Headless chromium falls back to SwiftShader,
 *   where the readback stall is software rasterization — 80 ms a pick, and a number that
 *   says nothing about whether this fits in a frame.
 * - **The camera is read back, never predicted.** It is recovered from the navigator rect,
 *   which is the camera's own arithmetic already in the DOM. An earlier version assumed
 *   `zoomToCursor` held the point under the cursor fixed across 130 wheel steps; it does
 *   not, quite, and the drift looked exactly like a picking bug.
 *
 *     node scripts/verify_pick.mjs        # with `npm run dev` already up
 */

import { chromium } from 'playwright'

const URL = 'http://localhost:5173/?pick'
const DOCUMENT = '/stm-chr1-25331046-25331646.svg'
const SAMPLES = 120
const DEEP_SAMPLES = 20
/** Enough wheel steps to reach the 200x clamp from fit, whatever the step size works out to. */
const WHEEL_STEPS = 140
/** The haplotype whose every band is picked, to show the answer is a strand and not a piece. */
const STRAND = 368

const browser = await chromium.launch({ headless: false })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

await page.goto(URL, { waitUntil: 'networkidle' })
await page.bringToFront()
await page.waitForSelector('.stm-pick')
await page.waitForFunction(() => document.querySelector('.stm-status')?.hidden === true)

// The parser the surface itself uses, run in the page through vite's transform, so the
// prediction is made against exactly the bands the GPU was handed.
const { bandCount, content, groups } = await page.evaluate(async source => {
    const { parseBands } = await import('/src/parseBands.ts')
    const map = parseBands(await (await fetch(source)).text())

    window.__map = map

    const THICKNESS = 15
    const smooth = t => t * t * (3 - 2 * t)

    /** Solve x(t) = p. Bisection: ground truth, not the shader's two Newton steps. */
    const solve = (p, u) => {
        let lo = 0
        let hi = 1

        for (let i = 0; i < 80; i += 1) {
            const t = (lo + hi) * 0.5

            if (3 * u * t * (1 - t) + t * t * t < p) {
                lo = t
            } else {
                hi = t
            }
        }

        return (lo + hi) * 0.5
    }

    /** The band's two edges at a world x, or null if the band does not span it. */
    const edges = (band, worldX) => {
        const at = band * 6
        const x0 = map.geometry[at]
        const y0 = map.geometry[at + 1]
        const width = map.geometry[at + 2]
        const y1 = map.geometry[at + 3]

        if (worldX < x0 || worldX > x0 + width) {
            return null
        }

        const p = (worldX - x0) / width

        return {
            top: y0 + (y1 - y0) * smooth(solve(p, map.geometry[at + 4])),
            bottom: y0 + (y1 - y0) * smooth(solve(p, map.geometry[at + 5])) - THICKNESS
        }
    }

    /** The strand the pass must answer: the last band in document order putting any ink in
     *  a pick pixel of `size` world units centred on the point. */
    window.__predict = (worldX, worldY, size) => {
        let answer = null

        for (let band = 0; band < map.bandCount; band += 1) {
            const edge = edges(band, worldX)

            if (null === edge) {
                continue
            }

            const lo = Math.max(edge.bottom, worldY - size * 0.5)
            const hi = Math.min(edge.top, worldY + size * 0.5)

            if (hi - lo > 0) {
                answer = map.strandIds[band]
            }
        }

        return answer
    }

    /**
     * The vertical middle of a band at a given world x — the point to aim at when the band
     * is wider than the window. At 200x the view is 178 units across and bands are
     * hundreds, so a band's own mid-span is usually nowhere near the screen.
     */
    window.__pointAt = (band, worldX) => {
        const edge = edges(band, worldX)

        return null === edge
            ? null
            : { x: worldX, y: (edge.top + edge.bottom) * 0.5, strandId: map.strandIds[band] }
    }

    /** The vertical middle of a band at its own mid-span: a point unambiguously inside it. */
    window.__centre = band => {
        const at = band * 6
        const worldX = map.geometry[at] + map.geometry[at + 2] * 0.5
        const edge = edges(band, worldX)

        return { x: worldX, y: (edge.top + edge.bottom) * 0.5, strandId: map.strandIds[band] }
    }

    // How interleaved the document is: a strand's bands are not emitted together, so
    // nothing about the file's order groups a haplotype. Only the id does.
    let runs = 1

    for (let band = 1; band < map.bandCount; band += 1) {
        if (map.strandIds[band] !== map.strandIds[band - 1]) {
            runs += 1
        }
    }

    return {
        bandCount: map.bandCount,
        content: map.content,
        groups: { runs, strands: new Set(map.strandIds).size }
    }
}, DOCUMENT)

const canvas = await page.locator('canvas.stm-canvas').boundingBox()

console.log(`document:  ${bandCount} bands · ${content.width.toFixed(0)} x ${content.height} units`)
console.log(`grouping:  ${groups.strands} strands, but ${groups.runs} contiguous runs — the file does not group a haplotype`)
console.log(`viewport:  ${canvas.width} x ${canvas.height} css px\n`)

/**
 * The camera, read out of the navigator rect rather than predicted.
 *
 * `visibleContentRect` put it there; this is that function run backwards. The rect is
 * clipped for drawing, so this is only trustworthy once the view is inside the map —
 * which is every zoom past fit.
 */
async function camera() {
    const nav = await page.evaluate(() => {
        const thumbnail = document.querySelector('.stm-navigator-thumbnail')
        const rect = document.querySelector('.stm-navigator-rect')

        return {
            thumbnail: thumbnail.clientWidth,
            left: parseFloat(rect.style.left),
            top: parseFloat(rect.style.top),
            width: parseFloat(rect.style.width),
            height: parseFloat(rect.style.height)
        }
    })

    const scale = nav.thumbnail / content.width
    const visible = {
        x: nav.left / scale,
        y: nav.top / scale,
        width: nav.width / scale,
        height: nav.height / scale
    }

    return {
        x: visible.x - content.width * 0.5 + visible.width * 0.5,
        y: content.height * 0.5 - visible.y - visible.height * 0.5,
        zoom: canvas.width / visible.width
    }
}

/** Fit is the one view the navigator rect cannot report, because it is clipped there. */
const fitView = { x: 0, y: 0, zoom: canvas.width / content.width }

const screenAt = (world, view) => ({
    x: canvas.x + canvas.width * 0.5 + (world.x - view.x) * view.zoom,
    y: canvas.y + canvas.height * 0.5 - (world.y - view.y) * view.zoom
})

/**
 * Whether a pointer at this point would actually reach the surface.
 *
 * Several things sit over the canvas and take their own pointer events — the navigator,
 * the harness's URL picker, the readout itself — and a point under any of them produces no
 * pick at all, which is indistinguishable from a picking failure until you ask what is
 * really there. Asking the page beats keeping a list of overlays in sync with the CSS.
 */
const reachesCanvas = point => page.evaluate(
    ([x, y]) => true === document.elementFromPoint(x, y)?.classList.contains('stm-canvas'),
    [point.x, point.y]
)

const onCanvas = point =>
    point.x > canvas.x + 2 && point.x < canvas.x + canvas.width - 2
    && point.y > canvas.y + 2 && point.y < canvas.y + canvas.height - 2

/** Blank the readout so the value read next is certainly a fresh pick. */
async function armPick() {
    await page.evaluate(() => { document.querySelector('.stm-pick').textContent = 'strand —' })
}

async function readPick(timeout) {
    await page.waitForFunction(
        () => document.querySelector('.stm-pick').textContent.includes(' ms'),
        null,
        { timeout }
    )

    const text = await page.locator('.stm-pick').textContent()
    const strand = /^strand (\S+)/.exec(text)[1]

    return {
        strandId: '\u2014' === strand ? null : Number(strand),
        milliseconds: Number(/\u00b7 ([\d.]+) ms/.exec(text)[1])
    }
}

/** Two animation frames: long enough for a pick already scheduled to have run. */
async function settle() {
    await page.evaluate(() => new Promise(done =>
        requestAnimationFrame(() => requestAnimationFrame(done))))
}

/**
 * Park, settle, arm, move once, read.
 *
 * The parking move is what makes the next one a move at all — a pointer already at the
 * target reports nothing — and settling before arming is what keeps a pick scheduled for
 * the parking spot from being read as the answer for the target. At fit one css pixel is
 * 25 world units, so a stale frame reads as a confidently wrong haplotype.
 *
 * Pointer events do get dropped between the driver and the page, and a dropped one is
 * indistinguishable from empty space until it is asked again — hence the retries, each
 * parking somewhere slightly different so the move is unambiguous.
 */
async function pickAt(point) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
        await page.mouse.move(canvas.x + 3 + attempt * 2, canvas.y + 3)
        await settle()
        await armPick()
        await page.mouse.move(point.x, point.y)

        try {
            return await readPick(2000)
        } catch {
            continue
        }
    }

    throw new Error(`no pick after four attempts at ${point.x.toFixed(1)}, ${point.y.toFixed(1)}`)
}

const summarise = list => {
    const sorted = [...list].sort((a, b) => a - b)
    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]

    return `median ${at(0.5).toFixed(2)} ms · p95 ${at(0.95).toFixed(2)} ms · worst ${at(1).toFixed(2)} ms`
}

// ── At fit, where every band is sub-pixel and thousands overlap ──────────────────────
const fitCosts = []
const fitWrong = []
let fitAgreed = 0
let fitTried = 0

for (let i = 0; i < SAMPLES; i += 1) {
    const band = Math.floor(i * bandCount / SAMPLES)
    const centre = await page.evaluate(b => window.__centre(b), band)
    const expected = await page.evaluate(
        ([x, y, s]) => window.__predict(x, y, s),
        [centre.x, centre.y, 1 / fitView.zoom]
    )

    const point = screenAt(centre, fitView)

    if (false === await reachesCanvas(point)) {
        continue
    }

    fitTried += 1

    const got = await pickAt(point)

    fitCosts.push(got.milliseconds)

    if (got.strandId === expected) {
        fitAgreed += 1
    } else {
        fitWrong.push({ band, expected, got: got.strandId })
    }
}

console.log(`fit · a band is ${(15 * fitView.zoom).toFixed(2)} css px tall, one pick pixel spans ${(1 / fitView.zoom).toFixed(1)} units`)
console.log(`  agrees with the document on ${fitAgreed}/${fitTried} points`)

if (fitWrong.length > 0) {
    console.log('  disagreements:', JSON.stringify(fitWrong.slice(0, 8)))
}

// ── One haplotype, all of its pieces ─────────────────────────────────────────────────
// The document does not emit a strand's bands together — 10,270 bands form 6,016
// contiguous runs — so this is the claim being tested rather than assumed: separate
// elements, scattered through the file and across the map, answering with one haplotype.
const subject = await page.evaluate(id => {
    const map = window.__map
    const bands = []

    for (let band = 0; band < map.bandCount; band += 1) {
        if (map.strandIds[band] === id) {
            bands.push(band)
        }
    }

    return { strandId: id, bands }
}, STRAND)

let answered = 0
let tested = 0
let occluded = 0
const hapWrong = []
let minX = Infinity
let maxX = -Infinity
let minY = Infinity
let maxY = -Infinity

for (const band of subject.bands) {
    const centre = await page.evaluate(b => window.__centre(b), band)
    const expected = await page.evaluate(
        ([x, y, s]) => window.__predict(x, y, s),
        [centre.x, centre.y, 1 / fitView.zoom]
    )

    const point = screenAt(centre, fitView)

    if (false === await reachesCanvas(point)) {
        continue
    }

    tested += 1

    const got = await pickAt(point)

    minX = Math.min(minX, centre.x)
    maxX = Math.max(maxX, centre.x)
    minY = Math.min(minY, centre.y)
    maxY = Math.max(maxY, centre.y)

    if (got.strandId === subject.strandId) {
        answered += 1
    } else if (got.strandId === expected) {
        // Another strand is genuinely on top of this band at this point. The pick is
        // right; this band is simply not the one visible there.
        occluded += 1
    } else {
        hapWrong.push({ band, expected, got: got.strandId })
    }
}

console.log(`\nhaplotype, not fragment · strand ${subject.strandId}, ${subject.bands.length} separate bands`)
console.log(`  spanning x ${(maxX - minX).toFixed(0)} units and y ${(maxY - minY).toFixed(0)} units`)
console.log(`  reachable and tested: ${tested}`)
console.log(`  answered with strand ${subject.strandId}: ${answered}`)
console.log(`  occluded by a strand drawn over it, and the pick said so: ${occluded}`)
console.log(`  wrong: ${hapWrong.length} ${0 === hapWrong.length ? '\u2713' : JSON.stringify(hapWrong)}`)

// ── Empty space ──────────────────────────────────────────────────────────────────────
const empty = await pickAt({ x: canvas.x + canvas.width * 0.5, y: canvas.y + 4 })

console.log(`\nempty space above the map: ${null === empty.strandId ? 'no strand ✓' : `strand ${empty.strandId} ✗`}`)

// ── Zoomed to the clamp, where a band is ~118 css px tall ────────────────────────────
const deepCosts = []
const deepWrong = []
let deepAgreed = 0
let deepTried = 0

await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5)

for (let i = 0; i < WHEEL_STEPS; i += 1) {
    await page.mouse.wheel(0, -120)
}

await page.waitForTimeout(200)

const deep = await camera()

console.log(`\ndeep · ${(deep.zoom / fitView.zoom).toFixed(0)}x fit, a band is ${(15 * deep.zoom).toFixed(0)} css px tall,`
    + ` one pick pixel spans ${(1 / deep.zoom).toFixed(3)} units`)

// Only ~0.5% of the width is on screen at this zoom, so the sample has to come from what
// is in front of the camera rather than from a stride through the whole document.
const visibleBands = await page.evaluate(([x0, x1, y0, y1, wanted]) => {
    const map = window.__map
    const found = []

    for (let band = 0; band < map.bandCount && found.length < wanted; band += 1) {
        const at = band * 6
        const x = map.geometry[at]
        const width = map.geometry[at + 2]
        const y = map.geometry[at + 1]

        if (x + width > x0 && x < x1 && y > y0 && y - 15 < y1) {
            found.push(band)
        }
    }

    return found
}, [
    deep.x - canvas.width * 0.5 / deep.zoom,
    deep.x + canvas.width * 0.5 / deep.zoom,
    deep.y - canvas.height * 0.5 / deep.zoom,
    deep.y + canvas.height * 0.5 / deep.zoom,
    DEEP_SAMPLES * 4
])

for (const band of visibleBands) {
    // Aim down the middle column of the view, where every visible band crosses.
    const centre = await page.evaluate(([b, x]) => window.__pointAt(b, x), [band, deep.x])
    const point = null === centre ? null : screenAt(centre, deep)

    if (null === point || false === onCanvas(point) || false === await reachesCanvas(point)) {
        continue
    }

    deepTried += 1

    const expected = await page.evaluate(
        ([x, y, s]) => window.__predict(x, y, s),
        [centre.x, centre.y, 1 / deep.zoom]
    )

    const got = await pickAt(point)

    deepCosts.push(got.milliseconds)

    if (got.strandId === expected) {
        deepAgreed += 1
    } else {
        deepWrong.push({ band, expected, got: got.strandId })
    }
}

console.log(`  agrees with the document on ${deepAgreed}/${deepTried} reachable points`)

if (deepWrong.length > 0) {
    console.log('  disagreements:', JSON.stringify(deepWrong.slice(0, 8)))
}

console.log(`\ncost · wall clock, including the synchronous readback stall`)
console.log(`  at fit:  ${summarise(fitCosts)}`)
console.log(`  at 200x: ${0 === deepCosts.length ? 'no samples' : summarise(deepCosts)}`)
console.log(`  a 60 Hz frame is 16.67 ms`)

await browser.close()
