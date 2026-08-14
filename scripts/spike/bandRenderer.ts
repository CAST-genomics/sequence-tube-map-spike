/**
 * The band renderer — the thing the fidelity gate is testing.
 *
 * DISPOSABLE spike code. One instanced draw call over a shared parametric ladder,
 * replicated per band. Two arms, selected by `coverage`:
 *
 *   'analytic' — the ADR's choice. The fragment shader computes exact vertical
 *                coverage against both edges, reproducing what makes SVG look right
 *                at 0.2 CSS px per band.
 *   'msaa'     — the control arm. Opaque fragments, hardware multisampling. The ADR
 *                predicts this aliases 464 stacked sub-pixel ribbons into noise;
 *                that prediction is what the harness is here to test.
 *
 * Three things are deliberate and look like bugs if you do not know why:
 *
 * 1. `ColorManagement.enabled = false` and a linear-sRGB output space, which together
 *    mean *no conversion at all*. SVG composites in non-linear sRGB. We are
 *    reproducing a specific rasterizer, not lighting a scene.
 * 2. No depth buffer, and instances uploaded in document order. Bands are opaque and
 *    SVG paints them with the painter's algorithm, so instance order *is* z-order.
 * 3. Rungs are placed at even *x*, not at even curve parameter. The two edges of a
 *    band have different control abscissae, so equal-t points do not share an x and
 *    the quads would skew. The vertex shader inverts x(t) by Newton instead — cheap,
 *    and safe because x'(t) = 3u(1-u) > 0 for every u the survey found.
 */

import {
    BufferAttribute,
    ClampToEdgeWrapping,
    ColorManagement,
    DataTexture,
    GLSL3,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    LinearSRGBColorSpace,
    Mesh,
    NearestFilter,
    NormalBlending,
    OrthographicCamera,
    RGBAFormat,
    RawShaderMaterial,
    Scene,
    UnsignedByteType,
    WebGLRenderer
} from 'three'
import { THICKNESS, type ParsedMap } from './parseBands.ts'

ColorManagement.enabled = false

export type Coverage = 'analytic' | 'msaa'

export interface RendererOptions {
    canvas: HTMLCanvasElement
    coverage: Coverage
    /** Rungs per band. Fixed at 64 for the verdict; swept at MAX_SCALE only. */
    rungs?: number
    pixelRatio: number
}

/** The CSS-transform view state, unchanged from `viewportTransform.ts`. */
export interface Transform {
    x: number
    y: number
    scale: number
}

const VERTEX = /* glsl */`
precision highp float;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uThickness;
uniform float uPad;

in vec2 aParam;        // x: 0..1 along the span, y: 0 = top edge, 1 = bottom edge
in vec4 iSpan;         // x0, y0, width, y1
in vec2 iControl;      // control abscissa of the top and bottom edge, as a fraction
in float iTrack;

out float vTrack;
out float vWorldY;
out float vTopY;
out float vBottomY;

/**
 * Invert x(t) for a cubic whose control points share an abscissa at fraction u.
 * Normalized, X(t) = 3u*t*(1-t) + t^3, strictly increasing because its derivative
 * bottoms out at 3u(1-u) > 0. Four Newton steps from t = p land well inside float.
 */
float invertX(float p, float u) {
    float t = p;

    for (int i = 0; i < 4; i += 1) {
        float f = 3.0 * u * t * (1.0 - t) + t * t * t - p;
        float d = 3.0 * u * (1.0 - 2.0 * t) + 3.0 * t * t;
        t -= f / max(d, 1e-6);
    }

    return clamp(t, 0.0, 1.0);
}

void main() {
    float p = aParam.x;
    float side = aParam.y;

    float x0 = iSpan.x;
    float y0 = iSpan.y;
    float width = iSpan.z;
    float y1 = iSpan.w;

    // The y profile of each edge is literally smoothstep in the curve parameter;
    // the work is finding the parameter that sits at this rung's x.
    float tTop = invertX(p, iControl.x);
    float tBottom = invertX(p, iControl.y);

    float top = y0 + (y1 - y0) * (tTop * tTop * (3.0 - 2.0 * tTop));
    float bottom = y0 + uThickness + (y1 - y0) * (tBottom * tBottom * (3.0 - 2.0 * tBottom));

    vTopY = top;
    vBottomY = bottom;
    vTrack = iTrack;

    // Grow the quad by half a pixel so partially covered rows are rasterized at all.
    float y = mix(top - uPad, bottom + uPad, side);
    vWorldY = y;

    // SVG's y runs downward; negating here lets an untouched viewportTransform drive
    // the camera without either side flipping handedness.
    gl_Position = projectionMatrix * modelViewMatrix * vec4(x0 + width * p, -y, 0.0, 1.0);
}
`

const FRAGMENT = /* glsl */`
precision highp float;

uniform sampler2D uTrackTable;
uniform float uHalfPixel;

in float vTrack;
in float vWorldY;
in float vTopY;
in float vBottomY;

out vec4 fragColor;

void main() {
    vec4 appearance = texelFetch(uTrackTable, ivec2(int(vTrack + 0.5), 0), 0);

    #ifdef ANALYTIC
        // Exact vertical overlap of this band with this pixel's row. The edges
        // interpolate linearly between rungs, which at 64 rungs is far finer than
        // the pixel this is measured against.
        float lo = max(vTopY, vWorldY - uHalfPixel);
        float hi = min(vBottomY, vWorldY + uHalfPixel);
        float coverage = clamp((hi - lo) / (2.0 * uHalfPixel), 0.0, 1.0);
    #else
        float coverage = 1.0;
    #endif

    if (0.0 == coverage) {
        discard;
    }

    fragColor = vec4(appearance.rgb, coverage * appearance.a);
}
`

export interface BandRenderer {
    /** Draw at this view state. Viewport size is read from the canvas. */
    draw(transform: Transform): void
    /** Rewrite one track's appearance. Cost is independent of how many are lit. */
    setTrackAppearance(trackId: number, rgb: [number, number, number], dim: number): void
    /** Push pending appearance edits. Separated so a batch costs one upload. */
    commitAppearance(): void
    /** Restore every track to the colour the document gave it. */
    resetAppearance(): void
    dispose(): void
}

export function createBandRenderer(map: ParsedMap, options: RendererOptions): BandRenderer {
    const rungs = options.rungs ?? 64
    const analytic = 'analytic' === options.coverage

    const renderer = new WebGLRenderer({
        canvas: options.canvas,
        antialias: false === analytic,
        alpha: false,
        premultipliedAlpha: false
    })

    // No conversion anywhere: parsed bytes reach the framebuffer untouched, and the
    // GPU blends them in sRGB exactly as SVG does.
    renderer.outputColorSpace = LinearSRGBColorSpace
    renderer.setClearColor(0xffffff, 1)
    renderer.setPixelRatio(options.pixelRatio)

    const geometry = buildLadder(rungs)

    geometry.setAttribute('iSpan', instanced(map.geometry, 6, 0, 4, map.bandCount))
    geometry.setAttribute('iControl', instanced(map.geometry, 6, 4, 2, map.bandCount))
    geometry.setAttribute('iTrack', new InstancedBufferAttribute(Float32Array.from(map.trackIds), 1))
    geometry.instanceCount = map.bandCount

    const table = new Uint8Array(map.trackCount * 4)
    resetTable()

    const texture = new DataTexture(table, map.trackCount, 1, RGBAFormat, UnsignedByteType)
    texture.minFilter = texture.magFilter = NearestFilter
    texture.wrapS = texture.wrapT = ClampToEdgeWrapping
    texture.needsUpdate = true

    const material = new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        defines: analytic ? { ANALYTIC: '' } : {},
        uniforms: {
            uThickness: { value: THICKNESS },
            uTrackTable: { value: texture },
            uHalfPixel: { value: 0.5 },
            uPad: { value: 0 }
        },
        transparent: analytic,
        blending: NormalBlending,
        depthTest: false,
        depthWrite: false
    })

    const mesh = new Mesh(geometry, material)
    mesh.frustumCulled = false

    const scene = new Scene()
    scene.add(mesh)

    const camera = new OrthographicCamera(0, 1, 1, 0, 0, 10)
    camera.position.z = 1

    function resetTable(): void {
        for (let id = 0; id < map.trackCount; id += 1) {
            table[id * 4] = map.trackColors[id * 3]
            table[id * 4 + 1] = map.trackColors[id * 3 + 1]
            table[id * 4 + 2] = map.trackColors[id * 3 + 2]
            table[id * 4 + 3] = 255
        }
    }

    return {

        draw(transform: Transform): void {
            const width = options.canvas.clientWidth
            const height = options.canvas.clientHeight
            const dpr = renderer.getPixelRatio()

            renderer.setSize(width, height, false)

            // The same mapping the CSS transform performed: screen = t.xy + scale *
            // (content - viewBox origin). Solved for the visible content window.
            const { minX, minY } = map.viewBox
            const left = minX - transform.x / transform.scale
            const top = minY - transform.y / transform.scale

            camera.left = left
            camera.right = left + width / transform.scale
            camera.top = -top
            camera.bottom = -(top + height / transform.scale)
            camera.updateProjectionMatrix()

            // One device pixel, in content units. Everything sub-pixel is measured
            // against this, so it has to follow dpr and not just scale.
            const pixel = 1 / (transform.scale * dpr)

            material.uniforms.uHalfPixel.value = pixel * 0.5
            material.uniforms.uPad.value = analytic ? pixel : 0

            renderer.render(scene, camera)
        },

        setTrackAppearance(trackId: number, rgb: [number, number, number], dim: number): void {
            table[trackId * 4] = rgb[0]
            table[trackId * 4 + 1] = rgb[1]
            table[trackId * 4 + 2] = rgb[2]
            table[trackId * 4 + 3] = Math.round(255 * dim)
        },

        commitAppearance(): void {
            texture.needsUpdate = true
        },

        resetAppearance(): void {
            resetTable()
            texture.needsUpdate = true
        },

        dispose(): void {
            geometry.dispose()
            material.dispose()
            texture.dispose()
            renderer.dispose()
        }
    }
}

/**
 * The shared mesh: a strip of `rungs` quads spanning 0..1 in x, two rows in y. Every
 * band in the map is this one shape, placed by the vertex shader.
 */
function buildLadder(rungs: number): InstancedBufferGeometry {
    const params = new Float32Array((rungs + 1) * 2 * 2)
    const indices: number[] = []

    for (let i = 0; i <= rungs; i += 1) {
        const p = i / rungs
        const o = i * 4

        params[o] = p
        params[o + 1] = 0
        params[o + 2] = p
        params[o + 3] = 1

        if (i < rungs) {
            const a = i * 2
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
    }

    const geometry = new InstancedBufferGeometry()
    geometry.setAttribute('aParam', new BufferAttribute(params, 2))
    geometry.setIndex(indices)

    return geometry
}

/** Deinterleave one field out of the parser's packed six-floats-per-band layout. */
function instanced(
    source: Float32Array,
    stride: number,
    offset: number,
    size: number,
    count: number
): InstancedBufferAttribute {
    const packed = new Float32Array(count * size)

    for (let i = 0; i < count; i += 1) {
        for (let c = 0; c < size; c += 1) {
            packed[i * size + c] = source[i * stride + offset + c]
        }
    }

    return new InstancedBufferAttribute(packed, size)
}
