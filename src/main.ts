/**
 * Standalone harness.
 *
 * Everything here is scaffolding PGB will replace: it owns the container, the URL,
 * and the dev instrumentation. The viewer takes a URL and nothing else.
 */

import nodeTable from '../data/nodeTable.json'
import { startFrameMeter } from './frameMeter.ts'
import { catalogEntries, entryForUrl, formatLength, formatLocus } from './nodeCatalog.ts'
import { mountTubeMapSurface } from './tubeMapSurface.ts'

const DEFAULT_URL = '/stm-chr1-25331046-25331646.svg'
// The fixture is node 5519 captured to disk, so it gets node 5519's label.
const FIXTURE = { chrom: 'chr1', start: 25331046, end: 25331646, length: 600 }

const container = document.getElementById('viewer') as HTMLElement
const picker = document.getElementById('picker') as HTMLFormElement
const field = document.getElementById('url') as HTMLInputElement
const chooser = document.getElementById('node') as HTMLSelectElement
const hint = document.getElementById('hint') as HTMLElement

const parameters = new URLSearchParams(window.location.search)
const initialUrl = parameters.get('url') ?? DEFAULT_URL

const entries = catalogEntries(nodeTable)

fillChooser()
show(initialUrl)

// `?feeler` re-arms `Shift`-held strand feeling, which ships off. It is kept
// reachable so the interaction can be judged again — on smaller maps, or against a
// cheaper highlight — without restoring deleted code first.
const strandFeeler = parameters.has('feeler')

if (strandFeeler) {
    hint.textContent += ' · hold shift to feel strands'
}

const viewer = mountTubeMapSurface(container, { strandFeeler })

// The select is a shortcut into the field, not a second source of truth: it fills
// the URL in, so what opened is always visible and still editable by hand.
chooser.addEventListener('change', () => {
    show(chooser.value)
    void viewer.open(chooser.value)
})

picker.addEventListener('submit', event => {
    event.preventDefault()
    const url = field.value.trim()
    show(url)
    void viewer.open(url)
})

if (parameters.has('fps')) {
    startFrameMeter(document.body)
}

void viewer.open(initialUrl)

/**
 * The committed fixture, then every GRCh38 node of the dataset in chromosome order.
 *
 * Nodes the dataset carries but GRCh38 doesn't place are absent by construction —
 * they have no tube map, and the API answers for one with a plausible-looking map
 * rather than an error, so the only defence is never to offer them.
 */
function fillChooser(): void {
    chooser.append(
        option(DEFAULT_URL, `fixture · ${formatLocus(FIXTURE)} · ${formatLength(FIXTURE.length)}`)
    )

    const nodes = document.createElement('optgroup')
    nodes.label = `${nodeTable.source} · ${entries.length} nodes`
    for (const entry of entries) {
        nodes.append(option(entry.url, entry.label))
    }
    chooser.append(nodes)
}

/** Point the field and the select at `url`, leaving the select blank if it's neither. */
function show(url: string): void {
    field.value = url
    chooser.value = url === DEFAULT_URL ? DEFAULT_URL : entryForUrl(entries, url)?.url ?? ''
}

function option(value: string, label: string): HTMLOptionElement {
    const element = document.createElement('option')
    element.value = value
    element.textContent = label
    return element
}
