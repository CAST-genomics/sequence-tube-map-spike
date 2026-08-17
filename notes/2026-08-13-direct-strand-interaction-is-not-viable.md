# Direct strand interaction is not viable — observed and measured 2026-08-13

Feeler mode works on paper and fails in the hand. Holding `Shift` and sweeping the
cursor across a real map produces partial renderings and visible tearing: the picture
comes apart mid-sweep rather than merely highlighting late.

## The conclusion, stated generally

The finding is not about feeler mode. It is about a whole class of interaction:

> **Altering the appearance of the strand set in real time, driven directly by
> pointer position, will not perform on a real map.** Highlighting, de-emphasis, and
> any other live restyling of the ribbons fall under this alike. The wall is not in
> any one of those features — it is in the coupling of *appearance change* to
> *pointer rate*.

Nothing in the design vocabulary is being given up. Highlighting a haplotype,
receding its neighbours, showing what a strand is — all remain requirements, SPEC
story 28 among them. **Only the means of invoking them changes: indirect instead of
direct.** A menu, a list of strands, a palette of colors to assign, selection driven
from PGB, a click rather than a hover — the toolbag for indirect invocation is deep,
and the measurements below show it has room to work in. That design is deliberately
not settled here; this note establishes the constraint it has to respect.

**Outcome: feeler mode ships disabled** (`strandFeeler`, off by default; `?feeler`
re-arms the harness). The code is intact, not deleted.

### One precision, so this is not over-applied

Tooltips are *not* expensive, and this note should not be cited as saying they are.
The segment tooltip in inspect mode measured spotless at both scales (below): it is
one small DOM node moving, not a restyle of 10,270 elements. If a tooltip moves to
the indirect side too, that is a choice about interaction vocabulary — direct
manipulation of strands going away as a whole — not a performance requirement. Keep
the two reasons distinct, because they have different expiry dates.

The cost is specifically in **touching the appearance of many strands at once**, and
it scales with how often that happens, not with how it is triggered.

## Why this was surprising

`2026-08-12-pan-zoom-frame-budget.md` measured this same map — ~10,270 live SVG
elements — dragging and zooming at a steady 8.3 ms, and concluded there was room to
spare. That result stands, and it is not in tension with this one. Pan and zoom move
a single `transform` on one composited layer: the browser skips straight to
compositing and never revisits the 10,270 elements. Highlighting swaps a stylesheet
rule, which invalidates **style for all 10,270 of them** and forces recalculation and
repaint. Same element count, different stage of the pipeline, three orders of
magnitude apart in cost.

The claim in SPEC and in the code — "one swapped CSS rule, O(1) per hover regardless
of element count" — was true about *authoring* the rule and silently false about
*honouring* it. That is the specific mistake worth remembering: the constant-time
reasoning applied to our own work, not the browser's.

## Method

Same rig as the pan/zoom note: headless-driven Google Chrome (Playwright
`channel: 'chrome'`), 1400×850 viewport, dev server on the committed fixture
(`chr1:25,331,046–25,331,646`, `minigraphnode=5519`, 10,270 strand elements). A
`requestAnimationFrame` sampler recorded inter-frame intervals; first two frames of
each run discarded.

The gesture is the one feeler mode exists to serve: a **vertical sweep at fixed x**,
three round trips from y=120 to y=700 in 6 px steps, crossing the strand set. Run
twice — once with `Shift` held (feeler), once without (inspect) as the control.

The display refreshes at 120 Hz, so 8.3 ms is a full frame rate. "Dropped" counts
frames over 16.7 ms (the 60 Hz budget); "stalls" counts frames over 50 ms, which is
where tearing becomes visible rather than merely unsmooth.

## Result

| Run | Frames | Median | p95 | Worst | Dropped | Stalls |
|---|---|---|---|---|---|---|
| Inspect sweep, fit scale | 593 | 8.3 ms | 8.9 ms | 9.4 ms | 0 | 0 |
| Inspect sweep, detail scale (~25× fit) | 583 | 8.3 ms | 8.9 ms | 9.3 ms | 0 | 0 |
| **Feeler sweep, fit scale** | 585 | 8.3 ms | **91.7 ms** | **3233 ms** | 77 | 73 |
| **Feeler sweep, detail scale** | 582 | 8.4 ms | **125.1 ms** | 250 ms | **190** | 166 |

At detail scale, **190 of 582 frames miss the 60 Hz budget and 166 exceed 50 ms** —
roughly one frame in three is late, and most of the late ones are late enough to see.
The 3.2-second worst frame at fit scale is the first highlight of the session, where
the initial rule application is paid in one lump. The median staying at 8.3 ms is
what makes this deceptive in casual use: most frames are fine, and the damage is
entirely in the tail.

Inspect mode is untouched at both scales — hit-testing the SVG on every pointer move
costs nothing measurable. **The hover is not the problem; the restyle is.**

## Why tuning does not rescue it

Three follow-ups, aimed at the obvious fixes before accepting the conclusion:

| Variant | Median | p95 | Worst | Dropped | Stalls |
|---|---|---|---|---|---|
| Feeler sweep, detail, **opacity transition removed** | 8.4 ms | 66.7 ms | 91.7 ms | 153 | 76 |

Deleting the transition — the first thing anyone would reach for — halves the tail
and still leaves 153 dropped frames of 582. The transition is an aggravator, not the
cause.

The floor is the swap itself. Applying one highlight rule and forcing style and
layout to settle, measured directly over 19 successive single-strand selections:

```
median 28.4 ms   worst 42.5 ms
```

**~28 ms is the atomic cost of one change to the strand set's appearance on this
map** — and it is a property of the element count, not of highlighting specifically.
Any other live restyling of the ribbons buys the same 28 ms. A pointer sweep
asks for that on every `pointermove` — tens of times a second. No scheduling,
throttling, `requestAnimationFrame` batching, or `content-visibility` trick makes a
28 ms operation fit into a gesture that demands one every few milliseconds. The
approach does not have a constant-factor problem; it is asking for the wrong thing.

## What the measurements say *is* viable

The decisive run. One strand highlighted with exactly the rule `applyHighlight()`
writes, then **left standing** while the researcher drags and zooms — the indirect
model, where selection changes on a click rather than on a move:

| Run | Frames | Median | p95 | Worst | Dropped | Stalls |
|---|---|---|---|---|---|---|
| Static highlight, drag-pan + wheel-zoom | 200 | 8.3 ms | 9.3 ms | 41.6 ms | 2 | 0 |

Full frame rate, two dropped frames in the whole session, no stalls. **A standing
highlight costs nothing to navigate under.** The 28 ms is paid once when the
selection changes and never again.

So every part of the appearance *design* survives intact — dim the others rather than
brighten the one, leave the ancestry coloring undistorted, one swapped rule, strands
identified by `track<N>` class. Only the **means of invoking it** has to change: a
discrete, user-initiated act instead of a continuous one. At ~28 ms, a change costs
about one dropped frame at the moment of the click, which is imperceptible in a way
that the same cost at pointer rate is not.

This is what makes the pivot a change of route rather than a loss of destination.

## Where this points

Not designed yet, and deliberately not decided here — but the constraint the design
must respect is now a number: **appearance changes must be discrete, user-initiated
events, budgeted at ~28 ms each.** Within that budget the toolbag is wide, and
nothing below is expensive on this map:

- a list of strands beside the map, selected from
- a palette or menu — assign a color to a sample, several at once, and let the
  assignment stand
- selection driven from PGB, which already knows which sample the researcher came in
  caring about
- click-to-select on a strand, a click being discrete where a hover is not
- search or filter by `sample#haplotype#contig`

Each of these swaps the rule once per user decision — a few times a minute — where
the feeler swapped it a few times a second. That is the whole difference, and it is
four orders of magnitude.

**What must not come back is any appearance change wired to pointer position.**

## Reproducing

The measurement scripts were scratch, not committed. To rebuild: serve the fixture,
open `?feeler`, install a `requestAnimationFrame` interval sampler, drive
`page.mouse.move` vertically at fixed x with and without `Shift` held, and compare
tails rather than medians — the median hides this entirely.
