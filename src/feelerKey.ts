/**
 * What `Shift` means, in one place: the key, the mode flag, the cursor, and the badge.
 *
 * `CONTEXT.md` #13 makes `Shift` the arbiter of pointer ownership — held, the cursor is a
 * feeler and pan, zoom and segment hit-testing all yield to it; released, the map is a map
 * again. Both surfaces answer that, and they answer it *differently* below the key: the SVG
 * surface cancels a drag and probes with `elementFromPoint`, the WebGL surface switches
 * `MapControls` off and runs a pick pass. What they must not differ about is when the mode is
 * on, what the researcher sees when it is, or the fact that a window losing focus while the
 * key is down never reports the key coming up.
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
