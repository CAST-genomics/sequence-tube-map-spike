/**
 * Fetch and prepare a tube map document.
 *
 * The response is parsed with `DOMParser` rather than assigned to `innerHTML`, so
 * it can be cleaned before it is ever attached: one reflow instead of two, and no
 * half-drawn flash. The server's layout is otherwise opaque and immutable — the
 * only edit made here is stripping the empty `<title>` elements, which are dead
 * weight (one per drawable, 10,345 in the sample) and fight custom tooltips.
 */

import type { Size } from './viewportTransform.ts'

export interface TubeMap {
    /** The prepared, unattached SVG element. */
    svg: SVGSVGElement
    /** Content extent in viewBox units — the coordinate space the transform works in. */
    content: Size
    /** Serialized form of the prepared SVG, for baking the navigator thumbnail. */
    source: string
}

export class TubeMapLoadError extends Error {

    constructor(message: string, readonly kind: 'network' | 'content') {
        super(message)
        this.name = 'TubeMapLoadError'
    }
}

export async function loadTubeMap(url: string, signal?: AbortSignal): Promise<TubeMap> {
    const text = await fetchText(url, signal)
    return prepareTubeMap(text)
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
    let response: Response

    try {
        response = await fetch(url, { signal })
    } catch (error) {
        if (signal?.aborted) {
            throw error
        }
        throw new TubeMapLoadError(`Could not reach ${url} — ${describe(error)}`, 'network')
    }

    if (false === response.ok) {
        throw new TubeMapLoadError(`Server returned ${response.status} ${response.statusText} for ${url}`, 'network')
    }

    return await response.text()
}

function prepareTubeMap(text: string): TubeMap {
    if (0 === text.trim().length) {
        throw new TubeMapLoadError('The response was empty — no tube map for this minigraph node.', 'content')
    }

    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml')

    if (null !== parsed.querySelector('parsererror')) {
        throw new TubeMapLoadError('The response was not valid SVG.', 'content')
    }

    const svg = parsed.documentElement as unknown as SVGSVGElement

    if ('svg' !== svg.nodeName.toLowerCase()) {
        throw new TubeMapLoadError('The response was not an SVG document.', 'content')
    }

    for (const title of Array.from(parsed.getElementsByTagName('title'))) {
        title.remove()
    }

    const content = contentSize(svg)

    // Lay the strip out at exactly one CSS pixel per viewBox unit; every subsequent
    // magnification is the CSS transform's job, so the vectors stay sharp.
    svg.setAttribute('width', String(content.width))
    svg.setAttribute('height', String(content.height))
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet')

    return { svg, content, source: new XMLSerializer().serializeToString(svg) }
}

function contentSize(svg: SVGSVGElement): Size {
    const viewBox = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)

    if (4 === viewBox.length && viewBox.every(n => Number.isFinite(n)) && viewBox[2] > 0 && viewBox[3] > 0) {
        return { width: viewBox[2], height: viewBox[3] }
    }

    const width = Number(svg.getAttribute('width'))
    const height = Number(svg.getAttribute('height'))

    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return { width, height }
    }

    throw new TubeMapLoadError('The SVG declares no usable viewBox or size.', 'content')
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
