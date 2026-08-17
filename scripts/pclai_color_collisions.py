#!/usr/bin/env python3
"""
How much can PCLAI's shipped colors actually discriminate?

The tube map does not choose its strand colors. They arrive in the `RGB` field beside each
PCLAI coordinate, computed upstream as a visual encoding of the haplotype's position in
PCA space, and PGB's 3D graph and PCLAI chart read the same field. This script measures
what that encoding can and cannot separate, straight out of PGB's own datasets — the
source, rather than the tube map SVGs downstream of it.

    python3 scripts/pclai_color_collisions.py ~/PanGenomeProject/pgb/public/datasets/api-v3

Reported per dataset, for the node carrying the most placed haplotypes:

  placed        haplotypes with a `pclai_hg38` placement at that node
  distinct      how many distinct RGB triples they receive
  exact         how many of those haplotypes share their color with another, exactly
  within 1      distinct colors whose nearest other color is 1/255 away in a channel
  same-color    the largest PCA distance between two haplotypes given the *same* color,
    spread      as a fraction of the whole cloud's diagonal — i.e. how much genuine
                separation the encoding collapses
"""

import collections
import glob
import json
import math
import os
import sys


def placements(node):
    """(key, rgb, coordinates) for every haplotype PCLAI placed at this node."""
    rows = []

    for assembly in node.get('assembly', []):
        for entry in assembly.get('metadata', []):
            block = entry.get('pclai_hg38') or {}

            if block.get('RGB') and block.get('coordinates'):
                key = f"{assembly['assembly_name']}#{assembly['haplotype']}"
                rows.append((key, tuple(block['RGB']), tuple(block['coordinates'])))

    return rows


def channel_distance(one, other):
    return max(abs(a - b) for a, b in zip(one, other))


def report(path):
    dataset = json.load(open(path))

    nodes = {node_id: placements(node) for node_id, node in dataset.get('node', {}).items()}
    nodes = {node_id: rows for node_id, rows in nodes.items() if rows}

    if not nodes:
        return

    node_id, rows = max(nodes.items(), key=lambda item: len(item[1]))

    by_color = collections.defaultdict(list)
    for _, rgb, coordinates in rows:
        by_color[rgb].append(coordinates)

    distinct = sorted(by_color)
    exact = sum(len(points) for points in by_color.values() if len(points) > 1)

    within_one = sum(
        1
        for i, color in enumerate(distinct)
        if min(
            (channel_distance(color, other) for j, other in enumerate(distinct) if i != j),
            default=255
        ) <= 1
    )

    # The widest genuine separation the color encoding throws away.
    collapsed = 0.0
    for points in by_color.values():
        for i in range(len(points)):
            for j in range(i + 1, len(points)):
                collapsed = max(collapsed, math.dist(points[i], points[j]))

    xs = [point[0] for _, _, point in rows]
    ys = [point[1] for _, _, point in rows]
    diagonal = math.dist((min(xs), min(ys)), (max(xs), max(ys)))

    print(
        f"{os.path.basename(path):<42} node {node_id:<12} "
        f"placed {len(rows):>4}   distinct {len(distinct):>4}   "
        f"exact {exact:>4}   within 1 {within_one:>4}   "
        f"same-color spread {100 * collapsed / diagonal:>4.0f}% of the cloud"
    )


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    paths = sorted(glob.glob(os.path.join(root, '*.json')))

    if not paths:
        raise SystemExit(f'No datasets found in {root}')

    for path in paths:
        report(path)


if __name__ == '__main__':
    main()
