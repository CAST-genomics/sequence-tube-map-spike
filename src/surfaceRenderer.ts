/**
 * What a surface renderer is, and the only thing the mount knows about the two of them.
 *
 * `mountTubeMapSurface` owns the container, the fetch, the spinner and the error state;
 * it never learns whether the picture is an SVG document under a CSS transform or a
 * WebGL scene. Everything about the *view* — fitting, zooming, what a resize does to the
 * framing — belongs to the renderer, because the two answer it in different vocabularies
 * and neither answer is the mount's business.
 *
 * `show` takes the response text rather than a parsed document: the two renderers read
 * the same bytes in incompatible ways — one with `DOMParser` into a live tree, one with a
 * regex into six floats per band — and choosing between them is exactly what selecting a
 * renderer means.
 */

/** Which picture the surface draws. `svg` is the CSS-transform viewer; `webgl` the band renderer. */
export type RendererName = 'svg' | 'webgl'

export interface SurfaceRenderer {
    /**
     * Display the document. Throws if this renderer cannot draw it — the mount turns that
     * into the error state, so a renderer never renders half a map.
     */
    show(text: string): void
    /** Drop the current document, leaving the surface empty and ready for another. */
    clear(): void
    /**
     * The container changed size. Preserve the view and reveal more or less of the map,
     * except that a view still untouched at initial fit re-fits (`CONTEXT.md` #10).
     */
    resize(): void
    /** Remove every listener, node and GPU resource this renderer created. */
    destroy(): void
}

/** Builds a renderer inside `host`, which is the mount's root element. */
export type SurfaceRendererFactory = (host: HTMLElement) => SurfaceRenderer
