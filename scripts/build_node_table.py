#!/usr/bin/env python3
"""Turn a PGB dataset into a table of tube map URLs, one per minigraph node.

Every URL this viewer opens is derived from a node in a PGB dataset: the node's id
becomes `minigraphnode`, and its GRCh38 interval becomes `chrom`/`start`/`end`. That
derivation is PGB's job in production — this script does it ahead of time so the
harness has something to pick from.

Only GRCh38 is consulted. A node with no GRCh38 assembly has no tube map (the API
returns a plausible-looking map for an unknown node rather than an error, so the
filtering has to happen here); such nodes are listed in the output under
`nodesWithoutGrch38` rather than silently dropped.

    python3 scripts/build_node_table.py \
        /path/to/pgb/public/datasets/api-v3/cici.json \
        --output data/nodeTable.json

The three fixed query parameters are documented in
`notes/2026-08-12-api-reachability-and-cors.md`. `pathnumoption` is load-bearing —
dropping it silently returns a different, much smaller map.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlencode

ENDPOINT = "https://pangenome-api.ucsd.edu:8000/seqtubemap"
ASSEMBLY = "GRCh38"
FIXED_PARAMETERS = {
    "version": "v2",
    "pathnumoption": "normal",
    "nodewidthoption": "compressed",
}

NODE_KEY = re.compile(r"^(\d+)([+-])$")


class DatasetError(ValueError):
    """The dataset is not shaped the way this script needs it to be."""


def minigraph_node_id(node_key: str) -> str:
    """`"5519+"` is a node id plus an orientation; the API wants the id alone."""
    match = NODE_KEY.match(node_key)
    if match is None:
        raise DatasetError(f"unrecognised node key {node_key!r}, expected e.g. '5519+'")
    return match.group(1)


def sort_key(node_key: str) -> tuple[int, str]:
    """Node key order for display: numeric ids first, in order; anything else after."""
    match = NODE_KEY.match(node_key)
    return (int(match.group(1)), node_key) if match else (2**62, node_key)


def chromosome_rank(chrom: str) -> tuple[int, str]:
    """Conventional order: 1…22, then X, Y, M, then anything else by name.

    Textual order would put chr10 before chr2. cici.json is chr1 only, so nothing
    here exercises it yet — which is exactly why it's worth getting right now.
    """
    name = re.sub(r"^chr", "", chrom, flags=re.IGNORECASE)
    if name.isdigit():
        return int(name), ""
    return {"X": 1000, "Y": 1001, "M": 1002, "MT": 1002}.get(name.upper(), 2000), name


def grch38_interval(node: dict) -> dict | None:
    """The node's GRCh38 placement, or None when it isn't in GRCh38 at all."""
    placements = [
        metadata
        for assembly in node.get("assembly", [])
        if assembly.get("assembly_name") == ASSEMBLY
        for metadata in assembly.get("metadata", [])
    ]
    if not placements:
        return None
    if len(placements) > 1:
        # Never seen in cici.json. If it happens the URL is ambiguous, so say so
        # rather than picking one and calling it the answer.
        raise DatasetError(
            f"{len(placements)} {ASSEMBLY} placements for one node; "
            "a single interval is assumed"
        )
    return placements[0]


def interval_fields(node_key: str, placement: dict) -> tuple[str, int, int]:
    """The three coordinate fields, or a DatasetError naming the node that lacks them.

    A missing or non-numeric coordinate is a dataset the script doesn't understand,
    not a crash to read backwards from a KeyError in a traceback.
    """
    try:
        return str(placement["sequence_id"]), int(placement["start"]), int(placement["end"])
    except (KeyError, TypeError, ValueError) as cause:
        raise DatasetError(
            f"node {node_key} has an unusable {ASSEMBLY} interval: {placement!r}"
        ) from cause


def tube_map_url(endpoint: str, node_id: str, chrom: str, start: int, end: int) -> str:
    query = urlencode(
        {
            "chrom": chrom,
            "start": start,
            "end": end,
            **FIXED_PARAMETERS,
            "minigraphnode": node_id,
        }
    )
    return f"{endpoint}?{query}"


def build_table(dataset: dict, source: str, endpoint: str = ENDPOINT) -> dict:
    rows = []
    without_grch38 = []

    for node_key, node in dataset.get("node", {}).items():
        placement = grch38_interval(node)
        if placement is None:
            without_grch38.append(node_key)
            continue

        node_id = minigraph_node_id(node_key)
        chrom, start, end = interval_fields(node_key, placement)

        rows.append(
            {
                "node": node_key,
                "minigraphnode": node_id,
                "chrom": chrom,
                "start": start,
                "end": end,
                "length": end - start,
                "url": tube_map_url(endpoint, node_id, chrom, start, end),
            }
        )

    # Genomic order: the reader is walking a locus, not a list of ids.
    rows.sort(key=lambda row: (chromosome_rank(row["chrom"]), row["start"], row["end"]))

    return {
        "generatedAt": date.today().isoformat(),
        "source": source,
        "assembly": ASSEMBLY,
        "endpoint": endpoint,
        "fixedParameters": FIXED_PARAMETERS,
        "queriedLocus": dataset.get("queried_locus"),
        "actualLocus": dataset.get("actual_locus"),
        # Sorted numerically where the key looks like one, but never fatally: these
        # nodes are being reported, not used, and an odd key shouldn't sink the run.
        "nodesWithoutGrch38": sorted(without_grch38, key=sort_key),
        "nodes": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("dataset", type=Path, help="a PGB dataset JSON")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/nodeTable.json"),
        help="where to write the table (default: data/nodeTable.json)",
    )
    parser.add_argument(
        "--endpoint",
        default=ENDPOINT,
        help=f"tube map endpoint (default: {ENDPOINT})",
    )
    parser.add_argument(
        "--source",
        help="how to describe the dataset in the output (default: its path)",
    )
    arguments = parser.parse_args()

    dataset = json.loads(arguments.dataset.read_text())
    table = build_table(
        dataset,
        source=arguments.source or str(arguments.dataset),
        endpoint=arguments.endpoint,
    )

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(table, indent=2) + "\n")

    print(
        f"{len(table['nodes'])} nodes with {ASSEMBLY} "
        f"({len(table['nodesWithoutGrch38'])} without, no tube map) "
        f"-> {arguments.output}"
    )


if __name__ == "__main__":
    main()
