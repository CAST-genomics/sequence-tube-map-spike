/**
 * Frame meter — harness instrumentation, not part of the viewer.
 *
 * Smooth panning of ~10,345 live elements under a CSS transform is expected but
 * was unmeasured at design time, and the fallback ladder (reduce transition work,
 * then `content-visibility`, then reconsider — but never canvas, which forfeits
 * hit-testing) is only worth climbing against a number. Enable with `?fps`.
 */

export function startFrameMeter(host: HTMLElement): () => void {

    const readout = document.createElement('div')
    readout.className = 'harness-fps'
    readout.textContent = 'fps —'
    host.append(readout)

    let frame = 0
    let last = performance.now()
    let worst = 0
    const recent: number[] = []

    function tick(now: number): void {
        const delta = now - last
        last = now

        recent.push(delta)

        if (recent.length > 60) {
            recent.shift()
        }

        // Worst frame is the number that decides whether panning feels smooth;
        // an average hides exactly the stalls being hunted.
        worst = Math.max(worst, delta)

        const mean = recent.reduce((total, value) => total + value, 0) / recent.length
        readout.textContent = `${(1000 / mean).toFixed(0)} fps · worst ${worst.toFixed(1)} ms`

        frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    readout.addEventListener('click', () => {
        worst = 0
    })

    return () => {
        cancelAnimationFrame(frame)
        readout.remove()
    }
}
