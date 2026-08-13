#!/usr/bin/env python3
"""Step 0 of the WebGL band renderer spike.

Fetches every minigraph node in data/nodeTable.json and measures the quantities the
renderer's cost actually depends on -- separately, because "size" conflates four
things. Also tests every document against the canonical band grammar that ADR 0001
rests on.

Writes data/nodeSurvey.json. Prints one line per node so progress is visible.
Responses are never kept -- the largest are ~100 MB.

    python3 scripts/survey_nodes.py
"""
import json, re, ssl, sys, time, urllib.request, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TIMEOUT = 180
ATTEMPTS = 2

NUM = r"-?\d+(?:\.\d+)?"
# M x0 y0 C cx y0 cx y1 x1 y1 V y1+15 C dx y1+15 dx y0+15 x0 y0+15 Z
BAND = re.compile(
    rf"^M ({NUM}) ({NUM}) C ({NUM}) ({NUM}) ({NUM}) ({NUM}) ({NUM}) ({NUM}) "
    rf"V ({NUM}) C ({NUM}) ({NUM}) ({NUM}) ({NUM}) ({NUM}) ({NUM}) Z$"
)

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def fetch(url):
    last = None
    for attempt in range(ATTEMPTS):
        t = time.time()
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT, context=ctx) as r:
                return r.read().decode(), time.time() - t, None
        except Exception as e:  # noqa: BLE001 - any failure is a data point
            last = f"{type(e).__name__}: {e}"
    return None, None, last


def measure(raw):
    """Split at g.node and measure each group separately."""
    i = raw.find('<g class="node">')
    track, node = (raw[:i], raw[i:]) if i > 0 else (raw, "")

    track_paths = re.findall(r'<path d="([^"]+)"', track)
    conforming, thickness, ctrl_u = 0, set(), []
    offenders = []
    for d in track_paths:
        m = BAND.match(d.strip())
        if not m:
            if len(offenders) < 3:
                offenders.append(d[:160])
            continue
        conforming += 1
        f = [float(v) for v in m.groups()]
        x0, y0, cx, _, _, _, x1, y1, v = f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8]
        thickness.add(round(v - y1, 4))
        if x1 != x0:
            ctrl_u.append(round((cx - x0) / (x1 - x0), 4))

    rect_heights = set(re.findall(r"<rect[^>]*height=\"([^\"]+)\"", track))
    vb = re.search(r'viewBox="[\d.\- ]*? ([\d.]+) ', raw)

    return {
        "tracks": len(set(re.findall(r'trackID="(\d+)"', raw))),
        "segments": node.count("<path"),
        "bands": len(track_paths) + track.count("<rect"),
        "trackPaths": len(track_paths),
        "trackRects": track.count("<rect"),
        "bandGrammarConforming": conforming,
        "bandGrammarOffenders": offenders,
        "bandThicknesses": sorted(thickness),
        "ctrlUMin": min(ctrl_u) if ctrl_u else None,
        "ctrlUMax": max(ctrl_u) if ctrl_u else None,
        "rectHeights": sorted(rect_heights),
        "stripWidth": float(vb.group(1)) if vb else None,
        # features that would trip the validation gate if they appeared in g.track
        "strokesInTrack": track.count("stroke"),
        "strokesInNode": node.count("stroke"),
        "textElements": raw.count("<text"),
        "gradients": raw.count("Gradient"),
        "clipPaths": raw.count("<clipPath"),
        "filters": raw.count("<filter"),
    }


def main():
    table = json.loads((ROOT / "data" / "nodeTable.json").read_text())
    nodes = sorted(table["nodes"], key=lambda n: n["length"])
    out, results = ROOT / "data" / "nodeSurvey.json", []

    print(f"{'node':>8} {'span':>7} {'bytes':>12} {'trk':>4} {'seg':>5} "
          f"{'bands':>8} {'conform':>9} {'sec':>6}", flush=True)

    for n in nodes:
        raw, elapsed, err = fetch(n["url"])
        if raw is None:
            row = {"node": n["node"], "span": n["length"], "error": err}
            print(f"{n['node']:>8} {n['length']:>7} {'FAILED':>12}  {err[:60]}", flush=True)
        else:
            m = measure(raw)
            row = {"node": n["node"], "span": n["length"], "bytes": len(raw),
                   "seconds": round(elapsed, 1), **m}
            pct = (100.0 * m["bandGrammarConforming"] / m["trackPaths"]) if m["trackPaths"] else 0.0
            flag = "" if pct == 100.0 else "  <-- NON-CONFORMING"
            print(f"{n['node']:>8} {n['length']:>7} {len(raw):>12,} {m['tracks']:>4} "
                  f"{m['segments']:>5} {m['bands']:>8,} {pct:>8.2f}% {elapsed:>6.1f}{flag}",
                  flush=True)
            del raw
        results.append(row)
        out.write_text(json.dumps({"generatedAt": time.strftime("%Y-%m-%d"),
                                   "timeoutSeconds": TIMEOUT, "attempts": ATTEMPTS,
                                   "nodes": results}, indent=1))

    ok = [r for r in results if "error" not in r]
    print(f"\nfetched {len(ok)}/{len(results)}; wrote {out.relative_to(ROOT)}", flush=True)
    if ok:
        tot = sum(r["trackPaths"] for r in ok)
        con = sum(r["bandGrammarConforming"] for r in ok)
        print(f"band grammar: {con:,}/{tot:,} track paths conform "
              f"({100.0*con/tot:.4f}%) across {len(ok)} documents", flush=True)
        print("distinct band thicknesses:",
              sorted({t for r in ok for t in r["bandThicknesses"]}), flush=True)
        print("distinct rect heights:",
              sorted({h for r in ok for h in r["rectHeights"]}), flush=True)
        print("track counts:", sorted({r["tracks"] for r in ok}), flush=True)
        print("control-point u range:",
              min(r["ctrlUMin"] for r in ok if r["ctrlUMin"] is not None),
              max(r["ctrlUMax"] for r in ok if r["ctrlUMax"] is not None), flush=True)
        for r in ok:
            if r["bandGrammarOffenders"]:
                print(f"  offenders in {r['node']}:", r["bandGrammarOffenders"], flush=True)
        print("strokes in g.track (must be 0):",
              sorted({r["strokesInTrack"] for r in ok}), flush=True)
        print("text/gradients/clipPaths/filters:",
              sorted({(r["textElements"], r["gradients"], r["clipPaths"], r["filters"]) for r in ok}),
              flush=True)


if __name__ == "__main__":
    sys.exit(main())
