#!/usr/bin/env python3
"""
What natural groups do the strands fall into?

`pclai_color_collisions.py` measured why the strands cannot be told apart one at a time.
This script asks the complementary question: before you disambiguate one strand, how much
of the crowd can you dissolve by grouping? It reads PGB's own datasets rather than the
tube map SVGs downstream of them, so node membership is read, not inferred from geometry.

    python3 scripts/strand_grouping_survey.py ~/PanGenomeProject/pgb/public/datasets/api-v3

Reported per dataset:

  routes        distinct sets of nodes traversed. Two haplotypes on the same route are
                indistinguishable by topology alone over this window.
  top-5         share of haplotypes carried by the five most common routes
  spectrum      nodes bucketed by how many haplotypes carry them: universal (all),
                common (>=90%), variable (10-90%), rare (<10%), private (exactly one)
  clusters      k-means over the PCLAI coordinates, k chosen by silhouette
  switchers     haplotypes whose PCLAI cluster is not the same at every node in the window
  concordant    samples whose two haplotypes take the same route
  AMI           adjusted mutual information between route and PCLAI cluster: how much
                knowing a haplotype's ancestry group tells you about which route it takes
  pure routes   routes with >=4 placed carriers that are >=90% a single PCLAI cluster

Then, separately, what the PCLAI coordinate can and cannot support as a channel:

  between       share of the coordinate's variance that lies between clusters rather than
                within them. The remainder is all that is available to tell two haplotypes
                in the same cluster apart.
  median NN     distance to a haplotype's nearest neighbour, as a share of the whole
                cloud's diameter
  capacity      how many of the haplotypes each channel can actually hold apart: colour at
                a just-noticeable difference, position at a given plot size and pixel
                separation. Greedy packing, so these are upper bounds.
  over-separate the largest colour difference between two haplotypes that are within 1% of
                the diameter of each other. Colour is a function of position, so this can
                only ever be small -- it is here to show the failure is one-sided.
"""

import collections
import glob
import json
import math
import os
import sys

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_mutual_info_score, silhouette_score

BUCKETS = ("universal", "common", "variable", "rare", "private")

# sRGB -> CIELAB (D65), enough for a delta-E; avoids a scikit-image dependency
_M = np.array([[0.4124564, 0.3575761, 0.1804375],
               [0.2126729, 0.7151522, 0.0721750],
               [0.0193339, 0.1191920, 0.9503041]])
_WHITE = np.array([0.95047, 1.0, 1.08883])


def rgb_to_lab(rgb):
    """rgb in 0-255 -> CIELAB. Vectorised over the leading axis."""
    c = np.asarray(rgb, float) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    xyz = (lin @ _M.T) / _WHITE
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16,
                     500 * (f[:, 0] - f[:, 1]),
                     200 * (f[:, 1] - f[:, 2])], -1)


def capacity(points, radius):
    """How many members can be picked that are all >= radius apart. Greedy, so an upper bound."""
    keep = []
    for i in np.argsort(-np.linalg.norm(points - points.mean(0), axis=1)):
        if all(np.linalg.norm(points[i] - points[j]) >= radius for j in keep):
            keep.append(i)
    return len(keep)


def load(path):
    """-> routes{hap: frozenset(node)}, obs{hap: {node: (coord, score)}}, rgb{hap: RGB}, conf"""
    data = json.load(open(path))
    routes = collections.defaultdict(set)
    obs = collections.defaultdict(dict)
    rgb = {}
    conf = collections.Counter()
    for node_id, node in data["node"].items():
        for asm in node["assembly"]:
            hap = f"{asm['assembly_name']}#{asm['haplotype']}"
            routes[hap].add(node_id)
            for meta in asm["metadata"]:
                pclai = meta.get("pclai_hg38") or {}
                if "coordinates" not in pclai:
                    conf["unplaced"] += 1
                    continue
                score = pclai["confidence_score"]
                obs[hap][node_id] = (tuple(pclai["coordinates"]), score)
                rgb.setdefault(hap, tuple(pclai["RGB"]))
                if score == "impainted":
                    conf["impainted"] += 1
                else:
                    n = int(score)
                    conf[">=990" if n >= 990 else "950-989" if n >= 950 else "<950"] += 1
    return {h: frozenset(v) for h, v in routes.items()}, obs, rgb, conf


def spectrum(routes):
    total = len(routes)
    carried = collections.Counter()
    for nodes in routes.values():
        carried.update(nodes)
    out = collections.Counter()
    for count in carried.values():
        out[
            "universal" if count == total
            else "common" if count >= 0.9 * total
            else "variable" if count >= 0.1 * total
            else "private" if count == 1
            else "rare"
        ] += 1
    return out


def cluster(obs):
    """k-means over every (haplotype, node) PCLAI observation; k by silhouette."""
    keys = [(h, n) for h in obs for n in obs[h]]
    pts = np.array([obs[h][n][0] for h, n in keys])
    best = max(
        (silhouette_score(pts, KMeans(k, n_init=10, random_state=0).fit(pts).labels_), k)
        for k in range(2, 8)
    )
    labels = KMeans(best[1], n_init=20, random_state=0).fit(pts).labels_
    return best[1], best[0], {k: int(l) for k, l in zip(keys, labels)}, pts


def report(path):
    routes, obs, rgb, conf = load(path)
    total = len(routes)
    bundles = collections.defaultdict(list)
    for hap, route in routes.items():
        bundles[route].append(hap)
    sizes = sorted((len(v) for v in bundles.values()), reverse=True)

    k, sil, labels, pts = cluster(obs)
    diameter = math.hypot(np.ptp(pts[:, 0]), np.ptp(pts[:, 1]))
    multi = [h for h in obs if len(obs[h]) > 1]
    switchers = [h for h in multi if len({labels[(h, n)] for n in obs[h]}) > 1]
    wander = sorted(
        max(
            math.hypot(a[0] - b[0], a[1] - b[1])
            for a in [c for c, _ in obs[h].values()]
            for b in [c for c, _ in obs[h].values()]
        )
        / diameter
        for h in multi
    )

    # one cluster per haplotype: whichever it sits in at the most nodes
    hap_cluster = {
        h: collections.Counter(labels[(h, n)] for n in obs[h]).most_common(1)[0][0]
        for h in obs
    }
    index = {route: i for i, route in enumerate(bundles)}
    placed = [h for h in routes if h in hap_cluster]
    ami = adjusted_mutual_info_score(
        [index[routes[h]] for h in placed], [hap_cluster[h] for h in placed]
    )
    sizeable = [
        [h for h in v if h in hap_cluster] for v in bundles.values()
    ]
    sizeable = [v for v in sizeable if len(v) >= 4]
    pure = sum(
        1
        for v in sizeable
        if collections.Counter(hap_cluster[h] for h in v).most_common(1)[0][1] / len(v) >= 0.9
    )

    samples = collections.defaultdict(list)
    for hap in routes:
        samples[hap.split("#")[0]].append(hap)
    pairs = [v for v in samples.values() if len(v) == 2]
    concordant = sum(1 for v in pairs if routes[v[0]] == routes[v[1]])

    spec = spectrum(routes)
    print(f"\n{os.path.basename(path)}")
    print(f"  haplotypes {total}   nodes {sum(spec.values())}")
    print(
        f"  routes {len(bundles)}   largest {100 * sizes[0] / total:.0f}%   "
        f"top-5 {100 * sum(sizes[:5]) / total:.0f}%   travelled alone {sizes.count(1)}"
    )
    print("  spectrum " + "  ".join(f"{b} {spec[b]}" for b in BUCKETS))
    print(f"  clusters k={k} silhouette {sil:.2f}")
    print(
        f"  wander/diameter  median {wander[len(wander) // 2]:.3f}  "
        f"p90 {wander[int(0.9 * len(wander))]:.3f}  max {wander[-1]:.3f}   "
        f"switchers {len(switchers)}/{len(multi)}"
    )
    print(f"  concordant samples {concordant}/{len(pairs)} ({100 * concordant / len(pairs):.0f}%)")
    print(f"  AMI(route, cluster) {ami:.2f}   pure routes {pure}/{len(sizeable)}")
    print(f"  confidence {dict(conf)}")
    channels(obs, rgb, hap_cluster)


def channels(obs, rgb, hap_cluster):
    """What the PCLAI coordinate can and cannot support as a visual channel."""
    haps = sorted(h for h in obs if h in rgb)
    coords = np.array([np.mean([c for c, _ in obs[h].values()], axis=0) for h in haps])
    lab = rgb_to_lab([rgb[h] for h in haps])

    total = ((coords - coords.mean(0)) ** 2).sum()
    within = sum(
        ((coords[m] - coords[m].mean(0)) ** 2).sum()
        for m in (np.array([hap_cluster[h] == k for h in haps]) for k in set(hap_cluster.values()))
        if m.any()
    )
    dist = np.linalg.norm(coords[:, None] - coords[None, :], axis=2)
    diameter = dist.max()
    np.fill_diagonal(dist, np.inf)

    print(
        f"  between-cluster variance {100 * (1 - within / total):.1f}%   "
        f"median nearest neighbour {100 * np.median(dist.min(1)) / diameter:.3f}% of diameter"
    )
    span = max(np.ptp(coords[:, 0]), np.ptp(coords[:, 1]))
    print(
        f"  capacity of {len(haps)}:  colour 1.0dE {capacity(lab, 1.0):3d}   "
        f"colour 2.3dE {capacity(lab, 2.3):3d}   "
        f"position 600px/4px {capacity(coords * (600 / span), 4):3d}   "
        f"position 1200px/2px {capacity(coords * (1200 / span), 2):3d}"
    )
    near = dist < 0.01 * diameter
    de = np.linalg.norm(lab[:, None] - lab[None, :], axis=2)
    worst = de[near].max() if near.any() else float("nan")
    print(f"  colour over-separation: max dE among position-identical pairs {worst:.1f}")


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    for path in sorted(glob.glob(os.path.join(root, "*.json"))):
        report(path)
