# Live API reachability, CORS and parameter behaviour — measured 2026-08-12

Investigation only, no product code. Closes the week-one question: **can a browser
fetch the tube map API cross-origin?**

**Answer: yes, unconditionally, with no proxy.** Nothing is needed from UCSD.

Everything below was run on 2026-08-12 (UTC) against
`https://pangenome-api.ucsd.edu:8000/seqtubemap` from `curl` on macOS, with
`Origin: http://localhost:5173` on every request that reports CORS headers.

## The request

The canonical URL — the one `README.md` carries percent-encoded inside its harness
link, and the one the fixture was captured from. Paste both lines; every finding
below is one command on top of them:

```sh
URL='https://pangenome-api.ucsd.edu:8000/seqtubemap?chrom=chr1&start=25331046&end=25331646&version=v2&pathnumoption=normal&nodewidthoption=compressed&minigraphnode=5519'

curl -sS -D - -o live.svg -H 'Origin: http://localhost:5173' "$URL"
```

## CORS

Simple GET, response headers verbatim:

```
HTTP/1.1 200 OK
date: Wed, 12 Aug 2026 18:44:58 GMT
server: uvicorn
content-type: image/svg+xml
accept-ranges: bytes
content-length: 3533705
last-modified: Wed, 12 Aug 2026 18:45:02 GMT
etag: "21749393875968830a42c8ae43e355ac"
access-control-allow-origin: *
access-control-allow-credentials: true
```

Preflight (`OPTIONS` with `Access-Control-Request-Method: GET`):

```
HTTP/1.1 200 OK
vary: Origin
access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
access-control-max-age: 600
access-control-allow-credentials: true
access-control-allow-origin: http://localhost:5173
```

The two differ — the GET answers `*`, the preflight echoes the requesting origin
under `vary: Origin` — because they come from different layers: the wildcard is a
blanket header on the response, the echo is the CORS middleware answering a
preflight the way a credentialed setup would. Either satisfies the browser, and a
plain `fetch()` or `<img>`/XHR load of the SVG never triggers the preflight path at
all — no custom request headers are involved, so the GET's `*` is the header that
matters in practice.

The non-standard port is a non-issue: ports do not enter CORS, only the `Origin`
check does, and it passes.

**No proxy route is needed. No request to Cici Bu is needed.** PGB's local S3 CORS
proxy is not a model we have to copy here.

Two caveats worth carrying forward, neither blocking:

- `access-control-allow-origin: *` together with `access-control-allow-credentials:
  true` is a contradictory pair — browsers reject credentialed requests under a
  wildcard origin. Fetch this endpoint **without** `credentials: 'include'`. We
  don't need credentials, so this never bites, but a future `credentials: 'include'`
  would fail with a confusing CORS error rather than a 401.
- **Error responses carry no CORS headers.** `version=v1` on the canonical URL, same
  `Origin` header, returns the complete response below — note the absence of any
  `access-control-*` line:

  ```
  HTTP/1.1 500 Internal Server Error
  date: Wed, 12 Aug 2026 19:22:40 GMT
  server: uvicorn
  content-length: 21
  content-type: text/plain; charset=utf-8
  ```

  In a browser that surfaces as a generic network / CORS failure, not as a readable
  500. Client error handling cannot distinguish "server broke" from "network died" —
  treat any rejected fetch as "no tube map", don't try to read a status code out of
  it.

## The fixed parameters — behaviour and drift

`public/stm-chr1-25331046-25331646.svg` was re-fetched today and is **byte-identical**
to the committed fixture (sha256
`ab77c617e93dd78c086680d1e77949338a229d27259fe934b64afa30928f61a6`): same
`viewBox="0 -80 35562.42857142856 6325"`, 369 strand names, 5742 `<path>` + 4603
`<rect>` = 10,345 live elements. The fixture remains a faithful stand-in and the
documented parameter set still produces exactly what `CONTEXT.md` describes.

Drift found in *how the parameters behave* — none of it breaks the current URL, all
of it matters when someone constructs a URL that is slightly different:

| Variation | Result |
|---|---|
| documented set (baseline) | 200, 3,533,705 B, 369 strands |
| `version` omitted | identical to baseline — **v2 is the default** |
| `version=v1` | **500 Internal Server Error** (and no CORS headers) |
| `nodewidthoption` omitted | identical to baseline — **compressed is the default** |
| `nodewidthoption=fixed` | 200, wider map: `viewBox` width 39429.4 vs 35562.4 |
| `nodewidthoption=bogus` | **500** |
| `pathnumoption=all` | identical to baseline |
| `pathnumoption=bogus` | identical to baseline — **value ignored** |
| `pathnumoption` omitted | 200, but only **46 strands**, `viewBox` height 855 |

So of the three "fixed" parameters, only two are load-bearing and neither behaves
the way its name suggests:

1. **`pathnumoption` is the parameter that matters, and only its presence matters.**
   Present with *any* value → all 369 haplotype strands. Absent → 46 strands, a
   different map entirely. Keep sending `pathnumoption=normal`; do not "clean up" a
   URL by dropping it.
2. **`nodewidthoption` is honoured** (`compressed` vs `fixed` change the layout) but
   defaults to `compressed`, and an unrecognised value 500s rather than falling back.
3. **`version` is inert at its only working value.** `v2` is the default and `v1` is
   gone. Sending `version=v2` is harmless documentation of intent.

Rule of thumb: **unknown values 500 for `version` and `nodewidthoption`, and are
silently ignored for `pathnumoption`.** Don't pass anything you haven't tried.

## `minigraphnode` — the silent-degradation hazard

Worth flagging because it fails without failing.

`minigraphnode=999999999` (a node that does not exist) and `minigraphnode` omitted
entirely both return **HTTP 200 and a perfectly valid 3.4 MB SVG**. No error, no
empty response. But the SVG is a different thing:

| | `minigraphnode=5519` | nonexistent / omitted |
|---|---|---|
| distinct strand colors | 108 continuous RGB | **8** (`#08306b`, `#08519c`, `#6baed6`, `#c6dbef`, …) |
| grey elements — `color="rgb(211, 211, 211)"`, spaces included | 217 (124 `<path>` + 93 `<rect>`) | 0 |

With a valid node, colors are the continuous PCLAI signal `CONTEXT.md` describes,
and the 217 grey elements are the haplotypes that *don't* traverse the node. With an
invalid one, the server falls back to an **8-color categorical Blues palette** —
which is almost certainly the origin of the "colors are categorical" inference in
`pgb/notes/sequence-tube-map/sequence-tube-map-api.md`, the one `CONTEXT.md`
corrects. Both observations are true; they're just
of two different responses.

Consequence for integration: a wrong or stale `minigraphnode` produces a
plausible-looking map whose coloring means nothing, and no status code says so. The
eligibility check ("a minigraph node absent from GRCh38 has no tube map") must stay
on the PGB side — **the API will not tell us**.

## Latency

Three consecutive full fetches of the baseline URL, warm:

```
total=4.29s ttfb=3.27s
total=4.40s ttfb=3.37s
total=4.34s ttfb=3.23s
```

3.4 MB **uncompressed, even when asked for**: with
`Accept-Encoding: gzip, br` the response still carries no `content-encoding` and the
same `content-length: 3533705`. `gzip -9` of that body locally is 371,910 B — a
9.5× saving the server is leaving on the floor. Still, ~3.3 s of the ~4.3 s is
server think time before the first byte, so compression alone wouldn't fix it. Live loads will want a
spinner; the ~4 s is a UX fact, not a CORS one, and is out of scope here.

## Recommended path forward

- **CORS: nothing to do.** Don't build a proxy, don't open a request with UCSD.
- Fetch without `credentials`.
- Treat any fetch rejection as opaque; don't parse status from it.
- Keep `pathnumoption=normal` in every constructed URL.
- Keep node-eligibility filtering in PGB — the API returns a misleading 200 for a
  node it doesn't know.

Re-run any of the above from the two lines under **The request**; every finding is
that `$URL`, edited, plus one `curl`.
