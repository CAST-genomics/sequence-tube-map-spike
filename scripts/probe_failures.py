#!/usr/bin/env python3
"""Diagnose why the API fails on large minigraph nodes.

survey_nodes.py established that nodes above ~12 kb of span fail, but it issued
requests back to back in ascending span order -- so server load and span rise
together and the two are confounded. It also discarded the error responses. Three
experiments separate the possibilities:

  CONTROL  re-fetch a node that succeeded, to confirm the server is healthy now.
  A        capture status, headers and body of the failures -- an application
           traceback means a real generation failure; an nginx/gateway page means
           an upstream timeout, which is a different problem with a different fix.
  B        re-request failing nodes COLD, in DESCENDING span order, with a quiet
           minute before each. If a 15 kb node succeeds alone, the ceiling is about
           load and concurrency, not span.
  C        hold minigraphnode fixed and shrink the coordinate window. If a narrow
           window succeeds, cost tracks the requested span. If it still fails, the
           node itself is broken -- which is the only thing that explains 5508+
           failing at 6,288 bp while larger neighbours succeed.

C answered that the ceiling is driven by response size and left it un-bracketed,
somewhere between the largest observed success (14,215,504 bytes) and 5511+ at full
width (never observed, extrapolated at ~24 MB). Experiment D brackets it:

  D        bisect the coordinate window between a known success and a known failure,
           on TWO nodes of very different density. Each bisection converges on a
           largest-success size that is MEASURED, and a smallest-failure size that
           can only ever be PREDICTED -- a 500 returns no body, so the size of a
           failing response is never observable from the client. If two nodes whose
           density differs 2x break at the same number of BYTES and wildly different
           spans, the ceiling is a byte count. If they break at different byte
           counts, the response-size framing is wrong.

Writes data/failureProbe.json. A and B and C take about twenty minutes; D takes about
twelve and merges into the same file, so it can be run on its own:

    python3 scripts/probe_failures.py          # control, A, B, C
    python3 scripts/probe_failures.py d        # D only, merged into existing results
"""
import json, ssl, sys, time, urllib.request, urllib.error, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "failureProbe.json"
TIMEOUT = 180
QUIET = 60          # cold-start gap for experiment B
GAP = 30            # polite gap elsewhere

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def request(url, note=""):
    """One attempt. Never retries -- retrying would defeat the point of B."""
    t = time.time()
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT, context=ctx) as r:
            body = r.read()
            return {"outcome": "ok", "status": r.status, "bytes": len(body),
                    "seconds": round(time.time() - t, 1), "note": note}
    except urllib.error.HTTPError as e:
        raw = b""
        try:
            raw = e.read()[:1500]
        except Exception:
            pass
        return {"outcome": "http-error", "status": e.code,
                "seconds": round(time.time() - t, 1),
                "server": e.headers.get("Server"),
                "contentType": e.headers.get("Content-Type"),
                "headers": dict(e.headers),
                "bodyHead": raw.decode("utf-8", "replace"), "note": note}
    except Exception as e:
        return {"outcome": "transport-error", "error": f"{type(e).__name__}: {e}",
                "seconds": round(time.time() - t, 1), "note": note}


def show(label, r):
    tail = ""
    if r["outcome"] == "ok":
        tail = f"{r['bytes']:,} bytes"
    elif r["outcome"] == "http-error":
        tail = f"HTTP {r['status']} · server={r.get('server')} · type={r.get('contentType')}"
    else:
        tail = r["error"][:70]
    print(f"  {label:<34} {r['seconds']:>6.1f}s  {tail}", flush=True)


def url_for(n, start=None, end=None):
    s = n["start"] if start is None else start
    e = n["end"] if end is None else end
    return (f"https://pangenome-api.ucsd.edu:8000/seqtubemap?chrom={n['chrom']}"
            f"&start={s}&end={e}&version=v2&pathnumoption=normal"
            f"&nodewidthoption=compressed&minigraphnode={n['minigraphnode']}")


def main():
    table = json.loads((ROOT / "data" / "nodeTable.json").read_text())
    by_id = {n["node"]: n for n in table["nodes"]}
    out, results = OUT, {}

    def save():
        out.write_text(json.dumps({"generatedAt": time.strftime("%Y-%m-%d %H:%M"),
                                   "timeoutSeconds": TIMEOUT, **results}, indent=1))

    # ---- CONTROL -----------------------------------------------------------
    print("\nCONTROL — is the server healthy right now?", flush=True)
    ctl = by_id["5514+"]                       # 7,967 bp, succeeded in the survey
    r = request(url_for(ctl), "known-good node, re-fetched")
    show(f"5514+ ({ctl['length']:,} bp)", r)
    results["control"] = {"node": "5514+", "span": ctl["length"], **r}
    save()

    # ---- A: what do the errors actually say? -------------------------------
    print("\nA — capture the error responses", flush=True)
    for nid in ["5511+", "5522+", "5508+"]:
        time.sleep(GAP)
        n = by_id[nid]
        r = request(url_for(n), "error-detail capture")
        show(f"{nid} ({n['length']:,} bp)", r)
        if r["outcome"] == "http-error" and r["bodyHead"].strip():
            first = r["bodyHead"].strip().splitlines()[:6]
            for line in first:
                print(f"      | {line[:100]}", flush=True)
        results.setdefault("errorDetail", []).append({"node": nid, "span": n["length"], **r})
        save()

    # ---- B: cold, isolated, descending -------------------------------------
    print(f"\nB — cold and isolated, descending span, {QUIET}s quiet before each", flush=True)
    for nid in ["5522+", "5509+", "5511+", "5508+"]:
        print(f"  ...quiet for {QUIET}s", flush=True)
        time.sleep(QUIET)
        n = by_id[nid]
        r = request(url_for(n), "cold, isolated")
        show(f"{nid} ({n['length']:,} bp)", r)
        results.setdefault("coldIsolated", []).append({"node": nid, "span": n["length"], **r})
        save()

    # ---- C: shrink the window, hold the node ------------------------------
    print("\nC — same minigraphnode, narrower coordinate window", flush=True)
    n = by_id["5511+"]
    mid = (n["start"] + n["end"]) // 2
    for frac in [1.0, 0.5, 0.25, 0.125]:
        time.sleep(GAP)
        half = max(1, int(n["length"] * frac / 2))
        s, e = mid - half, mid + half
        r = request(url_for(n, s, e), f"window {frac:g}× ({e - s:,} bp)")
        show(f"5511+ window {frac:g}× = {e - s:,} bp", r)
        results.setdefault("windowSweep", []).append(
            {"node": "5511+", "fraction": frac, "windowBp": e - s, "start": s, "end": e, **r})
        save()

    print(f"\nwrote {out.relative_to(ROOT)}", flush=True)
    print("PROBE COMPLETE", flush=True)


# ---- D: bracket the ceiling -----------------------------------------------------

def bisect(by_id, nid, lo, hi, iterations, results, save):
    """Converge on the window fraction where nid stops returning data.

    lo is believed to succeed, hi is believed to fail; neither is trusted, and both
    are probed rather than assumed. Every observation is recorded in request order,
    so a success at a LARGER fraction than a failure -- which would mean cost is not
    monotonic in the window and bisection is the wrong instrument -- stays visible
    instead of being smoothed away by the search.
    """
    n = by_id[nid]
    mid_bp = (n["start"] + n["end"]) // 2
    seen = []

    def probe(frac):
        half = max(1, int(n["length"] * frac / 2))
        s, e = mid_bp - half, mid_bp + half
        time.sleep(GAP)
        r = request(url_for(n, s, e), f"bisect window {frac:.4f}x ({e - s:,} bp)")
        ok = r["outcome"] == "ok"
        bpb = round(r["bytes"] / (e - s), 1) if ok and e > s else None
        show(f"{nid} {frac:.4f}x = {e - s:,} bp", r)
        obs = {"node": nid, "fraction": round(frac, 6), "windowBp": e - s,
               "start": s, "end": e, "bytesPerBp": bpb, **r}
        seen.append(obs)
        results.setdefault("ceilingBisection", []).append(obs)
        save()
        return ok

    print(f"\n  {nid}: span {n['length']:,} bp, bracketing between "
          f"{lo:g}x and {hi:g}x", flush=True)
    if not probe(lo):
        print(f"  !! {lo:g}x already fails -- lower bound is wrong, "
              f"widen the bracket downward", flush=True)
        return summarise(nid, n, seen, results, save)
    if probe(hi):
        print(f"  !! {hi:g}x succeeds -- upper bound is wrong, "
              f"this node has no ceiling in range", flush=True)
        return summarise(nid, n, seen, results, save)

    for _ in range(iterations):
        frac = (lo + hi) / 2
        if probe(frac):
            lo = frac
        else:
            hi = frac
    return summarise(nid, n, seen, results, save)


def summarise(nid, n, seen, results, save):
    """Largest measured success against smallest predicted failure."""
    wins = [o for o in seen if o["outcome"] == "ok"]
    fails = [o for o in seen if o["outcome"] != "ok"]
    best = max(wins, key=lambda o: o["bytes"], default=None)
    worst = min(fails, key=lambda o: o["windowBp"], default=None)

    # A 500 carries no body, so a failure's size is never measured. Extrapolate it
    # from the densest observed success on this same node, and label it as such.
    predicted = None
    if worst and wins:
        rate = max(o["bytes"] / o["windowBp"] for o in wins)
        predicted = int(worst["windowBp"] * rate)

    s = {"node": nid, "span": n["length"],
         "largestSuccessBytes": best and best["bytes"],
         "largestSuccessWindowBp": best and best["windowBp"],
         "smallestFailureWindowBp": worst and worst["windowBp"],
         "smallestFailurePredictedBytes": predicted,
         "predictedFrom": "max bytes/bp observed on this node; NOT measured -- a 500 "
                          "returns an empty body",
         "nonMonotonic": bool(best and worst and best["windowBp"] > worst["windowBp"])}
    results.setdefault("ceilingSummary", []).append(s)
    save()

    print(f"  -> largest MEASURED success: "
          f"{(best and best['bytes']) or 0:,} bytes at {(best and best['windowBp']) or 0:,} bp")
    print(f"  -> smallest failure: {(worst and worst['windowBp']) or 0:,} bp, "
          f"PREDICTED {predicted or 0:,} bytes (never observed)")
    if s["nonMonotonic"]:
        print("  !! non-monotonic: a larger window succeeded than one that failed. "
              "Response size is not the whole story.", flush=True)
    return s


def experiment_d():
    """Bracket the size ceiling on two nodes of very different density."""
    table = json.loads((ROOT / "data" / "nodeTable.json").read_text())
    by_id = {n["node"]: n for n in table["nodes"]}
    results = json.loads(OUT.read_text()) if OUT.exists() else {}
    results.pop("ceilingBisection", None)
    results.pop("ceilingSummary", None)

    def save():
        results["generatedAt"] = time.strftime("%Y-%m-%d %H:%M")
        OUT.write_text(json.dumps(results, indent=1))

    print("\nD — bracket the ceiling", flush=True)

    # 5511+ is sparse: experiment C measured 12,103,840 bytes at 0.5x (1,982 B/bp)
    # and a 500 at full width. The ceiling is somewhere in that half.
    summaries = [bisect(by_id, "5511+", 0.5, 1.0, 4, results, save)]

    # 5508+ is the density outlier -- it fails at 6,288 bp while 5514+ succeeds at
    # 7,967 bp. No success has ever been observed on it, so the bracket opens at
    # 0.125x and the search is a wider one.
    summaries.append(bisect(by_id, "5508+", 0.125, 1.0, 5, results, save))

    print("\n  the question this was run to answer:", flush=True)
    for s in summaries:
        print(f"    {s['node']:<7} largest success {(s['largestSuccessBytes'] or 0):>12,} bytes "
              f"at {(s['largestSuccessWindowBp'] or 0):>7,} bp", flush=True)
    got = [s["largestSuccessBytes"] for s in summaries if s["largestSuccessBytes"]]
    if len(got) == 2:
        spread = abs(got[0] - got[1]) / max(got)
        print(f"    two nodes of different density agree on bytes to within "
              f"{spread:.1%}", flush=True)
        print("    -> a byte ceiling" if spread < 0.10 else
              "    -> NOT a clean byte ceiling; the framing needs revisiting", flush=True)

    print(f"\nwrote {OUT.relative_to(ROOT)}", flush=True)
    print("EXPERIMENT D COMPLETE", flush=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].lower() == "d":
        experiment_d()
    else:
        main()
