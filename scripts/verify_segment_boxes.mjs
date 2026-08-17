/**
 * #37's acceptance, run rather than argued, on the document it was written about.
 *
 * `5514+` is the largest map we have: 767 segment boxes over 38,423 bands, a median box of
 * 18 × 5613 in a map 6,360 tall. Every claim in the ticket that could be wrong without
 * looking wrong is checked here against the live surface — the counts against the document,
 * the visibility threshold against the camera, and the pointer rules against real gestures.
 *
 * What this cannot check is the thing the ticket says to judge by looking: whether the
 * wrapper tears or drops tiles at 200×. It takes the screenshots (`/tmp/stm-segments-*.png`)
 * so that looking is one step rather than a setup.
 *
 * Headed, for the same reason `verify_pick.mjs` is: headless chromium rasterizes the pick
 * pass in software, and the feeler check reads what that pass answered.
 *
 *     node scripts/verify_segment_boxes.mjs   # with `npm run dev` already up
 */

import { chromium } from 'playwright'

const ORIGIN = 'http://localhost:5173'
const DOCUMENT = '/stm-node-5514-chr1-25301271-25309238.svg'

/** What the fixture holds, counted out of the file by `parseSegmentBoxes.test.ts`. */
const BOXES = 767

const browser = await chromium.launch({ headless: false })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

const results = []
const check = (name, passed, detail) => {
    results.push({ name, passed })
    console.log(`${true === passed ? '  ok  ' : '  FAIL'}  ${name}${undefined === detail ? '' : ` — ${detail}`}`)
}

async function open(query = '') {
    await page.goto(`${ORIGIN}/?url=${DOCUMENT}${query}`, { waitUntil: 'networkidle' })
    await page.bringToFront()
    await page.waitForFunction(() => document.querySelector('.stm-status')?.hidden === true)
    // The opening framing settles over a frame or two — the resize observer re-fits a view
    // nobody has moved yet.
    await page.waitForTimeout(600)
}

/** What the overlay looks like right now, read out of the DOM rather than off a screenshot. */
const overlay = () => page.evaluate(() => {
    const wrapper = document.querySelector('.stm-segments')
    const boxes = [...wrapper.children]
    const scale = /scale\(([\d.]+)\)/.exec(wrapper.style.transform)

    return {
        boxes: boxes.length,
        visible: boxes.filter(box => false === box.hidden).length,
        zoom: null === scale ? 0 : Number(scale[1]),
        willChange: getComputedStyle(wrapper).willChange,
        svg: wrapper.querySelectorAll('svg, path').length,
        // The widest box, and the narrowest one still drawn — the threshold is per box, so
        // its shape is a list that fills largest-first rather than a switch.
        narrowestVisible: boxes
            .filter(box => false === box.hidden)
            .map(box => box.getBoundingClientRect().width)
            .sort((a, b) => a - b)[0] ?? null
    }
})

const tooltip = () => page.evaluate(() => {
    const element = document.querySelector('.graph-tooltip')

    return {
        shown: element.classList.contains('is-shown'),
        title: element.querySelector('.node-title')?.textContent ?? null,
        rows: [...element.querySelectorAll('.node-detail-row')]
            .map(row => [...row.children].map(cell => cell.textContent).join(' '))
    }
})

const viewRect = () => page.evaluate(() => {
    const element = document.querySelector('.stm-navigator-rect')

    return { left: parseFloat(element.style.left), width: parseFloat(element.style.width) }
})

/**
 * A screenshot, and then the wait it costs.
 *
 * Capturing in headed mode takes the pointer off the page — the root sees a `pointerleave`
 * and the tooltip hides, correctly, because the cursor really did leave. So every shot is
 * followed by a settle, and every hover is re-entered after one.
 */
async function shot(name) {
    await page.screenshot({ path: `/tmp/stm-segments-${name}.png` })
    await page.waitForTimeout(300)
}

/** Point at `where`, arriving rather than teleporting, and let the hover settle. */
async function hover(where) {
    await page.mouse.move(where.x - 6, where.y - 6)
    await page.mouse.move(where.x - 2, where.y - 2)
    await page.mouse.move(where.x, where.y)
    await page.waitForTimeout(250)
}

/** Zoom in on the middle of the viewport until the camera stops moving. */
async function zoomToClamp() {
    for (let step = 0; step < 30; step += 1) {
        await page.mouse.move(700, 450)
        await page.mouse.wheel(0, -600)
        await page.waitForTimeout(60)
    }

    await page.waitForTimeout(300)
}

/** The visible box nearest the middle of the viewport, and where to point at it. */
const nearestBox = () => page.evaluate(() => {
    let best = null

    for (const box of document.querySelectorAll('.stm-segment')) {
        if (true === box.hidden) {
            continue
        }

        const bounds = box.getBoundingClientRect()

        if (bounds.right < 40 || bounds.left > innerWidth - 40) {
            continue
        }

        const middle = bounds.left + bounds.width / 2
        const distance = Math.abs(middle - 700)

        if (null === best || distance < best.distance) {
            best = { distance, x: middle, y: 450, id: box.dataset.stmSegment }
        }
    }

    return best
})

// ── 1. The document decides how many boxes there are, and how wide ─────────────────────
await open()

const atFit = await overlay()

check('every box in the document is mounted', BOXES === atFit.boxes, `${atFit.boxes} boxes`)
check('the overlay introduces no SVG', 0 === atFit.svg, `${atFit.svg} svg or path elements`)
check('the wrapper carries no will-change', 'auto' === atFit.willChange, atFit.willChange)

// ── 2. The visibility threshold ────────────────────────────────────────────────────────
//
// At fit an 18-unit box is 0.14 css px, and 767 of those are a picket fence over the map
// that can be neither read nor hovered.
check('no box is drawn at fit', 0 === atFit.visible, `${atFit.visible} of ${atFit.boxes} at zoom ${atFit.zoom}`)

await shot('fit')

/** How many boxes are drawn, walking in from fit. Must never go down. */
const arrivals = []

for (let step = 0; step < 12; step += 1) {
    await page.mouse.move(700, 450)
    await page.mouse.wheel(0, -500)
    await page.waitForTimeout(100)
    arrivals.push(await overlay())
}

check('boxes arrive largest-first as the camera closes',
    arrivals.every((state, at) => 0 === at || state.visible >= arrivals[at - 1].visible),
    arrivals.map(state => state.visible).join(' → '))

const partway = arrivals[arrivals.length - 1]

check('no box is drawn below ~1.5 css px of screen width',
    null === partway.narrowestVisible || partway.narrowestVisible >= 1.5,
    `narrowest drawn ${partway.narrowestVisible?.toFixed(2)} px`)

await zoomToClamp()

const at200 = await overlay()

check('every box is drawn at the 200× clamp', BOXES === at200.visible,
    `${at200.visible} of ${at200.boxes} at zoom ${at200.zoom}`)

// The screenshot the ticket asks to be looked at: `5514+` at 200×, boxes and all.
await shot('200x')

// ── 3. Hovering a box, with no key held ────────────────────────────────────────────────
const box = await nearestBox()

if (null === box) {
    check('a box is reachable at 200×', false, 'nothing visible near the middle of the viewport')
} else {
    await hover(box)

    const hovered = await tooltip()

    check('hovering needs no modifier key', hovered.shown, `tooltip for segment ${box.id}`)
    check('the tooltip names the segment', /^\d+$/.test(hovered.title ?? ''), hovered.title)
    check('the tooltip gives length and sequence',
        2 === hovered.rows.length && /^Length \d+ bp$/.test(hovered.rows[0]) && hovered.rows[1].startsWith('Sequence '),
        hovered.rows.join(' · '))
    check('a long sequence is truncated', (hovered.rows[1]?.length ?? 0) <= 'Sequence '.length + 33,
        hovered.rows[1])

    const filled = await page.evaluate(id => {
        const element = document.querySelector(`[data-stm-segment="${id}"]`)
        return getComputedStyle(element).backgroundColor
    }, box.id)

    check('hovering fills the box', 'rgba(255, 255, 255, 0.6)' === filled, filled)

    await shot('hover')

    // ── 4. Shift adds the strand, and takes nothing away ───────────────────────────────
    await hover(box)
    await page.keyboard.down('Shift')
    await page.mouse.move(box.x + 1, box.y)
    await page.mouse.move(box.x, box.y)
    await page.waitForTimeout(250)

    const feeling = await page.evaluate(() => ({
        tooltip: document.querySelector('.graph-tooltip').classList.contains('is-shown'),
        mode: document.querySelector('.stm-root').classList.contains('is-feeling')
    }))

    check('Shift adds strand emphasis without removing the tooltip',
        feeling.mode && feeling.tooltip, `feeling ${feeling.mode}, tooltip ${feeling.tooltip}`)

    await shot('shift')

    // Re-entered after the screenshot: the tooltip hid because the cursor genuinely left,
    // and the next check is about the key rather than about the pointer.
    await hover(box)

    await page.keyboard.up('Shift')
    await page.waitForTimeout(200)

    const released = await page.evaluate(() => ({
        tooltip: document.querySelector('.graph-tooltip').classList.contains('is-shown'),
        mode: document.querySelector('.stm-root').classList.contains('is-feeling')
    }))

    check('releasing Shift drops the emphasis and leaves the tooltip standing',
        released.tooltip && false === released.mode, `feeling ${released.mode}, tooltip ${released.tooltip}`)

    // ── 5. The feeler reaches the strand under the box ─────────────────────────────────
    //
    // The box is over the map, not beside it: the pick pass must answer for the pixel it
    // covers. Read off the `?pick` readout, which is the only thing that says the answer.
    await open('&pick')
    await zoomToClamp()

    const picked = await nearestBox()

    if (null === picked) {
        check('the feeler picks the strand under a box', false, 'no box visible to reach through')
    } else {
        await page.keyboard.down('Shift')
        await hover(picked)

        const readout = await page.textContent('.stm-pick')

        await page.keyboard.up('Shift')

        check('the feeler picks the strand under a box', /strand \d+/.test(readout), readout.split('·')[0].trim())
    }

    // ── 6. Pan and zoom pass through ───────────────────────────────────────────────────
    const target = await nearestBox()

    const beforeWheel = await viewRect()
    await page.mouse.move(target.x, target.y)
    await page.mouse.wheel(0, 400)
    await page.waitForTimeout(200)
    const afterWheel = await viewRect()

    check('a wheel aimed at a box zooms the map', afterWheel.width !== beforeWheel.width,
        `rect.width ${beforeWheel.width} → ${afterWheel.width}`)

    const panFrom = await nearestBox()
    const beforePan = await viewRect()

    await page.mouse.move(panFrom.x, panFrom.y)
    await page.mouse.down()
    await page.mouse.move(panFrom.x - 200, panFrom.y, { steps: 12 })

    const midDrag = await tooltip()

    await page.mouse.up()
    await page.waitForTimeout(200)

    const afterPan = await viewRect()

    check('a drag starting on a box pans the map', afterPan.left !== beforePan.left,
        `rect.left ${beforePan.left} → ${afterPan.left}`)
    check('the tooltip hides for the duration of a drag', false === midDrag.shown)

    // ── 7. A drag through the tooltip does not select its text ─────────────────────────
    //
    // A drag anchors a selection *range*, and a range spans whatever lies between its ends
    // — so a pan that crossed the tooltip highlighted it in blue and left it that way, even
    // though the tooltip is `pointer-events: none` and was never the drag's target. Found
    // by looking, 2026-08-16; the map is a picture, and nothing over it is a document.
    const shown = await nearestBox()

    await hover(shown)

    const tip = await page.locator('.graph-tooltip').boundingBox()

    await page.mouse.move(tip.x - 40, tip.y + tip.height / 2)
    await page.mouse.down()
    await page.mouse.move(tip.x + tip.width + 60, tip.y + tip.height / 2, { steps: 25 })
    await page.mouse.up()
    await page.waitForTimeout(200)

    const selected = await page.evaluate(() => String(getSelection()))

    check('a drag through the tooltip selects nothing', '' === selected, JSON.stringify(selected))
}

// ── 8. The cursor says what the surface is doing ───────────────────────────────────────
//
// `MapControls` takes pointer capture on the root, and a captured pointer stops hit-testing
// for `:hover` and `:active` — so `.stm-canvas:active` stopped matching the moment the drag
// it described began, and the arrow came back mid-pan. Read off `getComputedStyle` of the
// root, which is the element the capture makes current and therefore the one that decides
// what is drawn.
const cursors = () => page.evaluate(() => {
    const root = document.querySelector('.stm-root')
    const segment = [...document.querySelectorAll('.stm-segment')].find(one => false === one.hidden)

    return {
        root: getComputedStyle(root).cursor,
        canvas: getComputedStyle(document.querySelector('.stm-canvas')).cursor,
        segment: undefined === segment ? null : getComputedStyle(segment).cursor
    }
})

const idle = await cursors()

check('the map offers a grip when idle', 'grab' === idle.canvas && 'grab' === idle.segment,
    `canvas ${idle.canvas}, segment ${idle.segment}`)

await page.mouse.move(700, 450)
await page.mouse.down()

const pressed = await cursors()

await page.mouse.move(560, 450, { steps: 12 })

const dragging = await cursors()

await page.mouse.up()
await page.waitForTimeout(100)

const dropped = await cursors()

check('pressing takes hold', 'grabbing' === pressed.root, pressed.root)
check('and moving keeps hold of it', 'grabbing' === dragging.root && 'grabbing' === dragging.canvas,
    `root ${dragging.root}, canvas ${dragging.canvas}`)
check('letting go lets go', 'grab' === dropped.canvas, dropped.canvas)

// Released off the surface, which is how most drags of a map end.
await page.mouse.move(700, 450)
await page.mouse.down()
await page.mouse.move(700, 40, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(100)

check('a drag released off the surface lets go too', 'grab' === (await cursors()).canvas)

// A wheel is not a grip. The controls announce `start`/`end` around one, which is why this
// is bound to the pointer instead.
await page.mouse.move(700, 450)
await page.mouse.wheel(0, -400)
await page.waitForTimeout(100)

check('a wheel notch does not flash the hand', 'grab' === (await cursors()).canvas)

// Feeling switches the controls off, so a grabbing hand would promise a pan that cannot
// happen.
await page.keyboard.down('Shift')
await page.mouse.move(700, 450)
await page.mouse.down()

const feelingPress = await cursors()

await page.mouse.up()
await page.keyboard.up('Shift')

check('pressing while feeling promises no pan',
    'pointer' === feelingPress.canvas && 'pointer' === feelingPress.segment,
    `canvas ${feelingPress.canvas}, segment ${feelingPress.segment}`)

// ── 9. A refused document leaves no boxes behind ───────────────────────────────────────
//
// The overlay mounts under the status layer, so the error state covers it — but covering is
// not emptying, and a map's boxes standing over the next document's error message would be
// the previous map still on screen.
await page.goto(`${ORIGIN}/?url=/does-not-exist.svg`, { waitUntil: 'networkidle' })
await page.waitForSelector('.stm-status.is-error')
await page.waitForTimeout(200)

const cleared = await overlay()

check('a refused document leaves no boxes behind', 0 === cleared.boxes, `${cleared.boxes} boxes`)

await browser.close()

const failed = results.filter(result => false === result.passed)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log('screenshots: /tmp/stm-segments-fit.png, -200x, -hover, -shift')
process.exit(0 === failed.length ? 0 : 1)
