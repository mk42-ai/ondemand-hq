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

---

## 2026-07-19 — Invention 3: The Context-Weighted Evidence Prism (Correlation Engine V2)

**What it is.** A deterministic, fully auditable **context weighting engine** that turns
every raw evidence record into a weighted intelligence signal BEFORE any model sees it.
Each record is classified by age into `historical (0.2)` / `recent (0.6)` / `breaking
(1.0)` base weights, then multiplied by observable properties of the record itself:
×2 direct UAE relevance (registry/alias match in claim+snippet), ×2 government source
(regex over source+URL: wam/mofa/ministry/embassy/.gov/UN organs), ×3 official statement
(announcement/decree/MoU/joint-communiqué phrasing), ×2 multi-source corroboration
(≥2 distinct platform:source pairs sharing a 6-word claim stem). Weights cap at 3.0,
normalize to 0..1, and blend into edge weights at 60% legacy deterministic / 40% context.
The factors are STORED ON THE RECORD (`weightFactors: ["breaking","gov-source×2",…]`)
so every edge width in the UI can be audited back to the exact multipliers that produced
it — no black-box scoring.

**Why it qualifies.** Standard graph tools weight edges by count or recency alone;
none encode an intelligence-tradecraft weighting doctrine (officialness > corroboration
> recency > volume) as a pure function with on-record audit trails. It also feeds the
V2 Heat Mode: `weightClass === 'breaking'` drives the breathing pulse on the canvas —
the pulse is a fact about the data, not an animation flourish.

**Implementation.** `server/correlation.js` `applyContextWeighting()` (pure, ~40 lines),
parameters exposed at `/api/correlation/config` (single source of truth for UI + docs).

## 2026-07-19 — Invention 4: Tiered Epistemic Edge Grammar (Verified→Predicted)

**What it is.** A four-tier **visual epistemology** for relationship edges: `Verified`
(evidence-gated extraction; solid stroke in the category color), `Likely` (inferred,
p 0.6-0.85; dashed violet), `Possible` (inferred, p 0.35-0.6; dotted slate), `Predicted`
(forward-looking; long-dash fuchsia). The second-stage AI correlation pass may ONLY
emit an inference if it cites ≥1 `basis_evidence_ids` from the run's evidence pool —
inferences with no observable basis are dropped server-side (the same hard gate as
verified edges, one level up). Every inferred edge carries `probability`, `supporting`,
`counter`, and `reasoning` fields, rendered verbatim in the Relationship Inspector and
Prediction Mode. Inferred edges deliberately get NO flow particles — motion is reserved
for verified flows, so the canvas itself never overstates certainty.

**Why it qualifies.** Knowledge-graph UIs typically render inferred and stated edges
identically (or hide inference entirely). Encoding epistemic status as a first-class
visual grammar (color+dash+particle-absence) with per-edge counter-evidence is not a
library feature anywhere; it is the difference between an intelligence product and a
picture. The dash patterns survive grayscale printing — the tier remains legible with
zero color information.

**Implementation.** `TIER_STYLES` in `src/correlation/adapter.js`; inference stage 4b in
`server/correlation.js`; `TierLegend` chips filter tiers live; Prediction Mode
(`V2Surfaces.jsx`) separates evidence-backed forecasts from anything speculative.
