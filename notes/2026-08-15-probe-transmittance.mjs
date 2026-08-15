/**
 * How much of the background shows through the bundle, measured rather than reasoned.
 *
 * Render the same view over a white ground and a black ground and subtract: the difference is
 * the fraction of the background surviving at that pixel — the transmittance T — and it is
 * independent of what colour the bands themselves are. T = 0 is opaque. T = 0.25 means a
 * quarter of whatever is behind is showing. Empty sky measures 1.000, which is what says the
 * method works.
 *
 * Findings and what they mean: `notes/2026-08-15-how-much-shows-through.md`.
 *
 * ## This needs a temporary hook, deliberately not shipped
 *
 * It renders the surface's own scene directly, at zooms it chooses, which nothing in the
 * viewer's interface allows. Add this line to `gpu()` in `src/bandSurface.ts`, above
 * `context = {`, run the probe, then take it out again:
 *
 *     ;(window as unknown as Record<string, unknown>).__probe = { renderer, scene, camera, controls, material }
 *
 * A permanent hook would be a hole in the surface's interface for the sake of one afternoon's
 * measurement. The measurement is recorded; the hole is not.
 *
 * **The trap, which caught the first run of this:** `draw()` is what sets `uHalfPixel` and
 * `uPad` from the current zoom. Render directly and they still hold the *previous* zoom's
 * pixel size, so the shader measures coverage against the wrong pixel and every band comes
 * back translucent by the same constant at every zoom — a plausible, wrong, flat 25%.
 */
import { chromium } from 'playwright'

const DOCUMENT = process.argv[2] ?? '/stm-chr1-25331046-25331646.svg'
const browser = await chromium.launch({ headless: false })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

await page.goto(`http://localhost:5173/?url=${encodeURIComponent(DOCUMENT)}`, { waitUntil: 'networkidle' })
await page.bringToFront()
await page.waitForFunction(() => document.querySelector('.stm-status')?.hidden === true)

for (const bandPx of [0.6, 1.5, 3, 8, 30]) {
    const out = await page.evaluate(async px => {
        const { renderer, scene, camera, material } = window.__probe
        const gl = renderer.getContext()

        // 15 world units per band; zoom is css px per world unit.
        camera.zoom = px / 15
        camera.updateProjectionMatrix()

        // The coverage uniforms follow the zoom, and `draw()` is what normally sets them.
        // This renders directly, so it has to set them itself or the shader measures coverage
        // against the wrong pixel — which is what invalidated the first run of this probe.
        const pixel = 1 / (camera.zoom * renderer.getPixelRatio())

        material.uniforms.uHalfPixel.value = pixel * 0.5
        material.uniforms.uPad.value = pixel

        const w = gl.drawingBufferWidth
        const h = gl.drawingBufferHeight
        const read = colour => {
            const pixels = new Uint8Array(w * h * 4)

            renderer.setClearColor(colour, 1)
            renderer.render(scene, camera)
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

            return pixels
        }

        const white = read(0xffffff)
        const black = read(0x000000)

        renderer.setClearColor(0xffffff, 1)
        renderer.render(scene, camera)

        // Transmittance per pixel, and only over the middle column band of the viewport, so
        // the empty sky above and below the strip cannot flatter the numbers.
        const centre = Math.floor(w / 2)
        const column = []

        for (let y = 0; y < h; y += 1) {
            const at = (y * w + centre) * 4
            const t = (white[at] - black[at]) / 255

            column.push(t)
        }

        // Rows the bundle actually occupies: anything not fully transparent sky.
        const inside = column.map((t, y) => ({ t, y })).filter(row => row.t < 0.999)
        const ts = inside.map(row => row.t).sort((a, b) => a - b)
        const q = f => ts.length === 0 ? NaN : ts[Math.min(ts.length - 1, Math.floor(ts.length * f))]

        return {
            zoom: camera.zoom,
            rowsInBundle: inside.length,
            opaqueRows: ts.filter(t => t <= 0.01).length,
            leakyRows: ts.filter(t => t > 0.05).length,
            median: q(0.5),
            p90: q(0.9),
            worst: q(1),
            mean: ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length)
        }
    }, bandPx)

    console.log(`band ${String(bandPx).padStart(4)} css px · zoom ${out.zoom.toFixed(4)}`
        + ` · rows in bundle ${String(out.rowsInBundle).padStart(4)}`
        + ` · opaque ${String(out.opaqueRows).padStart(4)}`
        + ` · leaking >5% ${String(out.leakyRows).padStart(4)}`
        + ` · T median ${out.median.toFixed(3)} mean ${out.mean.toFixed(3)} p90 ${out.p90.toFixed(3)} worst ${out.worst.toFixed(3)}`)
}

await browser.close()
