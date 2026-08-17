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
 * of isolating a strand with the cursor, and a map that moved under a sweep would slide the
 * strand out from under the feeler mid-gesture. The mode exists to hold the picture still
 * while the cursor reads it, which is a reason of its own and not the hit-test cost.
 *
 * This was shared by two surfaces, which answered the key differently below it and had to
 * agree above it. **#40 left one, 2026-08-16**, and with it went the `armed` option — the
 * SVG surface passed it false because its highlight cost ~28 ms a swap, and there is no
 * longer a caller with a reason to leave the mode unreachable. The key is always live.
 *
 * The module survives the surface it was factored out for, because what it owns is still
 * one coherent thing and still not the surface's: the listeners, the flag, the
 * `is-feeling` class the stylesheet hangs the cursor off, and the badge — including the
 * fact that a window losing focus while the key is down never reports the key coming up.
 * Everything about what feeling *does* stays with the surface that does it.
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
    onEnter(): void
    onLeave(): void
}

export function watchFeelerKey(options: FeelerKeyOptions): FeelerKey {

    const { root } = options
    const doc = root.ownerDocument
    const view = doc.defaultView ?? window

    // The stylesheet fades it in with `is-feeling`.
    const badge = doc.createElement('div')

    badge.className = 'stm-mode-badge'
    badge.textContent = 'feeler'
    root.append(badge)

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

    view.addEventListener('keydown', onKeyDown)
    view.addEventListener('keyup', onKeyUp)
    view.addEventListener('blur', onBlur)

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
            badge.remove()
        }
    }
}
