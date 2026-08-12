import { describe, expect, it } from 'vitest'

import {
    catalogEntries,
    entryForUrl,
    formatLength,
    formatLocus,
    type NodeTable
} from '../nodeCatalog.ts'

// Three rows lifted verbatim from data/nodeTable.json, deliberately out of order.
const table: NodeTable = {
    generatedAt: '2026-08-12',
    source: 'pgb/public/datasets/api-v3/cici.json',
    assembly: 'GRCh38',
    endpoint: 'https://pangenome-api.ucsd.edu:8000/seqtubemap',
    fixedParameters: { version: 'v2', pathnumoption: 'normal', nodewidthoption: 'compressed' },
    queriedLocus: 'GRCh38#0#chr1:25240000-25460000',
    actualLocus: 'GRCh38#0#chr1:25200904-25582458',
    nodesWithoutGrch38: ['354719+', '470948+'],
    nodes: [
        {
            node: '5519+',
            minigraphnode: '5519',
            chrom: 'chr1',
            start: 25331046,
            end: 25331646,
            length: 600,
            url: 'https://pangenome-api.ucsd.edu:8000/seqtubemap?chrom=chr1&start=25331046&end=25331646&version=v2&pathnumoption=normal&nodewidthoption=compressed&minigraphnode=5519'
        },
        {
            node: '5504+',
            minigraphnode: '5504',
            chrom: 'chr1',
            start: 25200904,
            end: 25236799,
            length: 35895,
            url: 'https://pangenome-api.ucsd.edu:8000/seqtubemap?chrom=chr1&start=25200904&end=25236799&version=v2&pathnumoption=normal&nodewidthoption=compressed&minigraphnode=5504'
        },
        {
            node: '5510+',
            minigraphnode: '5510',
            chrom: 'chr1',
            start: 25287800,
            end: 25287806,
            length: 6,
            url: 'https://pangenome-api.ucsd.edu:8000/seqtubemap?chrom=chr1&start=25287800&end=25287806&version=v2&pathnumoption=normal&nodewidthoption=compressed&minigraphnode=5510'
        }
    ]
}

describe('catalogEntries', () => {

    it('yields one entry per node in the table', () => {
        expect(catalogEntries(table)).toHaveLength(3)
    })

    it('orders entries along the chromosome, not by node id', () => {
        expect(catalogEntries(table).map(entry => entry.minigraphnode)).toEqual([
            '5504',
            '5510',
            '5519'
        ])
    })

    it('orders chromosomes numerically, so chr2 precedes chr10', () => {
        const across: NodeTable = {
            ...table,
            nodes: ['chrM', 'chr10', 'chrX', 'chr2', 'chr1'].map((chrom, index) => ({
                ...table.nodes[0],
                node: `${index}+`,
                minigraphnode: String(index),
                chrom
            }))
        }
        expect(catalogEntries(across).map(entry => entry.chrom)).toEqual([
            'chr1',
            'chr2',
            'chr10',
            'chrX',
            'chrM'
        ])
    })

    it('carries each row\'s url through untouched', () => {
        const [first] = catalogEntries(table)
        expect(first.url).toBe(table.nodes[1].url)
    })

    it('labels an entry with its node, locus, and length', () => {
        const entry = catalogEntries(table).find(candidate => candidate.minigraphnode === '5519')
        expect(entry?.label).toBe('5519 · chr1:25,331,046-25,331,646 · 600 bp')
    })
})

describe('formatLocus', () => {

    it('groups coordinate digits so long positions stay readable', () => {
        expect(formatLocus({ chrom: 'chr1', start: 25331046, end: 25331646 })).toBe(
            'chr1:25,331,046-25,331,646'
        )
    })
})

describe('formatLength', () => {

    it('reports short nodes in bases — a 1 bp variant is the interesting case', () => {
        expect(formatLength(1)).toBe('1 bp')
        expect(formatLength(600)).toBe('600 bp')
        expect(formatLength(999)).toBe('999 bp')
    })

    it('switches to kb once bases stop being readable', () => {
        expect(formatLength(1000)).toBe('1.0 kb')
        expect(formatLength(35895)).toBe('35.9 kb')
    })
})

describe('entryForUrl', () => {

    const entries = catalogEntries(table)

    it('finds the entry whose url the viewer is showing', () => {
        const entry = entryForUrl(entries, table.nodes[0].url)
        expect(entry?.minigraphnode).toBe('5519')
    })

    it('matches a url whose parameters are in a different order', () => {
        const reordered =
            'https://pangenome-api.ucsd.edu:8000/seqtubemap?minigraphnode=5519&nodewidthoption=compressed&pathnumoption=normal&version=v2&end=25331646&start=25331046&chrom=chr1'
        expect(entryForUrl(entries, reordered)?.minigraphnode).toBe('5519')
    })

    it('does not match a url for a different node', () => {
        const other = table.nodes[0].url.replace('minigraphnode=5519', 'minigraphnode=9999')
        expect(entryForUrl(entries, other)).toBeUndefined()
    })

    it('returns nothing for the committed fixture, which belongs to no dataset row', () => {
        expect(entryForUrl(entries, '/stm-chr1-25331046-25331646.svg')).toBeUndefined()
    })

    it('returns nothing rather than throwing on an unparseable url', () => {
        expect(entryForUrl(entries, 'not a url at all')).toBeUndefined()
    })
})
