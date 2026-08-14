/**
 * The surface: a three.js scene holding every band of one document, driven by
 * `MapControls`.
 *
 * ## What this is not
 *
 * There is no `{x, y, scale}` object, no fit-to-width transform, no hand-written wheel
 * handling and no CSS transform. Zoom is `camera.zoom`, pan is `camera.position`, and
 * gestures come from `MapControls` configured exactly as PGB configures it. The SVG
 * viewer reimplemented that library by hand because it had no three.js; this does not.
 *
 * ## The ladder
 *
 * There is one mesh in the scene: a strip of `RUNGS` quads spanning the band's parameter
 * from 0 to 1, two rows deep. It carries no positions — only, per vertex, a curve
 * parameter `t` and a flag saying which edge it belongs to. The vertex shader places
 * every rung from six per-instance floats, so zooming touches no geometry at all.
 *
 * Both edges of a band are cubics whose control points share an abscissa. Normalised by
 * the span, with `u` the control abscissa as a fraction:
 *
 *     x(t) = 3u·t·(1-t) + t³        y(t) = y0 + (y1-y0)·(3t² - 2t³)
 *
 * The y expansion is literally `smoothstep`, because the cubic's control ordinates are
 * copies of its endpoints. And `x(0) = 0`, `x(1) = 1` **for every u** — so the two edges
 * meet at both ends however much their control abscissae differ, and sampling both at the
 * same `t` yields a closed polygon inscribed in the true band with vertical ends.
 *
 * That is why there is no root-finding here. Placing rungs at even *x* would require
 * inverting `x(t)` per vertex, because the two edges have different `u` and so do not
 * share an x at equal t; placing them at even *t* removes the question. The cost is that
 * rungs are spaced unevenly in x — by no more than ~3× — which affects nothing, since
 * tessellation error follows curvature rather than spacing.
 *
 * `RUNGS = 64` leaves a worst-case chord error of 0.41 px in x and 0.06 px in y, measured
 * at 200× zoom on the widest piece in `5520+`. Sweeping it belongs with the coverage
 * comparison, where it can be judged against something.
 *
 * ## Zoom
 *
 * `zoom = 1` is fit-to-width by construction: the frustum is built so the content's full
 * width is visible at unit zoom, and the height follows the viewport's aspect. The
 * ceiling is 200×, which is ~38 px per band on `5520+`. The shipping viewer's 4× cap
 * would leave every haplotype thinner than a pixel on these documents, and float32
 * starts to show around 1000×.
 */

import {
    BufferAttribute,
    ColorManagement,
    GLSL3,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    LinearSRGBColorSpace,
    Mesh,
    OrthographicCamera,
    RawShaderMaterial,
    Scene,
    WebGLRenderer
} from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { THICKNESS, type ParsedMap } from './parseBands.ts'

// Bands carry the colours the document gave them, byte for byte. We are reproducing a
// picture, not lighting a scene, so nothing converts colour anywhere.
ColorManagement.enabled = false

/** Fit is 1 by construction. 200x is ~38 px per band on `5520+`. */
export const MIN_ZOOM = 1
export const MAX_ZOOM = 200

/** Quads per band along its span. See the note on tessellation error above. */
export const RUNGS = 64

const VERTEX = /* glsl */`
precision highp float;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uThickness;

in vec2 aParam;    // x: curve parameter 0..1, y: 0 = upper edge, 1 = lower edge
in vec4 iSpan;     // x0, y0, width, y1  — y0/y1 are the upper edge, world space
in vec2 iControl;  // control abscissa of the upper and lower edge, as a fraction
in vec3 iColor;

out vec3 vColor;

#ifdef ANALYTIC
uniform float uPad;

flat out vec4 vSpan;
flat out vec2 vControl;
out float vT;
out vec2 vWorld;
#endif

void main() {
    float t = aParam.x;
    float side = aParam.y;

    // Each edge carries its own control abscissa; they differ, so a band's thickness
    // varies along its length and the two edges are not translates of each other.
    float u = mix(iControl.x, iControl.y, side);

    // x(t) = 3u·t·(1-t) + t³, normalised. Zero at t=0 and one at t=1 for every u, so
    // both edges meet at the ends and the band closes without a seam.
    float x = iSpan.x + iSpan.z * (3.0 * u * t * (1.0 - t) + t * t * t);

    // The cubic's control ordinates are copies of its endpoints, so y collapses to
    // smoothstep. No bezier evaluation in y at all.
    float y = mix(iSpan.y, iSpan.w, t * t * (3.0 - 2.0 * t)) - side * uThickness;

    vColor = iColor;

#ifdef ANALYTIC
    // Grow the band by a pixel on each side so a band thinner than one pixel still
    // covers a fragment to compute coverage in. Without this a 0.19 px band would
    // simply miss every sample point and vanish.
    y += (1.0 - 2.0 * side) * uPad;

    vSpan = iSpan;
    vControl = iControl;
    vT = t;
    vWorld = vec2(x, y);
#endif

    gl_Position = projectionMatrix * modelViewMatrix * vec4(x, y, 0.0, 1.0);
}
`

const FRAGMENT = /* glsl */`
precision highp float;

in vec3 vColor;
out vec4 fragColor;

#ifdef ANALYTIC

uniform float uThickness;
uniform float uHalfPixel;

flat in vec4 vSpan;
flat in vec2 vControl;
in float vT;
in vec2 vWorld;

/**
 * Recover the curve parameter at this fragment's own x. The rungs give a value that is
 * close — it is linearly interpolated between two points on a curve — and two Newton
 * steps from there are exact to well inside a pixel.
 *
 * f(t)  = 3u·t·(1-t) + t³ - p
 * f'(t) = 3u·(1-2t) + 3t²,  which bottoms out at 3u(1-u) > 0, so this cannot stall.
 */
float parameterAt(float p, float u, float t) {
    for (int i = 0; i < 2; i += 1) {
        float f = 3.0 * u * t * (1.0 - t) + t * t * t - p;
        float d = 3.0 * u * (1.0 - 2.0 * t) + 3.0 * t * t;

        t -= f / max(d, 1e-5);
    }

    return clamp(t, 0.0, 1.0);
}

#endif

void main() {
#ifdef ANALYTIC
    float p = clamp((vWorld.x - vSpan.x) / vSpan.z, 0.0, 1.0);

    // Each edge has its own control abscissa, so each needs its own parameter at this x.
    float tTop = parameterAt(p, vControl.x, vT);
    float tBot = parameterAt(p, vControl.y, vT);

    float yTop = mix(vSpan.y, vSpan.w, tTop * tTop * (3.0 - 2.0 * tTop));
    float yBot = mix(vSpan.y, vSpan.w, tBot * tBot * (3.0 - 2.0 * tBot)) - uThickness;

    // What fraction of this pixel's height the band actually fills. A band covering a
    // fifth of the pixel contributes exactly a fifth — this one line is the whole
    // difference from MSAA, which can only answer in quarters.
    float lo = max(yBot, vWorld.y - uHalfPixel);
    float hi = min(yTop, vWorld.y + uHalfPixel);
    float coverage = clamp((hi - lo) / (2.0 * uHalfPixel), 0.0, 1.0);

    // Horizontal coverage at the two ends is ignored. Bands lap their neighbours by a
    // whole unit and are hundreds of units wide, so the ends are interior to the track.
    if (0.0 >= coverage) {
        discard;
    }

    fragColor = vec4(vColor, coverage);
#else
    fragColor = vec4(vColor, 1.0);
#endif
}
`

/**
 * Where a band's antialiasing comes from.
 *
 * `msaa` — opaque fragments, four hardware samples. Coverage can only be reported as
 * 0, ¼, ½, ¾ or 1, and `MAX_SAMPLES` is 4 on this hardware, so that is the ceiling.
 *
 * `analytic` — the fragment shader computes the exact fraction of the pixel the band
 * fills. This is what SVG's rasteriser does, and the reason the SVG looked right at
 * sub-pixel band heights.
 */
export type Coverage = 'msaa' | 'analytic'

/** Enough to rebuild the same view after the context is replaced. */
export interface CameraState {
    zoom: number
    position: [number, number, number]
    target: [number, number, number]
}

export interface BandSurface {
    /** Advance controls and draw. Call once per animation frame. */
    render(): void
    resize(): void
    /** Current camera zoom, where 1 is fit-to-width. */
    zoom(): number
    /** How tall one band is on screen right now, in CSS pixels. */
    bandHeightInPixels(): number
    /** For handing the view to a surface built with the other coverage. */
    cameraState(): CameraState
    dispose(): void
}

export function createBandSurface(
    map: ParsedMap,
    canvas: HTMLCanvasElement,
    coverage: Coverage,
    restore?: CameraState,
    rungs: number = RUNGS
): BandSurface {
    const analytic = 'analytic' === coverage

    // Hardware multisampling is the whole of the `msaa` arm and would double-count
    // against analytic coverage, so the two need different contexts. That is why
    // switching arms replaces the canvas rather than swapping a uniform.
    const renderer = new WebGLRenderer({
        canvas,
        antialias: false === analytic,
        alpha: false,
        premultipliedAlpha: false
    })

    renderer.outputColorSpace = LinearSRGBColorSpace
    renderer.setClearColor(0xffffff, 1)
    renderer.setPixelRatio(window.devicePixelRatio)

    const scene = new Scene()
    const camera = new OrthographicCamera()

    camera.position.set(0, 0, 5)
    camera.near = 0.1
    camera.far = 100

    const controls = new MapControls(camera, canvas)

    // PGB's configuration, verbatim. A researcher crosses between the two viewers
    // constantly and must not have to change hands.
    controls.zoomToCursor = true
    controls.enableRotate = false
    controls.screenSpacePanning = true
    controls.zoomSpeed = 1.2
    controls.panSpeed = 1
    controls.minZoom = MIN_ZOOM
    controls.maxZoom = MAX_ZOOM
    controls.target.set(0, 0, 0)

    if (undefined !== restore) {
        camera.zoom = restore.zoom
        camera.position.set(...restore.position)
        controls.target.set(...restore.target)
    }

    const geometry = buildLadder(rungs)

    if (false === Number.isInteger(rungs) || 1 > rungs) {
        throw new Error(`rungs must be a positive whole number, not ${rungs}.`)
    }

    geometry.setAttribute('iSpan', deinterleave(map.geometry, 6, 0, 4, map.bandCount))
    geometry.setAttribute('iControl', deinterleave(map.geometry, 6, 4, 2, map.bandCount))
    geometry.setAttribute('iColor', instanceColors(map))
    geometry.instanceCount = map.bandCount

    const material = new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        defines: analytic ? { ANALYTIC: '' } : {},
        uniforms: {
            uThickness: { value: THICKNESS },
            uHalfPixel: { value: 0 },
            uPad: { value: 0 }
        },
        // Coverage arrives as alpha, so the arm blends; the MSAA arm is opaque. Neither
        // uses a depth buffer: bands are opaque in the document and painted in order,
        // so instance order carries z-order where two tracks cross.
        transparent: analytic,
        depthTest: false,
        depthWrite: false
    })

    const mesh = new Mesh(geometry, material)

    // The whole map is one object and it is always in view; culling it per frame would
    // compute a bounding sphere over 40,442 instances to learn nothing.
    mesh.frustumCulled = false
    scene.add(mesh)

    resize()

    function resize(): void {
        const width = canvas.clientWidth
        const height = canvas.clientHeight

        renderer.setSize(width, height, false)
        renderer.setPixelRatio(window.devicePixelRatio)

        // Unit zoom shows the content's full width; the visible height falls out of the
        // viewport's aspect. On a 14:1 strip that means most of the screen is empty at
        // fit, which is what fit-to-width has always meant here.
        const half = map.content.width * 0.5

        camera.left = -half
        camera.right = half
        camera.top = half * height / width
        camera.bottom = -half * height / width
        camera.updateProjectionMatrix()
    }

    return {

        render(): void {
            controls.update()

            if (analytic) {
                // One device pixel, in world units. Everything sub-pixel is measured
                // against this, so it has to follow the device ratio and not just zoom.
                const pixel = map.content.width
                    / (camera.zoom * canvas.clientWidth * renderer.getPixelRatio())

                material.uniforms.uHalfPixel.value = pixel * 0.5
                material.uniforms.uPad.value = pixel
            }

            renderer.render(scene, camera)
        },

        resize,

        zoom(): number {
            return camera.zoom
        },

        bandHeightInPixels(): number {
            return THICKNESS * camera.zoom * canvas.clientWidth / map.content.width
        },

        cameraState(): CameraState {
            return {
                zoom: camera.zoom,
                position: camera.position.toArray(),
                target: controls.target.toArray()
            }
        },

        dispose(): void {
            controls.dispose()
            geometry.dispose()
            material.dispose()

            // `dispose()` releases three's own resources but **not** the WebGL context;
            // only `forceContextLoss()` does. Swapping coverage builds a new context
            // each time, and browsers cap live contexts near 16, so without this the
            // toggle would stop working after a dozen presses.
            renderer.forceContextLoss()
            renderer.dispose()
        }
    }
}

/**
 * The shared mesh, and the only geometry in the scene: `rungs` quads spanning the curve
 * parameter from 0 to 1, two rows deep. Carries no positions — the vertex shader places
 * every vertex from the instance's six floats.
 */
function buildLadder(rungs: number): InstancedBufferGeometry {
    const params = new Float32Array((rungs + 1) * 4)
    const indices: number[] = []

    for (let i = 0; i <= rungs; i += 1) {
        const t = i / rungs
        const o = i * 4

        params[o] = t
        params[o + 1] = 0
        params[o + 2] = t
        params[o + 3] = 1

        if (i < rungs) {
            const upper = i * 2

            indices.push(upper, upper + 1, upper + 2, upper + 2, upper + 1, upper + 3)
        }
    }

    const geometry = new InstancedBufferGeometry()

    geometry.setAttribute('aParam', new BufferAttribute(params, 2))
    geometry.setIndex(indices)

    return geometry
}

/** Pull one field out of the parser's interleaved six-floats-per-band layout. */
function deinterleave(
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

/**
 * Colour per instance, not a lookup texture. The texture exists to make highlighting
 * O(1) in the number of lit strands, and highlighting is not in this spike; 40,442
 * normalized bytes is 162 KB and one line.
 */
function instanceColors(map: ParsedMap): InstancedBufferAttribute {
    const rgba = new Uint8Array(map.bandCount * 4)

    for (let i = 0; i < map.bandCount; i += 1) {
        const track = map.trackIds[i] * 3

        rgba[i * 4] = map.trackColors[track]
        rgba[i * 4 + 1] = map.trackColors[track + 1]
        rgba[i * 4 + 2] = map.trackColors[track + 2]
        rgba[i * 4 + 3] = 255
    }

    // Four components rather than three so each instance starts on a 4-byte boundary.
    // The shader reads a vec3; the fourth byte is padding.
    return new InstancedBufferAttribute(rgba, 4, true)
}
