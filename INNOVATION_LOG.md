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

---

## 2026-07-19 — Signal Loom (Correlation Engine bespoke D3 invention)

**What it is.** A purpose-invented D3 visualization that does not exist in any chart
library: a **weave** of one Correlation Engine run's real payload. Rows = evidence
platforms (Perplexity / X / Reddit / Instagram — the four "shuttles"), columns = the
nine relationship types (Investment … Media-narrative). Every (edge × backing
evidence record) pair is drawn as ONE woven thread (cubic-bezier) from the
evidence's platform shuttle to the edge's type column. Thread **thickness = edge
confidence**, **opacity = recency decay** (fresh = bold, stale = faint), **color =
relationship type**, **dashes = ⚠ contradiction**. Hover isolates a single thread
(dims the rest to 5%); click opens the same evidence popover/lightbox as the force
graph. The loom answers a question the node-link canvas cannot: *which platforms
actually feed which relationship types* — e.g. Instagram threads cluster on
Media-narrative, Perplexity on Trade/Investment.

**Why it qualifies as the D3 invention.** No standard chart type (sankey, chord,
heatmap) expresses a 4×9 many-to-many evidence→type mapping with per-thread
confidence/recency/contradiction encodings; it is built with raw d3 selections +
scales (no d3-sankey/chord plugin), logged here per spec, and rendered from the
live run JSON only (`src/correlation/BespokeViz.jsx`).

**Implementation notes.** `d3.scalePoint` for both axes; per-(platform,type) cell
fan-out offsets so stacked threads never overlap; `mouseenter/leave` cross-fades
computed from the same recency function as the graph's opacity; contradiction
dashes from the server-computed `edge.contradiction` flag.

**Verification.** Rendered against run KE-20260719025015 (11 evidence, 6 edges →
15 woven threads). Vite build green; served from the deployed sandbox
(sb-5ezbro8pqhgo.vercel.run) with HTTP 200 on all CE routes.
