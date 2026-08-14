/**
 * Frame time on screen while you drag.
 *
 * "Feels smooth" is not by itself evidence: the SVG surface panned at a respectable
 * 8.3 ms and still failed for other reasons. This turns the impression into a number the
 * moment you doubt it.
 *
 * Reports a decayed average rather than the instantaneous value, which is unreadable,
 * and the worst frame seen in the last second, which is where a stutter actually shows.
 */
export interface FrameMeter {
    /** Call once per animation frame, before drawing. */
    tick(): void
    /** Decayed mean, milliseconds. */
    mean(): number
    /** Worst frame in the last second, milliseconds. */
    worst(): number
}

export function createFrameMeter(): FrameMeter {
    let previous = performance.now()
    let decayed = 16.7
    let worst = 0
    let worstSince = previous

    return {

        tick(): void {
            const now = performance.now()
            const delta = now - previous

            previous = now

            // Ignore the gap across a tab switch or a breakpoint; it is not a frame.
            if (500 < delta) {
                return
            }

            decayed += (delta - decayed) * 0.1

            if (delta > worst) {
                worst = delta
            }

            if (1000 < now - worstSince) {
                worst = delta
                worstSince = now
            }
        },

        mean: () => decayed,
        worst: () => worst
    }
}
