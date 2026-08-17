# The API crashes on large responses — measured 2026-08-13

Found while sizing minigraph nodes for the renderer spike. It is not a rendering
problem, so it is recorded separately from the spike and should be raised with UCSD.

**Rewritten twice.** A five-node probe first called this "the largest nodes cannot be
fetched." The 30-node survey sharpened it to "nodes above ~8 kb of span." Both framings
were wrong: `scripts/probe_failures.py` shows the failure is driven by **response
size**, not span, and that a client *can* work around it.

## The evidence chain

**The survey** (`scripts/survey_nodes.py`, `data/nodeSurvey.json`) fetched all 30 nodes
in `data/nodeTable.json`, ascending by span, two attempts, no cooldown. **17 returned.**
Every node at or above 12,212 bp failed, plus `5508+` at 6,288 bp. Eleven HTTP 500s,
two TLS handshake timeouts.

**The probe** (`scripts/probe_failures.py`, `data/failureProbe.json`) then answered the
three things the survey could not:

| | finding |
|---|---|
| **Control** | `5514+` re-fetched fine — 13.5 MB in **18.3 s**, against 89.3 s in the survey. The server was healthy at probe time and ~5× faster than when the survey ran. |
| **A · what the error is** | `server: uvicorn`, `content-type: text/plain`, body `Internal Server Error`. That is Starlette's default unhandled-exception handler, served directly. **No proxy is converting an upstream timeout — the application throws.** No traceback reaches the client; it is in UCSD's logs. |
| **B · is it load?** | **No.** All four failing nodes were re-requested cold, isolated, descending by span, with 60 s of quiet before each. All four still 500'd. The survey's ascending-order/no-cooldown confound is dead. |
| **C · is it the node or the request?** | **The request.** Same `minigraphnode`, narrower coordinate window: |

```
5511+  window 1×     = 12,212 bp   HTTP 500          18.4 s
5511+  window 0.5×   =  6,106 bp   12,103,840 bytes  50.3 s
5511+  window 0.25×  =  3,052 bp    5,595,860 bytes  21.7 s
5511+  window 0.125× =  1,526 bp    2,975,639 bytes  17.0 s
```

A node that reliably fails at full width succeeds at half. Nothing is broken about the
node; the request is simply asking for too much.

## Span is a proxy, and a poor one

Output size per base pair varies **more than 3×** between nodes — 1,275 to 4,004 bytes
per bp among the successful ones — because variant density differs. So span predicts
response size only loosely, and that is what makes `5508+` fail at 6,288 bp while
`5514+` succeeds at 7,967 bp: they are not the same amount of work.

What is known about where the ceiling sits:

- **Largest success observed: 14,215,504 bytes / 40,442 bands** (`5520+`).
- `5511+` at half width produced 12.1 MB and succeeded; at full width it would be
  roughly 24 MB, and it failed.
- So the ceiling lies **somewhere between ~14 MB and ~24 MB of response**, un-bracketed.
  Narrowing it means sweeping the window between 0.5× and 1× and recording where it
  breaks — worth doing before the report goes to UCSD.

Every failure returned in **~18 s**, the same as a *successful* control fetch. These are
not slow grinds that give up; the server does its normal work and then throws.

## Correcting something stated earlier in this investigation

I wrote repeatedly that "no client-side decision fixes this." **That is wrong.**
Narrowing the coordinate window is a client-side change and it does turn a 500 into
data. The 500 itself is unquestionably server-generated, but the request that provokes
it is ours to shape.

That opens a real mitigation — request a large node in coordinate slices — with an
obvious cost: a slice is not the whole node, so the viewer would be showing part of the
interior and would need to say so, or stitch slices, which is layout work this project
has deliberately refused (`CONTEXT.md` #1). Not recommended without discussing it with
UCSD first, but it is on the table and it was not before.

## Consequences

- **Node eligibility cannot be gated on span.** `CONTEXT.md` notes PGB must check
  eligibility because the API will not tell us. Adding "and skip large nodes" does not
  work: density varies 3×, so a span threshold either blocks nodes that would have
  worked or admits nodes that crash. Eligibility needs the response size, which is only
  knowable by asking.
- **The compact-geometry request to UCSD gets stronger.** The viewer needs six floats
  per band; it receives ~300 bytes of markup per band. The payload the server is
  crashing while generating is roughly 20× larger than what the renderer consumes.
- **It is a bug, not a capacity limit.** An unhandled exception at ~18 s on a healthy
  server is a defect UCSD can likely fix, which is a much better conversation than
  "your server is too slow."
- **The spike still fences this off.** See
  [`2026-08-13-webgl-band-renderer-spike-brief.md`](./2026-08-13-webgl-band-renderer-spike-brief.md).

## What scales with what

Measured across the 17 retrieved documents. "Size" was doing four jobs at once:

- **Strand count is invariant to span** — a 1 bp node and a 6,440 bp node both carry
  464 — but **varies by node**: 369, 378 and 464 all appear. It is how many haplotypes
  traverse *that* node. Never hard-code it.
- **Segment count grows with span** — 40 → 48 → 318 → 767.
- **Band count follows segment count**: 7,425 → 8,335 → 36,813 → 40,442.
- **Bytes track band count**, at roughly 250–350 bytes per band.
- **A band is a fragment, not a ribbon.** One haplotype is a median of 28 pieces in the
  fixture, ~87 in `5520+`. Band counts count shapes.

There is a floor as well as a ceiling: even a **1 bp** node is 2.55 MB and 7,425 bands.
