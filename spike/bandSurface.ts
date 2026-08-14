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
    gl_Position = projectionMatrix * modelViewMatrix * vec4(x, y, 0.0, 1.0);
}
`

const FRAGMENT = /* glsl */`
precision highp float;

in vec3 vColor;
out vec4 fragColor;

void main() {
    fragColor = vec4(vColor, 1.0);
}
`

export interface BandSurface {
    /** Advance controls and draw. Call once per animation frame. */
    render(): void
    resize(): void
    /** Current camera zoom, where 1 is fit-to-width. */
    zoom(): number
    /** How tall one band is on screen right now, in CSS pixels. */
    bandHeightInPixels(): number
    dispose(): void
}

export function createBandSurface(map: ParsedMap, canvas: HTMLCanvasElement): BandSurface {
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false })

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

    const geometry = buildLadder(RUNGS)

    geometry.setAttribute('iSpan', packInstances(map.geometry, 6, 0, 4, map.bandCount))
    geometry.setAttribute('iControl', packInstances(map.geometry, 6, 4, 2, map.bandCount))
    geometry.setAttribute('iColor', instanceColors(map))
    geometry.instanceCount = map.bandCount

    const material = new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uThickness: { value: THICKNESS } },
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
            renderer.render(scene, camera)
        },

        resize,

        zoom(): number {
            return camera.zoom
        },

        bandHeightInPixels(): number {
            return THICKNESS * camera.zoom * canvas.clientWidth / map.content.width
        },

        dispose(): void {
            controls.dispose()
            geometry.dispose()
            material.dispose()
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

/** Deinterleave one field out of the parser's packed six-floats-per-band layout. */
function packInstances(
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
    const attribute = new InstancedBufferAttribute(rgba, 4, true)

    // The shader reads a vec3; the alpha byte is padding.
    return attribute
}
