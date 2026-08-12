/**
 * Standalone harness.
 *
 * Everything here is scaffolding PGB will replace: it owns the container, the URL,
 * and the dev instrumentation. The viewer takes a URL and nothing else.
 */

import { startFrameMeter } from './frameMeter.ts'
import { mountTubeMapSurface } from './tubeMapSurface.ts'

const DEFAULT_URL = '/stm-chr1-25331046-25331646.svg'

const container = document.getElementById('viewer') as HTMLElement
const picker = document.getElementById('picker') as HTMLFormElement
const field = document.getElementById('url') as HTMLInputElement

const parameters = new URLSearchParams(window.location.search)
const initialUrl = parameters.get('url') ?? DEFAULT_URL

field.value = initialUrl

const viewer = mountTubeMapSurface(container)

picker.addEventListener('submit', event => {
    event.preventDefault()
    void viewer.open(field.value.trim())
})

if (parameters.has('fps')) {
    startFrameMeter(document.body)
}

void viewer.open(initialUrl)
