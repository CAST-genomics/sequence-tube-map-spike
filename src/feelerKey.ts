/**
 * What `Shift` means, in one place: the key, the mode flag, the cursor, and the badge.
 *
 * `CONTEXT.md` #13 once made `Shift` the arbiter of pointer ownership, with pan, zoom and
 * segment hit-testing all yielding to it. **Amended 2026-08-15: it no longer arbitrates
 * segments.** Held, the strand under the cursor is emphasized *in addition to* whatever the
 * cursor is already doing — a segment hovered under `Shift` shows its tooltip exactly as it
 * does without the key, and releasing subtracts the emphasis and nothing else. The exclusion
 * existed to keep two interaction sets off one hit-test that cost ~28 ms, and that hit-test
 * is gone. **Pan and zoom still yield, and that is settled**: holding the key *is* the act
 * of isolating a track with the cursor, and a map that moved under a sweep would slide the
 * strand out from under the feeler mid-gesture. The mode exists to hold the picture still
 * while the cursor reads it, which is a reason of its own and not the hit-test cost.
 *
 * The two surfaces still answer the key *differently* below it: the SVG surface cancels a
 * drag and probes with `elementFromPoint` — it is unchanged, and the arbitrating description
 * above still fits it — while the WebGL surface runs a pick pass and lets segment hover
 * through. What they must not differ about is when the mode is on, what the researcher sees
 * when it is, or the fact that a window losing focus while the key is down never reports the
 * key coming up.
 *
 * So this module owns exactly that much and no more: the listeners, the flag, the
 * `is-feeling` class the stylesheet hangs the crosshair off, and the badge. Everything about
 * what feeling *does* stays with the surface that does it.
 */

/** A mode that is held rather than toggled. */
export interface FeelerKey {
    /** True while the key is down and the mode is armed. */
    active(): boolean
    /** Leave the mode as if the key had come up. Idempotent. */
    release(): void
    destroy(): void
}

export interface FeelerKeyOptions {
    /** Carries the `is-feeling` class and hosts the badge. */
    root: HTMLElement
    /**
     * Whether the key does anything at all. Left false, the mode is *unreachable* rather than
     * merely unused: no listener is registered, so nothing can set the flag and every branch
     * that reads it takes the other side for the mount's whole life. The SVG surface needs
     * this — its highlight costs ~28 ms a swap (`CONTEXT.md` #15) — and the WebGL surface
     * does not.
     */
    armed: boolean
    onEnter(): void
    onLeave(): void
}

export function watchFeelerKey(options: FeelerKeyOptions): FeelerKey {

    const { root, armed } = options
    const doc = root.ownerDocument
    const view = doc.defaultView ?? window

    // The badge announces a mode that cannot be entered unless the key is armed, so it is
    // mounted only alongside it. The stylesheet fades it in with `is-feeling`.
    const badge = armed ? doc.createElement('div') : null

    if (null !== badge) {
        badge.className = 'stm-mode-badge'
        badge.textContent = 'feeler'
        root.append(badge)
    }

    let held = false

    function enter(): void {
        if (held) {
            return
        }

        held = true
        root.classList.add('is-feeling')
        options.onEnter()
    }

    function leave(): void {
        if (false === held) {
            return
        }

        held = false
        root.classList.remove('is-feeling')
        options.onLeave()
    }

    function onKeyDown(event: KeyboardEvent): void {
        if ('Shift' === event.key) {
            enter()
        }
    }

    function onKeyUp(event: KeyboardEvent): void {
        if ('Shift' === event.key) {
            leave()
        }
    }

    // A `Shift`-held window that loses focus never reports the key going up, so without this
    // the map stays receded and unpannable with nothing on screen saying why.
    function onBlur(): void {
        leave()
    }

    if (armed) {
        view.addEventListener('keydown', onKeyDown)
        view.addEventListener('keyup', onKeyUp)
        view.addEventListener('blur', onBlur)
    }

    return {

        active(): boolean {
            return held
        },

        release(): void {
            leave()
        },

        destroy(): void {
            view.removeEventListener('keydown', onKeyDown)
            view.removeEventListener('keyup', onKeyUp)
            view.removeEventListener('blur', onBlur)
            badge?.remove()
        }
    }
}
