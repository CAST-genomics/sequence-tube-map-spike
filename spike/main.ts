/**
 * Entry point. Fetch a fixture, parse it, put it on screen, run the loop.
 *
 * The readout carries the two numbers a judgment actually needs — how tall a band is in
 * CSS pixels right now, and what the frame time is — because both failure conditions
 * this stage can answer are about those.
 */

import { createBandSurface, MAX_ZOOM } from './bandSurface.ts'
import { createFrameMeter } from './frameMeter.ts'
import { NonConformingDocument, parseBands } from './parseBands.ts'

const FIXTURES = {
    small: {
        url: '/stm-chr1-25331046-25331646.svg',
        label: '600 bp — the fast inner loop'
    },
    '5520': {
        url: '/stm-node-5520-chr1-25331646-25335796.svg',
        label: '5520+ — every judgment is made on this one'
    },
    '5514': {
        url: '/stm-node-5514-chr1-25301271-25309238.svg',
        label: '5514+ — the widest strip'
    }
}

type FixtureName = keyof typeof FIXTURES

const canvas = document.querySelector('canvas')
const readout = document.querySelector('#readout')

if (null === canvas || null === readout) {
    throw new Error('The page is missing its canvas or its readout.')
}

void start(canvas as HTMLCanvasElement, readout as HTMLElement)

async function start(canvas: HTMLCanvasElement, readout: HTMLElement): Promise<void> {
    const name = fixtureName()
    const fixture = FIXTURES[name]

    readout.textContent = `loading ${name}…`

    const response = await fetch(fixture.url)

    if (false === response.ok) {
        readout.textContent = `${fixture.url} — HTTP ${response.status}`
        return
    }

    const text = await response.text()

    // Timed because "is parsing 14 MB in the browser affordable" is a real question and
    // this is the only place it gets answered. Measured at 42 ms outside the browser.
    const began = performance.now()
    let map

    try {
        map = parseBands(text)
    } catch (error) {
        readout.textContent = error instanceof NonConformingDocument
            ? `rejected: ${error.message}`
            : String(error)
        throw error
    }

    const parseMs = performance.now() - began
    const surface = createBandSurface(map, canvas)
    const meter = createFrameMeter()

    window.addEventListener('resize', () => surface.resize())

    const fixed = [
        fixture.label,
        `${map.bandCount.toLocaleString()} bands · ${map.trackCount} tracks`,
        `parsed in ${parseMs.toFixed(0)} ms`
    ].join('\n')

    function frame(): void {
        meter.tick()
        surface.render()

        readout.textContent = [
            fixed,
            `zoom ${surface.zoom().toFixed(1)}× of ${MAX_ZOOM}×`,
            `band ${surface.bandHeightInPixels().toFixed(2)} css px`,
            `frame ${meter.mean().toFixed(1)} ms · worst ${meter.worst().toFixed(1)} ms`
        ].join('\n')

        requestAnimationFrame(frame)
    }

    requestAnimationFrame(frame)
}

function fixtureName(): FixtureName {
    const asked = new URLSearchParams(window.location.search).get('fixture')

    return null !== asked && asked in FIXTURES ? asked as FixtureName : 'small'
}
