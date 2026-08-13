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

Writes data/failureProbe.json.

    python3 scripts/probe_failures.py
"""
import json, ssl, time, urllib.request, urllib.error, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
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
    out, results = ROOT / "data" / "failureProbe.json", {}

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


if __name__ == "__main__":
    main()
