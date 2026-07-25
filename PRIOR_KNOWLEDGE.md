# PRIOR_KNOWLEDGE.md — mined from every previous attempt (2026-07-19, before any new code)

Sources mined: repo history (`git log` → 9e970ff … db1b1fc), prior-session `AUDIT.md` (2026-07-18),
`AUDIT_REPORT.md` (2026-07-16), `PLUGIN_TESTS_v1.md` (2026-07-18 audit), `NOTES_v1.md`, `ARCHITECTURE_v1.md`,
`CAPABILITY_MATRIX.md`, `state.json`, `graph-stack-all.zip` (library reference bundle), and the 2026-07-19
orchestration-layer pre-executed plugin payloads (media-knowledge + 2× searchFileDirectory + 2× Perplexity).

## 1. Known dead ends — DO NOT RE-WALK

| # | Dead end | Evidence | Rule for this build |
|---|---|---|---|
| D1 | **Webhook delivery chain for workflows** — the 24h correlation workflow's webhook target went HTTP **410** (ephemeral sandbox TTL); delivery FAILED while nodes ran fine | AUDIT.md item 5; PLUGIN_TESTS_v1 "delivery FAILED (webhook target HTTP 410)" | Do NOT depend on workflow→webhook delivery. Workflow = native scheduler; compute + versioning runs server-side; regenerate route executes the pipeline directly. |
| D2 | **Suffixed model id** `predefined-gpt-5.6-sol-medium` → **HTTP 400** | env.js comment, Phase-1 NOTES | Always decompose: `endpointId` + top-level `reasoningEffort`. |
| D3 | **Undocumented `modelConfigs.maxTokens`** → empty answer (GLM probe) | PLUGIN_TESTS_v1 auditor note | Never rely on it. Quick Query hard 150-token stop is implemented CLIENT-side (stream abort + truncation), noted in PLUGIN_TESTS.md. |
| D4 | **STT regressions** — `speech_to_text` 400 "Unknown error" ×3 (2026-07-17) and ×2 (2026-07-18) | PLUGIN_TESTS.md | No STT anywhere in CE. (TTS works; untouched.) |
| D5 | **Media API asset hosting** → HTTP 500 on every variant (2026-07-18 02:49Z) | NOTES.md | Serve IG proofs + brand assets from the app's own `public/`/uploads; no Media API dependency. |
| D6 | **`mrnev=1` World Bank param** → HTML error page; GHO server-side Dim1 filter 400s for some codes | PLUGIN_TESTS.md country-data section | (facts.js already encodes this — leave untouched.) |
| D7 | **Intel store gitignored → empty dashboard on fresh deploy** | intel.js seed-hydration comment | CE run store follows the same pattern: committed seed runs under `server/data/correlation-seed/` hydrated at boot. |
| D8 | Prior **SVG "UAE Correlation Engine"** overview component — removed 2026-07-19T02:03Z (db1b1fc) as a remnant of the old pre-evidence design | git show db1b1fc | The new CE is evidence-gated and canvas-rendered; do not resurrect the SVG aggregate. |

## 2. Proven assets to REUSE (verified live previously)

- **Chat pipeline**: `server/ondemand.js` pure-passthrough SSE proxy (thinking frames `fulfillment_thinking`, tool-call frames `step_output`, `fulfillment` answer tokens, `[DONE]`) — keep byte-for-byte.
- **Plugins already 200-proven** (PLUGIN_TESTS_v1, 2026-07-18): Perplexity `plugin-1722260873` (9.2s/8.8s), X Search `plugin-1751872652` (23.4s/13.7s), IG combined plugin `plugin-1762980461` (`getUserInfo` 1.0s/3.4s, `getTopPostsByUsername` 12.5s/17.3s, `downloadInstagramMedia` 6.7s→9 real JPEGs byte-verified 136,167 B on disk), TTS 200. **Reddit never tested** → must 200-test `plugin-1748003575` this build.
- **IG user-info separate candidate** discovered this session: `plugin-1716164040` "Instagram User Info Extracter" (spec asks for a fetch-user-info plugin distinct from the downloader) → 200-test; fall back to 1762980461 `getUserInfo` if it fails.
- **Workflow API proven shape**: `POST /automation/api/workflow` (create), `/{id}/activate`, `/{id}/execute` → executionID; poll `GET /automation/api/execution/{id}`; cron `0 0 */12 * * *` fired execution 6a5a91f4… successfully (2026-07-17). Existing workflows: intel 12h `6a5a79840a9d7b5ce1454b3d`, X-fetch `6a5b0f8221d41c1c020736a3` (fable-medium, 3/3 success).
- **Endpoints catalogue (live 2026-07-19)**: `predefined-claude-sonnet-5` (build/test), `predefined-claude-fable-5` (prod default, + reasoningEffort medium), GLM 4.7 Cerebras BYOI `byoi-6e314690-4eaf-4def-a33c-380809acf1f5` (200-proven 1.26–2.23s, sync+fulfillmentOnly).
- **graph-stack-all.zip** = reference READMEs only (d3, echarts, echarts-for-react, graphology, react-force-graph; 142 MB, no product code). Deps committed at f1cc8f5: react-force-graph-2d 1.29.1, graphology 0.26, graphology-metrics 2.4, graphology-communities-louvain 2.0.2, d3 7.9, echarts 6.1, echarts-for-react 3.0.6.
- **react-force-graph-2d knowledge** (README + Perplexity research payload): `nodeCanvasObject(node, ctx, globalScale)` custom draw; `linkDirectionalParticles` + `linkDirectionalParticleSpeed`/`Width`; `zoomToFit(ms, px)`; `onEngineStop` (fallback: poll `getGraphBbox()`); `onNodeHover` highlight sets (node+neighbors, dim rest); image-in-node via cached `Image()` objects drawn in nodeCanvasObject; d3-force physics `d3VelocityDecay`, `cooldownTicks`, `warmupTicks`.

## 3. Prior-attempt status (from AUDIT.md 2026-07-18) — what this build must close

WORKS(1): thinking/tool-call streaming. EXISTS-BUT-BROKEN(5): brief-schema pipeline (no evidence schema), 5-plugin stack (IG unintegrated, Reddit untested), workflow (no versioning/diff), model config (no sonnet/fable), run storage (no evidence-JSON download). MISSING(5): edge extraction, weighting/dedupe/contradictions, Connected Dots, GLM Quick Query, sonnet-5/fable-5 policy.

## 4. Fresh evidence sample (orchestration layer, 2026-07-19) — pipeline design reference

UAE entity news gathered live: AD Ports @ MIITE 2026; ADNOC $9.5B local manufacturing + $15B gas allocation;
Mubadala/ADNOC/ADQ Hydrogen Alliance MoU; G42 US AI expansion; UAE–India defense framework; Mubadala US LNG
backing. → Used ONLY to design/verify the evidence schema + edge taxonomy. Runtime data always comes from the
live 5-plugin calls; nothing from this sample is hardcoded into a run.


## 5. Resolution stamps — 2026-07-25 (verified at HEAD e56acfd, file:line evidence)

All EXISTS-BUT-BROKEN(5) and MISSING(5) items from the 2026-07-19 status line are CLOSED:

- **B1 brief-schema pipeline — CLOSED 2026-07-25** — `server/oda/handoff.js:42` (`const defects = []` typed-handoff validation; throws on defects).
- **B2 5-plugin stack (IG + Reddit) — CLOSED 2026-07-25** — `server/correlation.js:63-64` (reddit `plugin-1748003575`, igDownload `plugin-1762980461`), wired into the live gather at `:323,:356`. Caveat: Reddit is code-integrated; as a chat-attachable agent the platform returns 400 invalidAgentIds (PLUGIN_TESTS.md 2026-07-25 06:36Z) — it remains a CE evidence-source key with graceful absence.
- **B3 workflow versioning/diff — CLOSED 2026-07-25** — `server/correlation.js:796` (`GET /api/correlation/diff/:iso`), `server/oda/runStore.js:17` (artifact supersede versioning).
- **B4 model config sonnet/fable — CLOSED 2026-07-25** — `server/oda/brains.js:57,59` (`'sonnet-5'`, `'fable'` BRAINS entries).
- **B5 run-storage evidence-JSON download — CLOSED 2026-07-25** — `src/correlation/CorrelationEngine.jsx:395` (JSON download button via `runDownloadUrl`).
- **M1 edge extraction — CLOSED 2026-07-25** — `server/correlation.js:5` (no-edge-without-evidence rule; impl `:239-251`).
- **M2 weighting/dedupe/contradictions — CLOSED 2026-07-25** — `server/correlation.js:251` (weight = .35·count + .25·diversity + .20·recency + .20·conf; dedupe merge Map; contradiction via altStance).
- **M3 Connected Dots — CLOSED 2026-07-25** — `src/correlation/CorrelationGraph.jsx:2,337` (ForceGraph2D canvas; mounted CorrelationEngine.jsx:498,558).
- **M4 GLM Quick Query — CLOSED 2026-07-25** — `server/correlation.js:922` (`POST /api/quick-query`, GLM 4.7 Cerebras).
- **M5 sonnet-5/fable-5 policy — CLOSED 2026-07-25** — `server/env.js:123` (`CE_MIN_DATA_POINTS` ≥100 clamp), `server/intelligence/dataFetch.js:82` (`enforceEvenBatch`).

WORKS(1) thinking/tool-call streaming: re-verified live 2026-07-25T22:25:44.719Z — gpt-5.6-sol+medium
streamed probe, TTFT 4097ms, 24 fulfillment frames + statusLog/heartbeat/metricsLog/[DONE].
