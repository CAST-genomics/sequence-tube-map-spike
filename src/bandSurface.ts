/**
 * The WebGL surface: a three.js scene holding every band of one document, driven by
 * `MapControls`.
 *
 * Rewritten from `spike/bandSurface.ts` after the verdict in
 * `notes/2026-08-14-three-js-renderer-verdict.md`. Two things changed in the rewrite and
 * nothing else did:
 *
 * - **Only analytic coverage is built.** The spike carried both arms on a live toggle so
 *   they could be judged against each other on the same frame; that comparison is over
 *   and technique C won, so the `#ifdef` ladder, the second WebGL context and the camera
 *   hand-off between them are all gone. `docs/RENDERING.md` keeps the comparison.
 * - **The camera is framed in pixels**, not in the content's own width — see
 *   `bandCamera.ts` for why, which is entirely about what a resize should do.
 *
 * ## What this is not
 *
 * There is no `{x, y, scale}` object, no fit-to-width transform, no hand-written wheel
 * handling and no CSS transform. Zoom is `camera.zoom`, pan is `camera.position`, and
 * gestures come from `MapControls` configured exactly as PGB configures it. The SVG
 * surface reimplemented that library by hand because it had no three.js; this does not.
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
 * That is why there is no root-finding in the geometry. Placing rungs at even *x* would
 * require inverting `x(t)` per vertex, because the two edges have different `u` and so do
 * not share an x at equal t; placing them at even *t* removes the question. The cost is
 * that rungs are spaced unevenly in x — by no more than ~3× — which affects nothing,
 * since tessellation error follows curvature rather than spacing.
 *
 * `RUNGS = 64` leaves a worst-case chord error of 0.41 px in x and 0.06 px in y, measured
 * at 200× zoom on the widest piece in `5520+`, and a sweep of 16/32/64/128 showed flat
 * frame time — rung count is free in this range.
 *
 * ## Drawing happens on demand
 *
 * The spike ran an unconditional animation loop because it was also reading a frame
 * meter. `MapControls` runs without damping, so it calls `update()` from its own pointer
 * and wheel handlers and announces every camera change; a frame is scheduled from that
 * and from nothing else. A mounted surface nobody is touching costs no frames at all,
 * which matters once this is one panel inside PGB rather than the whole page.
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
import { devicePixel, pixelFrustum, usable, zoomRange, type Viewport } from './bandCamera.ts'
import { THICKNESS, parseBands, type ParsedMap } from './parseBands.ts'
import type { SurfaceRenderer } from './surfaceRenderer.ts'

// Bands carry the colours the document gave them, byte for byte. We are reproducing a
// picture, not lighting a scene, so nothing converts colour anywhere.
ColorManagement.enabled = false

/** Quads per band along its span. See the note on tessellation error above. */
export const RUNGS = 64

const VERTEX = /* glsl */`
precision highp float;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uThickness;
uniform float uPad;

in vec2 aParam;    // x: curve parameter 0..1, y: 0 = upper edge, 1 = lower edge
in vec4 iSpan;     // x0, y0, width, y1  — y0/y1 are the upper edge, world space
in vec2 iControl;  // control abscissa of the upper and lower edge, as a fraction
in vec3 iColor;

out vec3 vColor;

flat out vec4 vSpan;
flat out vec2 vControl;
out float vT;
out vec2 vWorld;

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

    // Grow the band by a pixel on each side so a band thinner than one pixel still
    // covers a fragment to compute coverage in. Without this a 0.19 px band would
    // simply miss every sample point and vanish.
    y += (1.0 - 2.0 * side) * uPad;

    vColor = iColor;
    vSpan = iSpan;
    vControl = iControl;
    vT = t;
    vWorld = vec2(x, y);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(x, y, 0.0, 1.0);
}
`

const FRAGMENT = /* glsl */`
precision highp float;

uniform float uThickness;
uniform float uHalfPixel;

in vec3 vColor;
flat in vec4 vSpan;
flat in vec2 vControl;
in float vT;
in vec2 vWorld;

out vec4 fragColor;

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

void main() {
    float p = clamp((vWorld.x - vSpan.x) / vSpan.z, 0.0, 1.0);

    // Each edge has its own control abscissa, so each needs its own parameter at this x.
    float tTop = parameterAt(p, vControl.x, vT);
    float tBot = parameterAt(p, vControl.y, vT);

    float yTop = mix(vSpan.y, vSpan.w, tTop * tTop * (3.0 - 2.0 * tTop));
    float yBot = mix(vSpan.y, vSpan.w, tBot * tBot * (3.0 - 2.0 * tBot)) - uThickness;

    // What fraction of this pixel's height the band actually fills. A band covering a
    // fifth of the pixel contributes exactly a fifth — this one line is what MSAA, which
    // can only answer in quarters, cannot do.
    float lo = max(yBot, vWorld.y - uHalfPixel);
    float hi = min(yTop, vWorld.y + uHalfPixel);
    float coverage = clamp((hi - lo) / (2.0 * uHalfPixel), 0.0, 1.0);

    // Horizontal coverage at the two ends is ignored. Bands lap their neighbours by a
    // whole unit and are hundreds of units wide, so the ends are interior to the track.
    if (0.0 >= coverage) {
        discard;
    }

    fragColor = vec4(vColor, coverage);
}
`

/** The GPU side, built on the first document and kept for the life of the mount. */
interface Context {
    renderer: WebGLRenderer
    scene: Scene
    camera: OrthographicCamera
    controls: MapControls
    material: RawShaderMaterial
}

/** The document currently on screen, and the resources drawing it. */
interface Drawing {
    map: ParsedMap
    geometry: InstancedBufferGeometry
    mesh: Mesh
}

export function createBandSurface(host: HTMLElement, rungs: number = RUNGS): SurfaceRenderer {

    if (false === Number.isInteger(rungs) || 1 > rungs) {
        throw new Error(`rungs must be a positive whole number, not ${rungs}.`)
    }

    const canvas = host.ownerDocument.createElement('canvas')
    canvas.className = 'stm-canvas'
    host.append(canvas)

    let context: Context | null = null
    let drawing: Drawing | null = null
    /** True until the researcher moves the view — a resize re-fits only while the framing is still ours. */
    let untouched = true
    let frame = 0

    function viewport(): Viewport {
        return { width: canvas.clientWidth, height: canvas.clientHeight }
    }

    /**
     * Build the context on the first document rather than at mount, so a machine without
     * WebGL fails into the mount's error state instead of throwing out of `mount`.
     */
    function gpu(): Context {
        if (null !== context) {
            return context
        }

        let renderer: WebGLRenderer

        try {
            // No hardware multisampling: coverage is computed per fragment, and MSAA on
            // top of it would sample an already-antialiased edge and double-count.
            renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, premultipliedAlpha: false })
        } catch (error) {
            throw new Error(
                `This browser could not open a WebGL context — ${error instanceof Error ? error.message : String(error)}`
            )
        }

        renderer.outputColorSpace = LinearSRGBColorSpace
        renderer.setClearColor(0xffffff, 1)

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
        controls.target.set(0, 0, 0)

        // Every camera change is announced, including the clamps `update()` applies, so
        // this is the only thing that ever asks for a frame.
        controls.addEventListener('change', () => {
            untouched = false
            scheduleDraw()
        })

        const material = new RawShaderMaterial({
            glslVersion: GLSL3,
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: {
                uThickness: { value: THICKNESS },
                uHalfPixel: { value: 0 },
                uPad: { value: 0 }
            },
            // Coverage arrives as alpha, so the surface blends. There is no depth buffer:
            // bands are opaque in the document and painted in order, so instance order
            // carries z-order where two tracks cross.
            transparent: true,
            depthTest: false,
            depthWrite: false
        })

        context = { renderer, scene, camera, controls, material }

        return context
    }

    /** Frame the camera for the current viewport, leaving the view where it is. */
    function reframe(): void {
        if (null === context || null === drawing) {
            return
        }

        const size = viewport()

        if (false === usable(size)) {
            return
        }

        const { renderer, camera, controls } = context
        const frustum = pixelFrustum(size)

        renderer.setPixelRatio(window.devicePixelRatio)
        renderer.setSize(size.width, size.height, false)

        camera.left = frustum.left
        camera.right = frustum.right
        camera.top = frustum.top
        camera.bottom = frustum.bottom
        camera.updateProjectionMatrix()

        // Fit moves with the viewport, so the clamp does too — and `update()` is what
        // pulls the current zoom back inside it.
        const range = zoomRange(drawing.map.content.width, size)

        controls.minZoom = range.min
        controls.maxZoom = range.max
        controls.update()

        scheduleDraw()
    }

    /** Open on the whole map: fit to width, centred. The content is centred on the origin. */
    function fit(): void {
        if (null === context || null === drawing) {
            return
        }

        const size = viewport()

        if (false === usable(size)) {
            return
        }

        const { camera, controls } = context

        camera.position.set(0, 0, 5)
        camera.zoom = zoomRange(drawing.map.content.width, size).min

        // `controls.update()` rebuilds the projection matrix only when it changes the
        // zoom itself. Setting it here and leaving that to the controls opens the map at
        // whatever the previous zoom was — 78× on `5520+`, which looks like a working
        // renderer showing three haplotypes.
        camera.updateProjectionMatrix()

        controls.target.set(0, 0, 0)
        controls.update()

        // After the update, because the change it announces would otherwise mark this
        // framing as the researcher's own.
        untouched = true

        scheduleDraw()
    }

    function scheduleDraw(): void {
        if (0 !== frame) {
            return
        }

        frame = requestAnimationFrame(() => {
            frame = 0
            draw()
        })
    }

    function draw(): void {
        if (null === context || null === drawing) {
            return
        }

        const { renderer, scene, camera, material } = context
        const pixel = devicePixel(camera.zoom, renderer.getPixelRatio())

        material.uniforms.uHalfPixel.value = pixel * 0.5
        material.uniforms.uPad.value = pixel

        renderer.render(scene, camera)
    }

    function releaseDrawing(): void {
        if (null === drawing || null === context) {
            return
        }

        context.scene.remove(drawing.mesh)
        drawing.geometry.dispose()
        drawing = null
    }

    return {

        show(text: string): void {
            const map = parseBands(text)
            const built = gpu()

            releaseDrawing()

            const geometry = buildLadder(rungs)

            geometry.setAttribute('iSpan', deinterleave(map.geometry, 6, 0, 4, map.bandCount))
            geometry.setAttribute('iControl', deinterleave(map.geometry, 6, 4, 2, map.bandCount))
            geometry.setAttribute('iColor', instanceColors(map))
            geometry.instanceCount = map.bandCount

            const mesh = new Mesh(geometry, built.material)

            // The whole map is one object and it is always in view; culling it per frame
            // would compute a bounding sphere over 40,442 instances to learn nothing.
            mesh.frustumCulled = false
            built.scene.add(mesh)

            drawing = { map, geometry, mesh }

            reframe()
            fit()
        },

        clear(): void {
            releaseDrawing()

            if (null !== context) {
                context.renderer.clear()
            }

            untouched = true
        },

        resize(): void {
            // Resizing reveals more or less of the map rather than re-framing it —
            // unless the researcher has not yet invested in a position, in which case
            // the opening framing should stay correct.
            if (untouched) {
                reframe()
                fit()
            } else {
                reframe()
            }
        },

        destroy(): void {
            if (0 !== frame) {
                cancelAnimationFrame(frame)
                frame = 0
            }

            releaseDrawing()

            if (null !== context) {
                context.controls.dispose()
                context.material.dispose()

                // `dispose()` releases three's own resources but **not** the WebGL
                // context; only `forceContextLoss()` does, and browsers cap live
                // contexts near 16.
                context.renderer.forceContextLoss()
                context.renderer.dispose()
                context = null
            }

            canvas.remove()
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
 * O(1) in the number of lit strands, and highlighting is not here yet; 40,442 normalized
 * bytes is 162 KB and one line.
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
