# AUDIT.md — Pre-Change Audit: OnDemand API digest · Dependency/Endpoint Map · Plan Mode Root-Cause Trace

> **Mandatory pre-change audit ritual — analysis only. No code changes were made in this pass.**
> Repo: `mk42-ai/ondemand-hq` · Branch: `feature/oda-workflow-overhaul`
> **Verified HEAD: `e66b67bdeed63623ea6356abf2d76e7485ad7bb2`** (short `e66b67b` — exactly the expected commit)
> Commit date: `2026-07-25T00:51:52Z` · Cloned fresh: `[ts: 2026-07-25T01:15:20Z]`
> Subject: *"ODA Productivity Suite: recovered build v1.6.0 — full suite with ODA Workspace UI (Quick/Full mode, 12-step benchmark pipeline, bilingual branding), backend streaming passthrough, 8 tool features, plugin tests and architecture docs"*
> Audit window (all analysis performed live in this window): **2026-07-25T01:15:20Z → 2026-07-25T02:20:00Z**
> Every finding below carries a machine-parseable ISO-8601 UTC stamp in the form `[ts: …Z]`.

---

## 0. Step-0 repo sync record

| Item | Value | Stamp |
|---|---|---|
| Remote | `https://github.com/mk42-ai/ondemand-hq.git` (authenticated mk42-ai credential reused from prior workspace remote) | `[ts: 2026-07-25T01:14:55Z]` |
| Branch pulled | `feature/oda-workflow-overhaul` | `[ts: 2026-07-25T01:15:20Z]` |
| HEAD | `e66b67bdeed63623ea6356abf2d76e7485ad7bb2` — matches the expected `e66b67b` exactly (not newer; it is the branch tip) | `[ts: 2026-07-25T01:15:24Z]` |
| Working tree | clean (`git status --short` empty) before this AUDIT.md was added | `[ts: 2026-07-25T01:15:24Z]` |
| History shape | single recovered-build commit — the branch contains exactly one commit (root); all "prior fix" provenance lives in the committed docs (`ROOT_CAUSES.md`, `NOTES.md`, `CHANGELOG.md`), not in git history | `[ts: 2026-07-25T01:17:10Z]` |

---

## (a) OnDemand API digest

**Method (never from memory):** the installed `ondemand-api-docs` skill was loaded and its documented flow executed live this pass: `GET {base}/config/v1/public/docs/categories` then `GET {base}/config/v1/public/docs/reference/api/{slug}` per operation, `apikey` header, base `https://api.on-demand.io`. Streaming-frame facts additionally verified against the repo's committed **live SSE wire captures** (`debug/sse-samples/*.sse.log`) and `NOTES.md`'s doc-verification log. Each item is tagged `VERIFIED-LIVE-DOCS` (fetched this audit), `VERIFIED-WIRE-CAPTURE` (real captured frames in-repo), or `REPO-VERIFIED-LIVE` (verified against the live API in a logged prior pass recorded in NOTES.md). `[ts: 2026-07-25T01:17:45Z]`

### a.1 Documented public API surface (categories index) — VERIFIED-LIVE-DOCS `[ts: 2026-07-25T01:17:45Z]`

8 services: **Media API** (fetchmedia, createmediaurl, deletemedia) · **Chat & Agent Tools API** (createchatsession, getchatsessions, submitquery, getchatsession, getchatmessage, getchatmessages, chat batches ×4) · **Services API** (audio↔text, text↔audio, translatetext) · **MQTT User Management** · **REST API Key Management** (generateapikey, deleteapikey) · **Agents Flow Builder API** (activate/deactivate/execute workflow, streamworkflowlogs) · **Reasoning Modes API** (getentitydefinitionpublic) · **Endpoints API** (getallendpointspublic).

### a.2 Chat session creation — VERIFIED-LIVE-DOCS `[ts: 2026-07-25T01:18:10Z]`

```
POST https://api.on-demand.io/chat/v1/sessions
Header: apikey: <YOUR_API_KEY>
```
```json
{ "externalUserId": "<your-user-id>", "pluginIds": ["plugin-…"] }
```
- `externalUserId` **required** (string, your own user key for filtering/audit).
- `pluginIds` optional array, **max 20**; if set here and not overridden per query, applies to every query in the session.
- Success: docs say 200 `{ message, data: ChatSession }`; **the live API returns 201 Created** (REPO-VERIFIED-LIVE, NOTES.md 2026-07-22 pass; `server/ondemand.js:129-131` treats any 2xx as success). Session id at `data.id`.
- **Live quirks (REPO-VERIFIED-LIVE):** intermittent transient `404 "no Route matched"` on session create — an immediate identical retry 201s (`server/ondemand.js:113-121`, bounded 3-attempt retry). An **empty** `apikey` header produces an opaque 500 "unexpected error"; absent → 401 (`server/ondemand.js:135-137` diagnostic hint).
- **agentIds:** the live API also accepts `agentIds[]` on session create; the repo sends `agentIds` exclusively after a 2026-07-19 platform change where query-time `pluginIds` returned HTTP 400 (`server/ondemand.js:107-112`, translation `plugin-…` → `agent-…` at `server/ondemand.js:32`).

### a.3 Query submission ("Use Agent Tools & Submit Query") — VERIFIED-LIVE-DOCS `[ts: 2026-07-25T01:18:30Z]`

```
POST https://api.on-demand.io/chat/v1/sessions/{sessionId}/query
Header: apikey: <YOUR_API_KEY>
```
Required: `query` (string) · `endpointId` (fulfillment model; predefined/BYOI/BYOM) · `responseMode` — enum exactly `["sync","stream","webhook"]`.
Optional (documented): `pluginIds[]` (max 20; **replaces** session-level list for this query), `fulfillmentOnly` (bool — skips RAG/plugins entirely), `modelConfigs` object:

| `modelConfigs` field | Type / range | Notes |
|---|---|---|
| `fulfillmentPrompt` | string | system-prompt channel guiding fulfillment (the repo's system prompts ride here — `server/ondemand.js:179`) |
| `stopSequences` | string[] ≤4 | |
| `temperature` | 0–2, default 0.7 | |
| `topP` | 0–1, default 1 | |
| `presencePenalty` / `frequencyPenalty` | 0–2, default 0 | |

Sync (200) response: `{ message, data: { sessionId, messageId, answer, status: "processing"|"completed"|…, metrics } }`.
**Live-accepted extensions NOT in the documented schema (REPO-VERIFIED-LIVE, NOTES.md 2026-07-20 doc pass):** top-level `reasoningEffort` (`"low"|"medium"|"max"`) is accepted and controls reasoning-token emission; `chatMode` exists but **`chatMode:"plan"` is rejected by the public API ("not supported")** — only `"standard"` works (`server/ondemand.js:175`, `server/ondemand/adapters.js:44-45`). Suffixed model ids (`…-sol-medium`) are HTTP 400 — decomposed `endpointId` + top-level `reasoningEffort` is the working form.

### a.4 Streaming / SSE frame format — thinking vs answer tokens — VERIFIED-WIRE-CAPTURE `[ts: 2026-07-25T01:19:05Z]`

The OpenAPI spec for `submitquery` does **not** document the SSE frame grammar (no `eventType` in the fetched spec — checked this pass). The authoritative shape, from the repo's committed live captures (`debug/sse-samples/apichat-prefix-glm47-max-20260720T2039Z.sse.log`, `apichat-glm47byoi-low-20260720T2100Z.sse.log`, `gpt-5.6-sol-*.sse.log`) and `docs.on-demand.io/docs/chat-api.md` (fetched 2026-07-20T20:35:58Z per NOTES.md):

```
event:thinking
data:{"sessionId":"…","messageId":"…","eventIndex":N,"eventType":"planning_thinking","status":"processing","thinking":{"delta":"…"}}

data:{"sessionId":"…","messageId":"…","answer":"The","status":"processing","eventIndex":2,"eventType":"fulfillment"}

data:[DONE]
```

| eventType | Channel | Payload field | Meaning |
|---|---|---|---|
| `planning_thinking` | thinking | `.thinking.delta` | action-planner reasoning deltas (pre-plugin phase) |
| `planning_output` | internal | `.output.delta` | internal plan JSON assembling (debug only) |
| `step_thinking` | thinking | `.thinking.delta` | per-step reasoning |
| `step_output` | tool call | `.output.delta` | plugin-invocation JSON streaming in deltas — assembles `{"plugins":[{pluginId,name,api_request_parameters,…}]}` |
| `fulfillment_thinking` | thinking | `.thinking.delta` | fulfillment-phase reasoning (GLM 4.7 emits these; gpt-5.6-sol emits thinking in planning/step phases instead — model-dependent) |
| `fulfillment` | **answer** | `.answer` | the actual answer tokens, incremental deltas with monotonic `eventIndex` |
| `statusLog` | status | `.currentStatusLog.statusMessage`/`statusType` (e.g. `fulfillment_completed`) | lifecycle status |
| `metricsLog` | metrics | `.publicMetrics` | usage metrics |
| *(none)* | heartbeat | `{sessionId,messageId,time}` | keep-alive, no eventType |
| terminal | — | `data:[DONE]` | stream end sentinel |

**Key operational fact `[ts: 2026-07-25T01:19:20Z]`:** thinking vs answer separation is by `eventType` + field (`thinking.delta` vs `answer`), *not* by SSE `event:` name alone. Reasoning volume is endpoint/effort-dependent: GLM 4.7 BYOI at `max` produced 321 thinking frames vs 9 late coarse answer frames (the captured "thinking streams, answer doesn't" bug); `low` effort yields token-by-token `fulfillment` deltas.

### a.5 Agent-tools & plugin discovery — VERIFIED-LIVE-DOCS + REPO-VERIFIED-LIVE `[ts: 2026-07-25T01:19:40Z]`

- Agents/plugins attach at session create (`pluginIds`/`agentIds`) or per query (`pluginIds` documented; repo uses `agentIds` after the 2026-07-19 400 regression). RAG plugin execution surfaces on the stream as `step_output` plugin-call frames.
- Plugin/connector listing (used by the repo's connector menu): `GET /plugin/v1/list?v2=1&limit=&page=&scope=&authType=OAUTH` (`server/ondemand.js:408-421`), plus OAuth init/complete/unsubscribe plugin-configuration endpoints (`server/ondemand.js:349-407`). These are gateway endpoints observed working live; they are **not** in the public docs categories fetched this pass.
- Endpoint registry: `GET /config/v1/public/endpoints` (VERIFIED-LIVE-DOCS) — the repo pins GLM 4.7 BYOI `byoi-6e314690-4eaf-4def-a33c-380809acf1f5` (active, `zai-glm-4.7`, ctx 65k) and knows `predefined-glm-4.7`/`-flash` are **inactive** registry entries (`server/oda/models.js:58-67`). Reasoning modes: `GET /config/v1/public/entity_definition` (VERIFIED-LIVE-DOCS).

### a.6 Skill / plugin-bundle structure & orchestration patterns (per installed skills + bundle docs) `[ts: 2026-07-25T01:20:05Z]`

- **Skill structure:** a skill = `SKILL.md` (trigger-dense frontmatter + instructions) + `references/*.md` (e.g. `full-mode.md`, step files) + `scripts/` helpers + shared contracts (`trinity.md`, `harmonization.md`, `output-contracts.md`). Self-containment rule: a skill never reaches into a sibling's folder (MIGRATION_MAP.md §1.4).
- **Orchestration pattern:** one orchestrator (`oda`) decomposes a request, routes to exactly the right worker(s) with a one-line brief + `mode:` hint, inserts mandatory EXTRACT stages for external figures (no-invent), verifies returns (Trinity: Thinker → Worker → Verifier, ≤2 REVISE then ESCALATE), synthesises one answer. The native port drives this as a pipeline graph with per-node OnDemand sessions reused as model context (`server/oda/orchestrator.js:148` `ensureSession`).
- **FAST/FULL contract:** mode decided once at entry; FULL loads gates/verification; FAST is single-pass and must never emit the FULL-gate trigger phrase ("Continue to Step").

---

## (b) Dependency & endpoint map

### b.1 Repo topology `[ts: 2026-07-25T01:21:00Z]`

Two independent frontend surfaces share one Express backend (single deploy unit, `api/index.js` re-exports `server/index.js` for Vercel serverless):

```
src/App.jsx  (suite home, "/")            src/oda/* (ODA Workspace, "/oda")
  ├─ components/{Sidebar,Composer,           ├─ OdaWorkspace.jsx (shell)
  │   Messages,PreviewPane,DebugDrawer,      ├─ OdaSidebar.jsx (left rail: composer,
  │   ConnectorsMenu,…}                      │   history, Lang/Output/Depth/Brain)
  ├─ api.js  (jget/jpost + streamChat        ├─ Canvas.jsx → stageMap.js → stages/* (15 stages)
  │   SSE reader, debug bus)                 ├─ ArtifactRail.jsx (right rail: Active skill /
  ├─ markdown.jsx (dissect: ```options       │   Pipeline / Verified sources / Assumptions /
  │   + ```trace extraction)                 │   Open decisions / Deliverables / Verification)
  └─ intel/, msm/, correlation/, voice/,     ├─ GateCard.jsx + WidgetCard.jsx
     world/ (sibling modules)                └─ useOdaRun.js (SSE state hook, replay-safe)
```

**`./oda-plugin/` reference bundle — ABSENT from the repo at e66b67b** `[ts: 2026-07-25T01:22:30Z]`: `git ls-tree -r HEAD` contains zero `oda-plugin/` paths. It is referenced by `ARCHITECTURE.md:48` ("blueprint bundle at `./oda-plugin/`") and `MIGRATION_MAP.md:5` ("Source bundle: `oda-plugin/` v1.6.0-merged"), and its knowledge is **ported inline**: `server/prompts.js:1` ("mirroring ./oda-plugin orchestrator + worker SKILL.md contracts"), `server/oda/contextLoader.js` (per-skill core contracts), `server/oda/manifests.js` (8 skill manifests), `server/countryData.js:11` (country-data bundle port). The bundle files themselves (SKILL.md, harmonization.md, trinity.md, full-mode.md, output-contracts.md, discipline-chrome.md, progress-widget.md, templates.md, styles.css) live in the platform's uploaded-file directory (confirmed by this run's pre-executed file-directory search results). **Bundle lineage (1 orchestrator + 8 workers):** `oda` + `design`, `summary`→storyline SUMMARY route, `problem-solve`, `benchmark`, `translate`, `media`, `action-titles`→storyline TITLES route, `country-data`→`data-scout` (MIGRATION_MAP.md §1.1–1.3). The suite-home backend keeps the 8 legacy feature ids verbatim (`server/prompts.js` WORKER_PROMPTS: design, summary, problem-solve, benchmark, translate, media, action-titles, country-data, chat).

### b.2 Frontend → backend route map `[ts: 2026-07-25T01:24:00Z]`

**Suite home (`src/App.jsx` + `src/api.js`):**

| UI action | Component / line | Backend route (`server/index.js`) |
|---|---|---|
| list/create/load conversations | `App.jsx:116-118 refreshConvs · :212 newChat · :202 loadConversation` | `GET/POST /api/conversations` (:77,:79), `GET /api/conversations/:id` (:84) |
| send message (SSE) | `App.jsx:236 send` → `api.js:157 streamChat` | `POST /api/chat` (:175) — SSE stream |
| upload attachment | `Composer.jsx` → `api.js:102 uploadFile` | `POST /api/upload` (:91) |
| connectors menu / OAuth | `api.js:42-69` | `GET /api/connectors` (:106), `POST /api/connectors/oauth/init` (:124), `DELETE /api/connectors/:id/unsubscribe` (:139), `POST /api/connectors/oauth/complete` (:152) |
| export artifact | `App.jsx:440 doExport` | `POST /api/export` (:398), `GET /api/export/:id/download` (:419) |
| country data (intel) | `src/intel/api.js` | `GET /api/country-data/:query` (:165) + intel/msm/correlation routers |
| health | — | `GET /api/health` (:72) |

**ODA Workspace (`src/oda/*` → `server/oda/routes.js`, mounted `/api/oda` at `server/index.js:68`):**

| UI action | Component / line | Backend route (`server/oda/routes.js`) |
|---|---|---|
| start run | `useOdaRun.js:208-220 start` | `POST /runs` (:81) → `startRun` fired async (:102) |
| run history | `OdaWorkspace.jsx:29-35` | `GET /runs` (:106) |
| rehydrate run | `useOdaRun.js:195-205 attach` | `GET /runs/:id` (:108) |
| live events (SSE) | `useOdaRun.js:169-192 listen` | `GET /runs/:id/events?since=` (:125) — named events, seq replay |
| resolve gate (follow-up answer) | `GateCard.jsx:68 → useOdaRun.js:233-246 resolveGate` | `POST /runs/:id/gates/:gateId` (:140) → `resolveGateAndContinue` |
| pause/resume/cancel | `OdaSidebar.jsx:213-231 → useOdaRun.js:248 lifecycle` | `POST /runs/:id/{pause,resume,cancel}` (:156,:163,:175) |
| node retry / return | — (retry re-runs whole request: `useOdaRun.js:226`) | `POST /runs/:id/nodes/:nodeId/{retry,return}` (:182,:189) |
| artifact fetch / materialize / download | `Canvas.jsx:56-63`, `StageGallery`, `downloadFinalDoc.js` | `GET /runs/:id/artifacts/:artifactId` (:203), `POST …/materialize` (:231), `GET /runs/:id/download` (:315), `GET /files/:name` (:370) |
| live widget | `OdaWorkspace.jsx:44-48` → `WidgetCard.jsx:72` | `POST /widgets/stream` (:400) |
| brains list / builders / registry / interpret | `OdaSidebar` Brain select; debug | `GET /brains` (:390), `GET /builders` (:409), `GET /registry(/:id)` (:28,:42), `POST /interpret(/heuristic)` (:63,:71) |

### b.3 Backend → OnDemand API / plugin map `[ts: 2026-07-25T01:26:00Z]`

| Backend call site | OnDemand endpoint | Purpose |
|---|---|---|
| `server/ondemand.js:105 createOdSession` | `POST /chat/v1/sessions` (body `externalUserId` + `agentIds`) | per-conversation & per-run session (suite: `server/index.js:259`; ODA: `orchestrator.js:148`; router: `router.js:9`) |
| `server/ondemand.js:164 streamQuery` | `POST /chat/v1/sessions/{id}/query` `responseMode:"stream"`, `chatMode:"standard"`, `reasoningEffort`, `modelConfigs.fulfillmentPrompt` | all streaming answers; **pure passthrough** of raw frames to the browser (`server/index.js:331-346 sendRaw`) |
| `server/ondemand.js:318 syncQuery` | same, `responseMode:"sync"` | router classification (`router.js:44`), ODA interpreter/workers via `server/ondemand/adapters.js` |
| `server/ondemand.js:349/388/369` | plugin OAuth init/complete/unsubscribe | connectors |
| `server/ondemand.js:408 listClientPlugins` | `GET /plugin/v1/list` | connectors menu |

**Adopted plugin registry (`server/plugins.js:5-16`)** — Internet `plugin-1713924030`, Perplexity `plugin-1722260873`, GPT Search `plugin-1741871229`, Tavily `plugin-1740745780`, Web Extractor `plugin-1737365406`, File Directory `plugin-1743257072`, MD→PDF `plugin-1739264368`, HTML→DOCX `plugin-1759408928`, GPT Image 2 `plugin-1776826082`, OnDemand Agent `plugin-1775547203`. Feature→plugin map at `server/plugins.js:21-31` (translate/action-titles deliberately LLM-direct). `[ts: 2026-07-25T01:26:20Z]`

**Model policy** `[ts: 2026-07-25T01:26:45Z]`: suite chat default = GLM 4.7 Cerebras BYOI `byoi-6e314690-4eaf-4def-a33c-380809acf1f5` + `reasoningEffort` default **low** (`server/env.js:52,66-67`); ODA workspace brains kimi3/sonnet-5/opus-4.8/fable (`OdaSidebar.jsx:193-198`, `server/oda/models.js:53`); final document authoring locked to opus-4.8 (`server/oda/models.js:417-422`). ⚠️ UI hint at `App.jsx:563` still says "max reasoning" — stale label vs env default `low`.

### b.4 Quick/Full (FAST/FULL) mode logic — both surfaces `[ts: 2026-07-25T01:28:00Z]`

- **Suite home:** `server/router.js` classifies feature + mode (LLM primary `router.js:37-58`; heuristic fallback `router.js:25-35` — FULL on chairman/board/presidential/campaign/3+-slide-deck phrasing at :29-31). Wizard forces FULL (`server/index.js:237`). FULL-mode worker contract: *"END your reply after the current step with ONE clear question offering 2–4 tappable options"* (`server/prompts.js:50`); wizard steps mandate ```` ```options ```` blocks (`server/prompts.js:77-86`).
- **ODA workspace:** Depth select fast/full (`OdaSidebar.jsx:184-190`, default `full` at :22) is appended to the request as **prose** (`OdaWorkspace.jsx:55`); GLM interpreter independently decides `mode` (`interpreter.js:57` — full only for chairman/board/multi-skill/3+-slide phrasing) and `requires_user_gate` (:58, default `mode==='full'` at :171). `enforceOutputClass` (`interpreter.js:262`) hard-collapses `fast` pipelines to ONE terminal node (document :290-298; deck :313 single `design` node) and keeps multi-node chains only in `full` (:307-312). Verification runs only when `node.mode==='full'` (`orchestrator.js:474-477`, env-overridable `ODA_VERIFY`).

### b.5 The "12-step benchmark pipeline" claim — discrepancy `[ts: 2026-07-25T01:29:30Z]`

The commit subject advertises a "12-step benchmark pipeline". **No 12-step pipeline exists anywhere in the tree** (repo-wide grep for `12-step|12 steps|STEP 12|twelve` returns nothing relevant). What actually exists:
- **benchmark** = **five-stage evidence funnel** — scope → longlist (15–20) → shortlist (5–7, user gate in FULL) → parallel case research → synthesis (`server/oda/contextLoader.js:45`; same funnel in `server/prompts.js` benchmark block; MIGRATION_MAP.md §1.2).
- The number 12 appears as the design system's **"Twelve canonical layouts"** (`server/oda/contextLoader.js` design core) and the suite-home UI's 8-step UI spec / 5-step wizard (`server/prompts.js:76 WIZARD_STEPS`). The workspace has 15 canvas stages (`src/oda/stageMap.js:7-23`) and 10 gate types (`server/oda/gates.js:31-42`).
Conclusion: "12-step benchmarking pipeline" is recovered-build marketing language; the enforceable pipeline contracts are the five-stage benchmark funnel + the sequencing edge graph (`server/oda/sequencing.js:40-52`).

### b.6 Right-rail skill/pipeline/sources panels `[ts: 2026-07-25T01:30:10Z]`

`src/oda/ArtifactRail.jsx` sections, all driven by `useOdaRun` state: **Active skill** (:122-134), **Pipeline** (:136-153, per-node status icons), **Verified sources** (:155-172, evidence tags fact/assm/web), **Assumptions** (:174-188), **Open decisions** (:190-202 — gate prompts, see RC-3 below), **Files** (grouped artifacts w/ Download/Preview per version, :204-251), **Verification** (last 3 checks, :253-269), **Run metadata** (:271-280). Collapsed state (:85-93) renders only the expand toggle; `openGates` computed at :105.

---

## (c) Plan Mode root-cause trace — why clicking suggested follow-up questions does nothing

**Scope note** `[ts: 2026-07-25T01:32:00Z]`: "Plan Mode" in this build = the plan-then-execute surfaces: (1) the **ODA Workspace** Depth=Full runs (pipeline plan → approval gates → follow-up question cards = `GateCard`), and (2) the **suite-home FULL/wizard mode** whose replies end with tappable ```` ```options ```` follow-up questions. Upstream `chatMode:"plan"` is rejected by the public API and is NOT used (`server/ondemand.js:175`). Both surfaces were traced end-to-end; six distinct root causes were found, ordered by impact.

### The designed interaction path (as built) `[ts: 2026-07-25T01:33:00Z]`

**ODA Workspace (primary Plan Mode):**
```
question card      src/oda/GateCard.jsx:16 (rendered by Canvas.jsx:91-102 via stages/*, e.g. StageUnderstanding.jsx:78-82)
  → onClick        GateCard.jsx:68-72 (option button) → act() GateCard.jsx:25-31
  → handler        onResolve = resolveGate   (Canvas.jsx:98 ← OdaWorkspace.jsx:100 ← useOdaRun.js:233)
  → state update   useOdaRun.js:240-245 (optimistic gate→approved, status→executing)
  → submission     POST /api/oda/runs/:id/gates/:gateId   (useOdaRun.js:235-238)
  → API payload    {approved: bool, choice: string|null, edits: {text}|null}
  → server         routes.js:140-154 → resolveGateAndContinue orchestrator.js:243-272
  → resume         executePipeline(run) async (:267-270); authoritative state returns on the SSE
                   stream GET /runs/:id/events (question.required / skill.* / run.* frames)
  → rendering      useOdaRun.js reduceEvent:37-127 → Canvas re-renders active stage
```

**Suite home (FULL/wizard options):**
```
question card      Messages.jsx:233-237 (.options block buttons under the assistant message)
  ← extraction     markdown.jsx:9-29 dissect() — ```options fenced block → options[] (max 6)
  → onClick        Messages.jsx:235 → onOption(o)   (wired at App.jsx:544)
  → handler        App.jsx:430-437 onOption — "Export as …" → doExport; else send(optionText)
  → submission     App.jsx:236 send() → POST /api/chat SSE (api.js:157 streamChat)
  → API payload    App.jsx:276-287 {conversationId, text, feature, mode, wizard:{active,step}, pluginIds…}
  → server         server/index.js:175 /api/chat → classify → createOdSession(:259) → streamQuery(:339)
  → rendering      onStreamEvent App.jsx:293-359 (thinking/step_output/fulfillment frames → patchLive)
```

### RC-1 (PRIMARY) — The backend never raises a gate: every follow-up-question card is dead on arrival `[ts: 2026-07-25T01:35:00Z]`

- `server/oda/orchestrator.js:201-218` — the ONLY consumer of `control.requires_user_gate && control.mode === 'full'` was rewritten ("2026-07-23: NEVER PARKS"): it records a system decision *"Scope auto-approved … runs never park on scope confirmation"* (:209) and a non-blocking `skill.progress` notice (:213-217), then proceeds straight to `transition(run,'executing')` (:220). It **never calls `raiseRunGate`**.
- `server/oda/orchestrator.js:230-236 raiseRunGate` and `:44-53 PRE_EXECUTION_GATE` are **exported dead code — zero call sites** (verified by grep this pass; the export at :693 keeps them importable). The second former call site (verifier escalation) is also never-park: `orchestrator.js:554-577` ships the artifact *with* open findings instead of raising `verification_findings`.
- Consequence chain, each link verified: no `raiseRunGate` → `runStore.js:589 addGate` never runs → **`question.required` is never emitted** → `useOdaRun.js:73-78` reducer never fires → `run.gates` stays `[]` → `Canvas.jsx:50` computes `gate = null` → `GateCard.jsx:22 if (!gate) return null` → **no follow-up question card ever renders on any new run**. The entire downstream click path (RC-trace above) is intact but unreachable.
- Compounding: **no clarifying-question content exists to raise.** The interpreter's control JSON schema has no questions field (`server/oda/interpreter.js:41-58` — intent/mode/pipeline/requires_user_gate only) and the worker handoff hardcodes `unresolvedQuestions: []` (`server/oda/orchestrator.js:367`).
- Provenance: gates ported in `d51e489` (2026-07-22T18:35:08Z), disconnected in `664eed6` (2026-07-23T18:08:28Z) per `ROOT_CAUSES.md:91-104`; state at HEAD `e66b67b` re-verified line-by-line this pass. `FUNCTIONALITY_INVENTORY.md` still advertises parking gates — docs contradict code.

### RC-2 — ODA sidebar suggestion chips only set text; they never submit `[ts: 2026-07-25T01:36:30Z]`

- `src/oda/OdaSidebar.jsx:158-162`: `onClick={() => setText(s)}` — the six SUGGESTIONS chips (:7-14) write the suggestion into the composer textarea and **do not call `handleSubmit`** (:66-71). Nothing runs until the user separately clicks "Start run" (:204-206). With the composer low in a long sidebar, the perceived behaviour is exactly "clicking the suggested question does nothing". Contrast: the suite-home CHIPS *do* auto-send (`App.jsx:530-534`).

### RC-3 — Right-rail "Open decisions" rows have no click handler at all `[ts: 2026-07-25T01:37:20Z]`

- `src/oda/ArtifactRail.jsx:195-200`: open gates render as plain `<div className="oda-rail__row oda-rail__row--gate">` with a pill + prompt text — **no `onClick`, no button, no navigation** to the owning canvas/GateCard. On a rehydrated old run that still carries an open gate (possible: the boot orphan sweep `runStore.js:150-165` only fails runs in `ORPHANABLE = {interpreting, planning, executing, verifying, revising}` — `waiting_for_user` **survives** restarts by design), the rail shows a clickable-looking question row that is inert.

### RC-4 — Suite-home chip → send stale-closure bug: duplicate conversation, wizard/plan mode dropped, trailing-space chips truly do nothing `[ts: 2026-07-25T01:38:40Z]`

- `src/App.jsx:530-534`: chip onClick `await newChat(c.feature,{wizard})` then `send(c.text, null, null, {feature: c.feature})`. `newChat` sets `activeId` via `setActiveId` (:216) — an async React state update. The already-executing closure still holds the **old** `send`, whose `activeId` is stale `null`; `send` therefore runs `if (!convId) convId = await newChat(pendingTool || 'chat')` (:237-238) with **stale `pendingTool` (null) and stale `wizard` (inactive)** — creating a **second** conversation of feature `'chat'` and building the payload with `wizard: undefined` (:281-283). Net effect: two conversations created per chip click, the message lands in the second, and the guided plan flow (wizard) never engages for the `design` chip (`wizard:true` at :23) — the wizard pane (`PreviewPane.jsx:54 if (!wizard?.active) return null`) stays closed. The payload's `feature` survives only because `extra.feature` is read first (:280).
- Worse for the two trailing-space chips ('Translate for the Chairman: ', 'Title these slides: ') — `if (!c.text.endsWith(' '))` skips `send` entirely **and nothing prefills the composer** (no `setComposePrefill` call): click → blank new chat → literally nothing visible happens.

### RC-5 — No mid-run message channel: typed follow-up answers fork a new run instead of answering the plan `[ts: 2026-07-25T01:39:50Z]`

- Every ODA composer submission is a **new run**: `OdaSidebar.jsx:66-71 handleSubmit` → `OdaWorkspace.jsx:41-60 onSubmit` → `useOdaRun.js:208-220 start` → `POST /api/oda/runs`. `server/oda/routes.js` exposes **no** `POST /runs/:id/message` or any follow-up-text route; the only mid-run input is gate resolution (:140-154) — which RC-1 makes unreachable. Submitting while a run streams silently abandons the old SSE subscription (`listen` closes the prior EventSource, `useOdaRun.js:169-171`). So even a user who *types* an answer to an on-screen question gets a forked fresh pipeline, not a continuation (matches `ROOT_CAUSES.md` Problem 5).

### RC-6 — Depth=Full is a soft prompt hint, so Plan Mode often isn't even planned as full `[ts: 2026-07-25T01:40:40Z]`

- `OdaWorkspace.jsx:53-56` appends `"Depth: full engagement with approval gates"` as **prose** to the request text; `POST /api/oda/runs` (`routes.js:81-104`) carries no structured depth field. The interpreter's own rules (`interpreter.js:57`) mark `full` only for chairman/board/multi-skill/3+-slide phrasing, so GLM frequently returns `mode:"fast"` → `requires_user_gate:false` (:171) → `enforceOutputClass` collapses the pipeline to a single node (:290-298, :313). Even if RC-1 were fixed, most "Full" runs would still classify fast and raise no questions.

### Secondary latent defects on the suite-home options path (working today, fragile) `[ts: 2026-07-25T01:41:30Z]`

- **No re-entrancy guard:** options buttons are never disabled while `busy` (`Messages.jsx:233-237` has no `busy` prop; `send` at `App.jsx:236` has no in-flight check) — clicking an option from an *earlier* message mid-stream starts a second overlapping stream; both write through `liveMsgRef` (:251-254), corrupting the live message.
- **Options only exist if the model complied:** `dissect` (`markdown.jsx:14-18`) extracts only a closed ```` ```options ```` fence; a model that ends without the fence produces zero clickable follow-ups (contract lives only in prompts `server/prompts.js:50,77-86`).
- **Wizard step advance is success-coupled:** `App.jsx:390` advances `wizard.step` only after a clean stream; a retried/errored turn leaves the step behind the conversation content.
- **Stale model label:** `App.jsx:563` advertises "max reasoning" while `server/env.js:67` defaults `low` — cosmetic but misleading during debugging.

**Root-cause summary** `[ts: 2026-07-25T01:42:10Z]`: the click plumbing (GateCard → resolveGate → POST gates → resolveGateAndContinue, and options → onOption → send) is correctly wired end-to-end; clicks "do nothing" because (RC-1) the server stopped raising the questions the cards depend on — with no clarifying-question content generated anywhere (`unresolvedQuestions: []` hardcoded), (RC-2) the workspace's visible "suggested question" chips only fill a textarea, (RC-3) the rail's question rows are non-interactive, (RC-4) the home chips self-destruct their own plan mode via a stale closure (and two chips genuinely no-op), (RC-5) any typed answer forks a new run, and (RC-6) Full depth usually never reaches the interpreter as full.

---

## (d) Prioritized fix plan

| P | Fix | Where (exact) | Notes | Stamp |
|---|---|---|---|---|
| **P0-1** | Re-connect gate raising for Full mode: restore the `raiseRunGate(run, PRE_EXECUTION_GATE[skill])` call under `control.requires_user_gate && control.mode==='full'`; gate the never-park behaviour behind an env flag (e.g. `ODA_NEVER_PARK=1` keeps today's auto-approve) | `server/oda/orchestrator.js:201-218` (+ dead code :44-53, :230-236 becomes live again); optionally verifier escalation `:554-577` | Single highest-leverage change: makes `question.required` flow again → GateCard renders → existing click path works unchanged (`routes.js:140-154`, `useOdaRun.js:233-246` need no edits) | `[ts: 2026-07-25T01:44:00Z]` |
| **P0-2** | Generate real clarifying questions: add `clarifying_questions[]` to the interpreter control JSON (prompt + normaliser), surface them via a `scope_edit`/new gate with `options` populated; stop hardcoding `unresolvedQuestions: []` — thread gate answers into the handoff | `server/oda/interpreter.js:41-58` (schema), `:136-171` (normalise), `server/oda/orchestrator.js:367` (handoff), `server/oda/gates.js:31-42` (type) | Without content, P0-1 raises only generic scope confirms | `[ts: 2026-07-25T01:44:40Z]` |
| **P0-3** | Make workspace suggestion chips submit: `onClick={() => { setText(s); onSubmit?.({ text: composeText(s, c), files }); }}` (or auto-focus + visible Start pulse) | `src/oda/OdaSidebar.jsx:158-162` | Kills the most-reported "click does nothing" surface immediately; zero backend risk | `[ts: 2026-07-25T01:45:10Z]` |
| **P1-4** | Fix the suite-home chip stale closure: have `newChat` return the id and pass it through — `const id = await newChat(...); send(c.text, null, null, {feature: c.feature, convId: id, wizard: Boolean(c.wizard)})`; make `send` accept `extra.convId` before falling back to `activeId`; for trailing-space chips call `setComposePrefill({text: c.text, ts: Date.now()})` instead of skipping silently | `src/App.jsx:236-238` (send), `:530-534` (chips), `Composer.jsx:10-18` already supports prefill | Restores wizard/plan engagement from chips; eliminates duplicate conversations | `[ts: 2026-07-25T01:45:50Z]` |
| **P1-5** | Make rail "Open decisions" rows interactive: wrap in `<button>` that scrolls/switches the canvas to the gate's stage (stage from `stageMap.js:52-71`) and focuses GateCard | `src/oda/ArtifactRail.jsx:195-200` | A11y: rows currently look actionable | `[ts: 2026-07-25T01:46:20Z]` |
| **P1-6** | Make Depth authoritative: send `depth` as a structured field in `POST /api/oda/runs`; `interpret()` receives it and overrides GLM's `mode` (full wins over the heuristic); keep the prose hint for model context only | `src/oda/OdaWorkspace.jsx:41-60`, `src/oda/useOdaRun.js:208-213`, `server/oda/routes.js:81-104`, `server/oda/interpreter.js:136-171` | Prevents Full runs silently collapsing to fast single-node pipelines (`interpreter.js:290-298`) | `[ts: 2026-07-25T01:46:55Z]` |
| **P1-7** | Add a mid-run message channel: `POST /api/oda/runs/:id/message` that (a) answers the open gate when one exists, else (b) records the text as a run assumption/context for the next node; UI: workspace composer targets the ACTIVE run when `status==='waiting_for_user'` instead of forking | `server/oda/routes.js` (new route), `server/oda/orchestrator.js` (context injection), `src/oda/OdaWorkspace.jsx:41-60` | Direct fix for ROOT_CAUSES Problem 5; sequencing after P0-1/P0-2 | `[ts: 2026-07-25T01:47:30Z]` |
| **P2-8** | Guard options re-entrancy: pass `busy` into `AssistantMessage` and disable `.options button` while streaming; add an in-flight early-return to `send` | `src/components/Messages.jsx:233-237`, `src/App.jsx:236,544` | Prevents interleaved double-streams | `[ts: 2026-07-25T01:48:00Z]` |
| **P2-9** | Truth-align docs & labels: fix `FUNCTIONALITY_INVENTORY.md` (gates currently never park), correct the `App.jsx:563` "max reasoning" hint, and rename the commit-message "12-step benchmark pipeline" claim to the real five-stage funnel in README/ARCHITECTURE | `FUNCTIONALITY_INVENTORY.md`, `src/App.jsx:563`, `ARCHITECTURE.md` | Removes the doc/code contradictions found in (b.5)/(c) | `[ts: 2026-07-25T01:48:30Z]` |
| **P2-10** | Post-fix verification pack: e2e that (1) Full run raises ≥1 `question.required`, (2) GateCard click → 200 → `skill.started` resumes on the same runId, (3) suite chip click creates exactly ONE conversation with wizard active, (4) options click during busy is inert | new `tests/` cases beside `test/`, wire into `npm test` | Acceptance criteria for P0/P1 items | `[ts: 2026-07-25T01:49:00Z]` |

**Sequencing rationale** `[ts: 2026-07-25T01:49:30Z]`: P0-1+P0-2 restore the feature the UI was built for (server-side, isolated to orchestrator/interpreter); P0-3/P1-4/P1-5 are independent low-risk frontend fixes; P1-6/P1-7 change API shape (do together, version the run-create body); P2 items are hygiene. Nothing in P0–P1 requires touching the OnDemand wire layer (`server/ondemand.js`) — the platform contract (§a) already supports everything needed.

---

*End of audit. Analysis-only pass — no code or docs other than this AUDIT.md were touched; nothing was committed or pushed.* `[ts: 2026-07-25T02:18:00Z]`
