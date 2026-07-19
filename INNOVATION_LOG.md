# INNOVATION_LOG.md — ODA Productivity Suite

## 2026-07-19 01:31 UTC — MSM Analysis integration (recovered feature merge)

**What:** Merged the MSM Analysis module — the only surviving copy of which lived in the
divergent working-tree snapshot `code-files-20260718-091224_v1.zip` (2026-07-18 ~09:12 UTC),
never committed to git — into the mainline at checkpoint 70146e2.

**Why it matters:** The module adds a daily mainstream-media monitor (broadcast transcription
→ AI analysis → newsroom dashboard) and an "Analyse deeper" bridge that grounds chat answers
in stored broadcast transcripts. Losing the snapshot would have lost the feature entirely.

**How (non-regressive merge):** 22 MSM-exclusive files copied verbatim; 4 existing files
received additive-only wiring (route registration, sidebar button, SPA route + render branch,
style block). No repo file newer than the zip was overwritten — the newer X-data feed, intel
fixes and checkpoint notes are untouched.

**Model config:** `predefined-gpt-5.6-sol` endpoint + documented top-level `reasoningEffort`
(low|medium|max, default medium) via the shared `streamQuery()` — zero undocumented params.

**Verification:** node --check pass on merged server files; Vite build; fresh Vercel sandbox
deploy with HTTP 200 checks on /, /api/health and the MSM routes (timestamps in NOTES.md and
the run response).

## 2026-07-19 (Phase C) — Correlation Engine visual inventions

### Invention 1 — Evidence-Density Heat Ring (novel D3 visualization)
A 12-sector annular "evidence clock" built with pure d3.arc() from the REAL per-run
evidence store (no demo data): each dated evidence record lands in a sector by
publish-order position across the run window; sector outer radius encodes count,
fill heat (d3.interpolateYlGnBu) encodes average confidence, and the sector stroke
takes the dominant platform's color (web/X/Instagram/Reddit). One glance answers
"when did evidence cluster, how confident was it, and which platform drove it" —
a chart type not present in ECharts' or the reference repo's example galleries.
Implementation: src/correlate/EvidencePanels.jsx (ring useMemo, ~30 lines of D3).

### Invention 2 — Recency-Kinetic Evidence Graph (motion-as-metadata encoding)
The force canvas encodes evidence RECENCY as motion: directional particle speed per
edge is 0.002+0.01×recency (fresh intel visibly streams faster along its edge), edge
opacity fades with the same 14-day half-life used server-side, and new-vs-previous-run
edges (from the stored daily diff) emit an expanding gold pulse ring at the edge
midpoint for the first seconds after load. Combined with the PageRank-sized nodes and
Louvain community tints computed client-side in graphAdapter.js, the graph's MOTION
carries the temporal dimension that static width/color channels cannot — an encoding
invented for this build (not in the react-force-graph example set, which uses constant
particle speeds).
Implementation: src/correlate/graphAdapter.js (particleSpeed/isNew) +
CorrelationEngine.jsx paintLink pulse.

### Invention 3 — IG-proof photo-nodes
Nodes whose evidence includes downloaded official-Instagram proofs render the actual
on-disk proof JPEG (public/proofs/wamnews-*.jpg) clipped into the node circle with a
platform-colored ring — the graph literally shows its visual evidence at the node
level, turning provenance into a first-class visual channel.
Implementation: CorrelationEngine.jsx paintNode + graphAdapter img resolution.
