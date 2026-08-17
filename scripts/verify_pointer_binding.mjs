/**
 * #53's acceptance, run rather than argued: with controls and picking bound to the root,
 * an element overlaid on the canvas is not a hole, and chrome over the map is not the map.
 *
 * The camera is read off the navigator rect — the camera's own arithmetic, already in the
 * DOM — exactly as `scripts/verify_pick.mjs` does. The strand under the cursor is read off
 * the `?pick` readout.
 *
 * Headed, for the same reason `verify_pick.mjs` is: headless chromium rasterizes the pick
 * pass in software, and half of what is asserted here is what that pass answered.
 *
 * Every chrome check was run against a build with the shield removed, and every one of
 * them failed there — a drag of the navigator rect panned the map underneath it, a pointer
 * over the navigator picked the strand it covers, and a drag over the status layer panned.
 * The view-rect check is here because it caught exactly that with the shield *in place*:
 * the rect was `pointer-events: none`, so the element under the cursor over it was the
 * canvas and the pick ran on the map the navigator was covering.
 *
 *     node scripts/verify_pointer_binding.mjs   # with `npm run dev` already up
 */

import { chromium } from 'playwright'

const URL = 'http://localhost:5173/?pick'

const browser = await chromium.launch({ headless: false })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

await page.goto(URL, { waitUntil: 'networkidle' })
await page.bringToFront()
await page.waitForSelector('.stm-pick')
await page.waitForFunction(() => document.querySelector('.stm-status')?.hidden === true)

const rect = () => page.evaluate(() => {
    const element = document.querySelector('.stm-navigator-rect')
    return { left: parseFloat(element.style.left), top: parseFloat(element.style.top), width: parseFloat(element.style.width) }
})

const readout = () => page.textContent('.stm-pick')

const results = []
const check = (name, passed, detail) => {
    results.push({ name, passed, detail })
    console.log(`${passed ? '  ok  ' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function drag(from, to) {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(120)
}

// A stand-in for #37's segment boxes: a sibling of the canvas, over it, taking pointer
// events. It does not bubble to the canvas — only to the root.
async function overlay(taking) {
    await page.evaluate(takes => {
        document.querySelector('#probe-overlay')?.remove()
        const box = document.createElement('div')
        box.id = 'probe-overlay'
        box.style.cssText =
            `position:absolute;left:600px;top:300px;width:120px;height:300px;z-index:2;background:transparent;pointer-events:${takes ? 'auto' : 'none'}`
        document.querySelector('.stm-root').append(box)
    }, taking)
}

// ── 1. Pan over the bare canvas ────────────────────────────────────────────────────────
await page.mouse.wheel(0, -600)          // off fit, so there is somewhere to pan to
await page.waitForTimeout(150)
const beforePan = await rect()
await drag({ x: 700, y: 450 }, { x: 500, y: 450 })
const afterPan = await rect()
check('drag on the canvas pans', afterPan.left !== beforePan.left,
    `rect.left ${beforePan.left} → ${afterPan.left}`)

// ── 2. Pan starting on an element overlaid on the canvas ───────────────────────────────
await overlay(true)
const beforeOverlayPan = await rect()
await drag({ x: 660, y: 450 }, { x: 460, y: 450 })
const afterOverlayPan = await rect()
check('drag starting on an overlay pans', afterOverlayPan.left !== beforeOverlayPan.left,
    `rect.left ${beforeOverlayPan.left} → ${afterOverlayPan.left}`)

// ── 3. Wheel zoom aimed at an overlaid element ─────────────────────────────────────────
const beforeWheel = await rect()
await page.mouse.move(660, 450)
await page.mouse.wheel(0, -400)
await page.waitForTimeout(150)
const afterWheel = await rect()
check('wheel over an overlay zooms', afterWheel.width < beforeWheel.width,
    `rect.width ${beforeWheel.width} → ${afterWheel.width}`)

// ── 4. The feeler reaches through an overlaid element ──────────────────────────────────
//
// The claim is that the overlay changes nothing, so it is asserted as a comparison at one
// point rather than as "a strand was found" — which would also depend on there being ink
// under that pixel at whatever zoom this arrived at.
// Back to fit, where the whole map is on screen and a column through the middle of the
// viewport is certain to cross ink. Zoomed in, most of the overlay's column is gap.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => document.querySelector('.stm-status')?.hidden === true)
// The opening framing settles over a frame or two — the resize observer re-fits a view
// nobody has moved yet. Picks taken across that move answer about different pixels.
await page.waitForTimeout(500)
await page.keyboard.down('Shift')

/** The strand named at `point`, with the overlay taking pointer events or not. */
async function feel(point, taking) {
    await overlay(taking)
    // Two moves: the first arrives, the second is the one whose pick is read, so the
    // answer cannot be a leftover from wherever the cursor was before.
    await page.mouse.move(point.x + 1, point.y + 1)
    await page.mouse.move(point.x, point.y)
    await page.waitForTimeout(200)
    return (await readout()).split('·')[0].trim()
}

// Somewhere over the overlay with ink under it — the box spans the map's whole height at
// fit, and most of a column through it is still gap.
let felt = null

for (let y = 310; y < 590 && null === felt; y += 4) {
    const bare = await feel({ x: 660, y }, false)

    if (/strand \d+/.test(bare)) {
        felt = { y, bare }
    }
}

if (null === felt) {
    check('the feeler picks through an overlay', false, 'no strand under the overlay to feel')
} else {
    // Bare, overlaid, bare again at the one point: three readings, so a mismatch that is
    // really the view having moved cannot read as the overlay having changed the answer.
    const before = await feel({ x: 660, y: felt.y }, false)
    const covered = await feel({ x: 660, y: felt.y }, true)
    const after = await feel({ x: 660, y: felt.y }, false)

    check('the feeler picks through an overlay', covered === before && after === before,
        `bare ${before} · overlaid ${covered} · bare ${after}`)
}

// ── 5. Chrome over the map does not drive a pick ───────────────────────────────────────
//
// Zoomed in first, until the map is taller than the viewport — at fit the map is a 249 px
// band across the middle and the navigator sits below it in empty space, where "no strand"
// is the right answer for every binding and the check would prove nothing. The assertion
// is the pair: ink at that point with the navigator out of the way, none with it there.
await overlay(false)

const navigator = await page.locator('.stm-navigator').boundingBox()

/** What is felt at `point` with the navigator taken out of the document's way. */
async function feelUnderNavigator(point) {
    await page.evaluate(() => { document.querySelector('.stm-navigator').style.display = 'none' })
    const bare = await feel(point, false)
    await page.evaluate(() => { document.querySelector('.stm-navigator').style.display = '' })
    return bare
}

let underNavigator = null

// Zoom until there is ink where the navigator is, rather than assuming a zoom that puts it
// there: at fit the map is a band across the middle and the navigator sits below it.
for (let attempt = 0; attempt < 5 && null === underNavigator; attempt += 1) {
    for (let dx = -200; dx <= 200 && null === underNavigator; dx += 25) {
        const point = { x: navigator.x + navigator.width / 2 + dx, y: navigator.y + navigator.height / 2 }
        const bare = await feelUnderNavigator(point)

        if (/strand \d+/.test(bare)) {
            underNavigator = { point, bare }
        }
    }

    if (null === underNavigator) {
        // `Shift` released for the wheel: feeler mode switches the controls off, which is
        // itself part of what ships, so zooming while it is held is a no-op by design.
        await page.keyboard.up('Shift')
        await page.mouse.move(700, 450)
        await page.mouse.wheel(0, -900)
        await page.waitForTimeout(200)
        await page.keyboard.down('Shift')
    }
}

if (null === underNavigator) {
    check('a pointer over the navigator does not pick', false, 'no strand under the navigator to shadow')
} else {
    const shadowed = await feel(underNavigator.point, false)
    check('a pointer over the navigator does not pick', 'strand —' === shadowed,
        `${underNavigator.bare} under it, ${shadowed} over it`)
}

// The view rect specifically, because it is the part of the navigator that used to be a
// window through it: drawn over the thumbnail but transparent to hit-testing, so the
// element under the cursor there was the canvas and the surface picked what it covers.
const viewRect = await page.locator('.stm-navigator-rect').boundingBox()
const inRect = { x: viewRect.x + viewRect.width / 2, y: viewRect.y + viewRect.height / 2 }
const bareInRect = await feelUnderNavigator(inRect)

if (false === /strand \d+/.test(bareInRect)) {
    check('a pointer over the navigator’s view rect does not pick', false, 'no strand under the rect to shadow')
} else {
    const shadowedInRect = await feel(inRect, false)
    check('a pointer over the navigator’s view rect does not pick', 'strand —' === shadowedInRect,
        `${bareInRect} under it, ${shadowedInRect} over it`)
}

await page.keyboard.up('Shift')

// ── 6. Dragging the navigator jumps the view and does not also pan the map ─────────────
//
// Off fit, whatever the search above left behind: at fit the rect fills the thumbnail and
// clamps, so there is nowhere for a jump to land and this would pass on a navigator that
// did nothing at all.
await page.mouse.move(700, 450)
await page.mouse.wheel(0, -600)
await page.waitForTimeout(200)

const beforeJump = await rect()
// Pressed outside the rect, which centers the view on the pointer and then follows it —
// so where the rect must end up is arithmetic, not a direction.
const grabbed = { x: navigator.x + navigator.width * 0.8, y: navigator.y + navigator.height / 2 }
const dropped = { x: navigator.x + navigator.width * 0.45, y: navigator.y + navigator.height / 2 }

await drag(grabbed, dropped)

const afterJump = await rect()
check('the navigator still jumps the view', afterJump.left !== beforeJump.left,
    `rect.left ${beforeJump.left} → ${afterJump.left}`)

// Centered on where it was let go. A map that also panned under the drag would put the
// rect somewhere else entirely — this is what says it did not.
const asked = (dropped.x - navigator.x) - afterJump.width / 2
check('the navigator drag did not also pan the map', Math.abs(afterJump.left - asked) < 3,
    `rect.left ${afterJump.left.toFixed(1)} vs asked ${asked.toFixed(1)}`)

// Taken hold of *inside* the rect, which now hit-tests where it used to be transparent:
// the rect follows the pointer exactly, rather than jumping its center to it.
const held = await rect()
const grabBox = await page.locator('.stm-navigator-rect').boundingBox()
const from = { x: grabBox.x + grabBox.width / 2, y: grabBox.y + grabBox.height / 2 }
const to = { x: from.x - 60, y: from.y }

await drag(from, to)

const dragged = await rect()
check('a grab inside the view rect still drags it', Math.abs(dragged.left - (held.left - 60)) < 3,
    `rect.left ${held.left.toFixed(1)} → ${dragged.left.toFixed(1)}, asked ${(held.left - 60).toFixed(1)}`)

// ── 7. The status layer, shown, takes its own events ───────────────────────────────────
await page.evaluate(() => { document.querySelector('.stm-status').hidden = false })
const beforeStatus = await rect()
await drag({ x: 700, y: 450 }, { x: 500, y: 450 })
const afterStatus = await rect()
check('a drag over the status layer does not pan', afterStatus.left === beforeStatus.left,
    `rect.left ${beforeStatus.left} → ${afterStatus.left}`)

await browser.close()

const failed = results.filter(result => false === result.passed)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(0 === failed.length ? 0 : 1)
