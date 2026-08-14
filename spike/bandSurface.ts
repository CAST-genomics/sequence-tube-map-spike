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
 * ## Flat bands, deliberately
 *
 * Each band is drawn as a **sheared quad**: correct at both ends, a straight line in
 * between where the real band is a smoothstep curve. The picture is therefore right
 * wherever a haplotype runs level and wrong wherever it transitions between segments.
 *
 * That is enough to answer two of the spike's three failure conditions — whether panning
 * and zooming a 14:1 strip feels right, and whether zoom reaches far enough to resolve a
 * haplotype — without a line of curve maths. It is also exactly a one-rung ladder, so
 * the curved renderer generalises this rather than replacing it.
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

const VERTEX = /* glsl */`
precision highp float;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uThickness;

in vec2 aParam;   // x: 0..1 along the span, y: 0 = upper edge, 1 = lower edge
in vec4 iSpan;    // x0, y0, width, y1  — y0/y1 are the upper edge, world space
in vec3 iColor;

out vec3 vColor;

void main() {
    float p = aParam.x;
    float side = aParam.y;

    float x = iSpan.x + iSpan.z * p;

    // Linear between the ends: the flat approximation. The curved renderer replaces
    // this one mix() with smoothstep over an inverted cubic, and nothing else here.
    float y = mix(iSpan.y, iSpan.w, p) - side * uThickness;

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

    const geometry = new InstancedBufferGeometry()

    // The shared mesh: one quad, spanning 0..1 along the band and both edges across it.
    geometry.setAttribute('aParam', new BufferAttribute(
        new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), 2
    ))
    geometry.setIndex([0, 1, 2, 2, 1, 3])

    geometry.setAttribute('iSpan', packInstances(map.geometry, 6, 0, 4, map.bandCount))
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
