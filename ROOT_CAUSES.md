# ROOT_CAUSES.md — ODA Workspace Deep Architecture Inspection

**Repository:** `navnit28/ondemand-hq` · **Default branch:** `main` @ `3b306bb` (2026-07-25 00:23:40 +0530, "Merge pull request #5 from navnit28/release-24062026")
**Inspection date:** 2026-07-24 · **Inspector:** automated deep-trace over actual source files at HEAD of `main`.

**Branch inventory** (from `git remote show origin` / `git branch -a`):

| Branch | Tip commit | Timestamp | Subject |
|---|---|---|---|
| `main` (default, HEAD) | `3b306bb` | 2026-07-25 00:23:40 +0530 | Merge PR #5 from release-24062026 |
| `release-24062026` | `d91efe7` | 2026-07-25 00:22:20 +0530 | added log level fixes |
| `feat/connectors` | `5636d10` | 2026-07-24 19:25:16 +0530 | resolved merge conflict |
| `checkpoint/correlation-engine-fixes` | `8471f9f` | 2026-07-22 09:41:07 +0530 | Merge origin/main into checkpoint |
| `checkpoint-correlation-v2` | `8006aaa` | 2026-07-20 12:36:42 +0530 | fix(vercel): serverless-safe data dirs |

**End-to-end workflow (as implemented):**
`POST /api/oda/runs` (`server/oda/routes.js:81-104`, fire-and-forget `startRun` at line 102) → `startRun` (`server/oda/orchestrator.js:160-227`): GLM-4.7 interpret (`interpreter.js:336-361`) → `validatePipeline` (`sequencing.js:191-298`) → auto-approved scope "gate" (`orchestrator.js:206-217`) → `executePipeline` loop (`orchestrator.js:292-330`) → per node: handoff (`handoff.js:37-85`) + context bundle (`contextLoader.js:98-143`) → streamed authoring w/ Cerebras digest feed (`liveStream.js:66-219`) → verify/revise loop (`orchestrator.js:465-629`, `verifier.js`) → `completeRun` (`orchestrator.js:632-677`): synthesis + `packageRunArtifact` (`autoArtifact.js:39-186`) → hosted doc via OnDemand Agent plugin (`pluginDoc.js:49-109`) → SSE fan-out (`events.js:74-112`, subscribe 112-167) → frontend `useOdaRun.js` reducer → `Canvas.jsx`/`stageMap.js` → `StageLiveDeck.jsx` four cards → download via `downloadFinalDoc.js` + `/runs/:id/download` proxy (`routes.js`). Persistence: JSON write-through per mutation (`runStore.js:67-110`) into `ODA_DATA_DIR` (`server/paths.js:23-28` — **`/tmp`, per-instance, on Vercel**).

---

## Problem 1 — Evidence and Analysis stages are skipped before Recommendations

**Root cause (three compounding mechanisms, all in code):**

1. **Single-node pipelines are the systemic default, so no evidence/analysis node ever exists.**
   - `server/oda/interpreter.js:66-93` — `heuristicInterpret()` always returns a **one-node pipeline** (`pipeline: [node]`, line 80-86). It is the fallback whenever GLM output fails to parse (`interpreter.js:353-355`) or the call throws (`interpreter.js:357-360`).
   - `server/oda/interpreter.js:157-163` — `normaliseControl()` throws away any multi-node GLM pipeline that violates edge rules and **falls back to a single node** on the primary skill ("Illegal graph from the interpreter → single-node fallback").
   - `server/oda/interpreter.js:290-293` (`enforceOutputClass`, added in `88bf693`, 2026-07-25 00:20:22 +0530) — for Output=document + Depth=fast, the pipeline is **hard-collapsed to one terminal node**: `c.pipeline = [{ nodeId: 'n1', skill: t?.skill ... }]`. Any `data-scout` (Evidence) or upstream `problem-solve` (Analysis) node the interpreter had planned is deleted. Same collapse for decks at lines 310-312 (`fast` → single `design` node). Because `OdaSidebar.jsx` defaults `depth: 'full'` but `interpreter.js:57` only sets `mode: "full"` for chairman/board/multi-skill phrasing, the GLM frequently returns `mode:"fast"`, triggering the collapse even when the UI said Full (the "Depth: full engagement with approval gates" string appended in `OdaWorkspace.jsx:55` is a soft prompt hint, not an enforced field).
   With a single `design`/`problem-solve`/`storyline` node, the run jumps straight from interpretation to the terminal deliverable — Evidence (data-scout) and Analysis (problem-solve) never run, yet card 04 "Recommendations & next steps" still fills (see 3).

2. **The Evidence card is driven by a regex that near-never matches.**
   - `server/oda/orchestrator.js:433` — evidence is extracted from drafts via `/\*\*(?:tagged )?fact\*\*[:\s—-]*(...)/gi`; the codebase itself admits this "virtually never matched" (`server/oda/liveStream.js:30-33`: *"Previously slide 2 only filled via a '**fact**' marker regex on the final draft that virtually never matched, so card 02 sat in 'Queued' with skeleton bars for the whole run"*). The 2026-07-23 fix (`664eed6`) pipes Cerebras digest `evidence` into slide 2 (`liveStream.js:106-118`), but only **while a stream is running** and only if the digest JSON parses; when authoring falls back to the non-streaming `brainCall` path (`orchestrator.js:411-421`) slide 2 receives nothing at all.
   - `server/oda/liveDeck.js:204-212` (`onRunCompleted`) then **stamps the empty Evidence card "final"**: `patchSlide(2, { title: 'No external evidence required', status: 'final' })` — visually confirming that Evidence "completed" (or was deemed unnecessary) without any evidence stage having run.

3. **Recommendations render before/without analysis by design of the slide director.**
   - `server/oda/liveDeck.js:115-123` — `onPipelineSelected` fills slide 4 ("Recommendations & next steps") **at planning time** with the pipeline preview.
   - `server/oda/liveDeck.js:168-175` — `onArtifactPreview` patches slide 4 with GLM-condensed "recommendations" from the **first draft artifact of any node**, so Recommendations content appears while (or before) any analysis node would run.

**Timestamps:** single-node fallbacks since `d51e489` (2026-07-22 18:35:08 +0000, Phases 1+2 port); fast-collapse `enforceOutputClass` in `88bf693` (2026-07-25 00:20:22 +0530); evidence regex admission + digest patch in `664eed6` (2026-07-23 18:08:28 +0000).

**Impact:** deliverables are authored with no gathered evidence and no structured analysis; the four cards mislead the user into believing Understanding → Evidence → Findings → Recommendations executed in order, when typically only one authoring node ran.

---

## Problem 2 — Benchmarking starts before problem definition/analysis completes

**Root cause:**

1. **The sequencing graph has no `problem-solve → benchmark` edge, so benchmark can never be made dependent on problem definition.**
   `server/oda/sequencing.js:38-51` (`CORE_EDGES`) contains `['benchmark', 'problem-solve']` and `['benchmark', 'storyline']` but **no** `['problem-solve', 'benchmark']`. Any GLM-planned pipeline where benchmark `dependsOn` a problem-solve node fails check (4) in `validatePipeline` (`sequencing.js:262-276` — "Edge ... is not an allowed pipeline transition") and is **discarded to a single-node fallback** (`interpreter.js:157-163`). Structurally, benchmark can only ever run **before** problem-solve, never after it.

2. **The interpreter is explicitly instructed to run benchmarking first.**
   `server/oda/interpreter.js:52` (system prompt): *"Both wanted → benchmark then problem-solve"*, and line 56 declares legal downstream edges `benchmark→problem-solve`. So even a legal multi-node plan puts `benchmark` at depth 0.

3. **Depth-0 nodes start in parallel with no gate in front of them.**
   `server/oda/orchestrator.js:311-314` — `executePipeline` runs **all** runnable nodes concurrently: `await Promise.allSettled(runnable.map((node) => executeNode(run, node)))`. `nextRunnableNodes` (`sequencing.js:333-353`) returns every queued node with zero dependencies, so a root `benchmark` node starts immediately at pipeline start.

4. **The gate that used to hold execution until the problem definition was confirmed was deleted.**
   Commit `664eed6` (2026-07-23 18:08:28 +0000, "never-park gating") removed the `await raiseRunGate(run, { gateType: PRE_EXECUTION_GATE[control.primary_skill] ... })` call from `startRun` and replaced it with an auto-approval decision (`orchestrator.js:206-217`: "Scope auto-approved … runs never park on scope confirmation"). `PRE_EXECUTION_GATE` (`orchestrator.js:44-53`, mapping `'problem-solve' → 'problem_definition'`, `benchmark → 'scope_edit'`) and `raiseRunGate` (`orchestrator.js:230-236`) are now **dead code** — grep shows no remaining call site. Nothing ever waits for "problem definition" before benchmark executes.

**Timestamps:** edge graph unchanged since `d51e489` (2026-07-22 18:35:08 +0000); gate removal in `664eed6` (2026-07-23 18:08:28 +0000).

**Impact:** benchmarking briefs are built from `run.request.text` only (`orchestrator.js:362`: `objective: node.objective || run.intent || run.request.text`) with `verifiedFacts` drawn from an evidence array that is empty at depth 0 (`orchestrator.js:365`) — benchmark output cannot be scoped by a confirmed problem definition.

---

## Problem 3 — Workflows run 30+ minutes without terminating

**Verdict on the listed hypotheses, from code:** the cause is **(a) unbounded upstream inference calls (no timeout) × (b) layered retries × (c) a long strictly-sequential tail during completion × (d) serverless termination that strands runs in non-terminal states** — NOT frontend polling loops, NOT worker-queue starvation (there is no queue), NOT unbounded revise loops (bounded at 2), NOT artifact rendering on the client.

**Exact mechanisms:**

1. **`syncQuery` has no timeout at all.** `server/ondemand.js:318-346` — the POST to `/chat/v1/sessions/:id/query` with `responseMode: 'sync'` passes **no `AbortSignal`** (grep for `AbortSignal.timeout` in this function: none). One hung upstream fulfillment = one forever-hung node. Every non-streamed call rides this: interpreter, brainCall, verifier `workerCall`, revision authoring, synthesis, and the **final hosted-document plugin call** (`pluginDoc.js:94`), which the code itself expects to take "~30–60s" (`orchestrator.js:654-656`) and which is invoked with the plugin needing to author + host a full PPTX/PDF. Only `streamQuery` has protection (90s inactivity watchdog, `server/ondemand.js:263-269`).

2. **Retry multiplication.** Each `syncQuery` = `odFetchAuthRetry` (up to 3 auth attempts, `ondemand.js:80-86`) × `odFetch` (4 total attempts w/ backoff on 5xx/network, `ondemand.js:48-67`) ⇒ **up to 12 HTTP attempts per logical call**. Node authoring adds its own ladder (`orchestrator.js:406-421`): stream attempt → sync fallback → 5s-spaced second sync fallback ⇒ 3 logical calls × 12 = up to 36 upstream attempts for a single stubborn node, each attempt itself unbounded in duration (no timeout).

3. **Per-node cost is 2–7 model calls even when healthy.** Draft (1) + verifier (1, FULL mode: `orchestrator.js:474-476`, `verifyOn = node.mode === 'full'`) + up to 2 revise rounds × (revision authoring per defect group + re-verify) bounded by `REVISE_POLICY.maxReviseLoops: 2` (`verifier.js:361-369`). The `for (let round = 0; ; round++)` at `orchestrator.js:492` is bounded by `shouldEscalate(round + 1)` at line 554 — it is not the runaway itself, but it multiplies the untimed calls in (1).

4. **A long, strictly sequential completion tail.** `completeRun` (`orchestrator.js:632-677`) runs **in series**: synthesis `brainCall` (untimed) → `packageRunArtifact` → image enrichment with a 75s budget (`imageSource.js:35` `ENRICH_BUDGET_MS = 75000`, Perplexity + GPT-Image-2 calls inside) → hosted-doc plugin `syncQuery` (untimed, the documented 30–60s+ call) → URL validation (2×15s fetch timeouts, `pluginDoc.js:29-33`) → on failure, full local builder fallback. Live-feed digests add a hard join before verification: `await Promise.allSettled(inflight)` (`liveStream.js:210`) waits for **every** Cerebras digest call (each an untimed `interpreterCall`), throttled to 4 concurrent (`liveStream.js:125`); a 5-chunk-per-call stall extends the node linearly.

5. **Serverless execution model guarantees stranded "running" workflows.** `routes.js:102` fires `startRun(run)` **fire-and-forget after `res.status(201)`** — on Vercel there is no `waitUntil` anywhere (grep: none), so the platform may freeze/kill the lambda after the response; `vercel.json:7` caps any surviving invocation at `maxDuration: 300` (raised from 60 in `b83334b`, 2026-07-24 10:03:13 +0530 — itself evidence of runs outliving 60s). A killed engine leaves `run.status = 'executing'` in `/tmp` state. The **orphan sweep runs only at module load** (`runStore.js:150-165`, at cold boot of a *new instance reading the same /tmp*, which per `paths.js:23-28` is per-instance anyway) — there is **no runtime watchdog, no heartbeat, no lease expiry**, so from the UI the run shows "Executing" indefinitely: 30+ minutes of apparent non-termination with no terminal state ever reached. `resumeEngine` (`orchestrator.js:683-691`) exists but is only invoked by a manual `POST /runs/:id/resume` (`routes.js:163-171`).

**Not guilty (checked):** frontend has no polling loop (SSE only, `useOdaRun.js:169-192`; `EventSource` auto-reconnect); the only frontend timer is a cosmetic message rotator (`WidgetCard.jsx:60`); no worker/queue layer exists at all (execution is in-process promises); context construction is capped (`contextLoader.js` clips at 16k/8k/3k chars; verifier truncates at 24k, `verifier.js:88-97`).

**Timestamps:** untimed `syncQuery`/retry stack `d91efe7` (2026-07-25 00:22:20 +0530, last touch) with the auth-retry from `7d64f17` (2026-07-23 19:56:47 +0000); sequential completion tail + imagery + plugin docs in `88bf693` (2026-07-25 00:20:22 +0530); maxDuration bump `b83334b` (2026-07-24 10:03:13 +0530).

**Impact:** any single upstream stall anywhere in interpret → author → digest-join → verify → revise → synthesis → imagery → hosted-doc chain extends the run unboundedly; on Vercel the engine can also silently die mid-chain leaving a permanently "Executing" run.

---

## Problem 4 — Full Mode is not interactive and asks no meaningful follow-up questions

**Root cause: the interactive gate system was deliberately disconnected on 2026-07-23 ("never-park"), and no clarifying-question path was ever wired to the composer.**

- `server/oda/orchestrator.js:201-217` — the ONLY consumer of `control.requires_user_gate && control.mode === 'full'` now writes a **system decision** ("Scope auto-approved … runs never park on scope confirmation") and a non-blocking `skill.progress` notice, then proceeds. Before `664eed6` (2026-07-23 18:08:28 +0000) this site called `await raiseRunGate(...)` with the per-skill `PRE_EXECUTION_GATE` (`problem_definition`, `model_structure`, `storyline`, …).
- `orchestrator.js:230-236` `raiseRunGate` and `orchestrator.js:44-53` `PRE_EXECUTION_GATE` are **exported dead code** — zero call sites remain (verified by grep). The second former call site (verifier escalation → `verification_findings` gate) was likewise replaced by auto-ship: `orchestrator.js:554-577` ("the run NEVER parks here — the best artifact ships WITH its open findings").
- The full gate machinery still exists and is reachable in the API (`gates.js:54-113` GATE_DEFS with 10 gate types incl. `hypotheses`, `recommendations`, `assumptions_low_base_high`; `routes.js:140-154` gate resolution; `resolveGateAndContinue` `orchestrator.js:243-272`; frontend `GateCard.jsx` + `stageMap.js:52-72` gate→canvas mapping; sidebar Resume button `OdaSidebar.jsx:50`) — but **nothing on the backend ever creates a gate anymore**, so `question.required` is never emitted and `waiting_for_user` is never entered via a gate.
- No clarifying-question generation exists anywhere: the handoff is built with `unresolvedQuestions: []` **hardcoded** (`orchestrator.js:367`), and the interpreter prompt (`interpreter.js:37-59`) only asks GLM for routing JSON — there is no field for questions to the user. FULL mode's remaining effect is only: verification on (`orchestrator.js:474-476`) and multi-node pipelines kept in `enforceOutputClass` (`interpreter.js:307-309`).

**Timestamps:** gates ported `d51e489` (2026-07-22 18:35:08 +0000); disconnected in `664eed6` (2026-07-23 18:08:28 +0000); the FUNCTIONALITY_INVENTORY.md at HEAD still advertises "Approval gates … the run parks in waiting_for_user" — documentation now contradicts code.

**Impact:** Full mode differs from Fast only by verification and pipeline depth; the user is never asked to confirm problem definition, scope, hypotheses, model structure, assumptions, storyline or verification findings — the entire M4 interactive contract is inert.

---

## Problem 5 — The small dashboard chat box is not a proper conversational interface

**Root cause: the composer is a one-shot run launcher; there is no message/conversation channel to a run at any layer.**

- Frontend: `src/oda/OdaSidebar.jsx:66-71` `handleSubmit` → `onSubmit({ text, files })` → `OdaWorkspace.jsx:41-60` `onSubmit` → **always `start({...})`** (`useOdaRun.js:208-220`), i.e. `POST /api/oda/runs` — a brand-new run — for every submission. Submitting while a run is active simply abandons the SSE subscription of the old run (`listen` closes the previous EventSource, `useOdaRun.js:169-171`) and replaces the workspace state.
- There is no chat transcript UI in the workspace: the sidebar renders history-of-runs buttons (`OdaSidebar.jsx:96-120`), not messages; no component in `src/oda/` renders user/assistant turns (the real chat components `Composer.jsx`/`Messages.jsx` belong to the separate suite-home `App.jsx` surface, not mounted in `/oda`).
- Backend: `server/oda/routes.js` exposes runs/gates/pause/resume/cancel/artifacts/download — **there is no `POST /runs/:id/message`, no follow-up-text endpoint, no route that feeds new user text into a live run**. The only mid-run inputs are gate resolutions (`routes.js:140-154`) with `{approved, choice, edits}` — and per Problem 4, gates are never raised.
- The per-run OnDemand chat session (`ensureSession`, `orchestrator.js:148-154`) is reused across node calls as model context, but nothing maps user-typed text into it after run start.
- The one conversational affordance that exists is the `widget:` prefix fast-path (`OdaWorkspace.jsx:44-48`) which spawns an isolated `WidgetCard` — explicitly "one widget = one card = one task context" (`WidgetCard.jsx:1-8`), not a thread.

**Timestamps:** composer/one-shot design since `f086250`/`3806578` (2026-07-23 01:13 +0000, Phase-3 workspace); unchanged through `88bf693` (2026-07-25 00:20:22 +0530).

**Impact:** users cannot refine, answer, or steer a run from the "chat" box; every message forks a new run (and a new pipeline), which also multiplies backend load (see Problem 3).

---

## Problem 6 — Rendering artificially constrained to four stage cards

**Root cause: a pre-cooked, frozen four-slide template is hardwired at every layer, and the stage router prefers it over the per-skill canvases.**

The hardcoded four-card limit exists in **six places**:

| Layer | File:Line | Code |
|---|---|---|
| Template init | `server/oda/liveDeck.js:44-57` | `initLiveDeck`: `slides: [1, 2, 3, 4].map(...)` |
| Ownership map | `server/oda/liveDeck.js:38-41` | `SLIDE_MAP = Object.freeze({ interpret: 1, evidence: 2, core: 3, actions: 4 })`; `KINDS`/`KICKERS` arrays of length 4 |
| Plan preview truncation | `server/oda/liveDeck.js:119` | `bullets: (pipeline || []).slice(0, 4)` — a 5+-node pipeline is silently truncated on card 04 |
| Digest routing | `server/oda/liveStream.js:89-118` | streaming digests patch only `slides[2]` (card 03) and `slides[1]` (card 02) — additional pipeline stages have no card to stream into |
| Frontend fallback | `src/oda/useOdaRun.js:107` and `src/oda/stages/StageLiveDeck.jsx:58-59` | `[1, 2, 3, 4].map((no) => ({...}))` skeletons |
| Stage-router lock | `src/oda/stageMap.js:79` | `if (run.liveDeck?.slides?.some((sl) => sl.status !== 'pending')) return 'live-deck';` |

The `stageMap.js:79` line is the **lock-in**: `initLiveDeck(run)` runs at `startRun` step 0 (`orchestrator.js:166`) and `onInterpreted` immediately sets slide 1 to `filling` (`liveDeck.js:101-112`), so from interpretation onward the condition is always true and the canvas renders `StageLiveDeck` (the four cards) for the **entire** executing/verifying/revising lifetime — the richer per-node canvases below it (`stageMap.js:80-88`: evidence board, benchmark matrix, country data, model, storyline, document renderers in `src/oda/stages/`) are unreachable during a run except via an open gate (which never opens — Problem 4). Pipelines with 2, 3 or 6 nodes all render as the same fixed 01–04 grid; nothing maps pipeline nodes to cards.

**Timestamps:** template `504a968` (2026-07-22 23:21:57 +0000, "pre-cooked 4-slide live template"); router lock `3806578` (2026-07-23 01:13:38 +0000, "native in-canvas live rendering (checkpoint b)"); still intact at `88bf693` (2026-07-25 00:20:22 +0530).

**Impact:** the UI cannot represent the actual pipeline shape; multi-stage runs are squeezed into four fixed narrative cards, and per-stage renderers (issue tree, benchmark matrix, model preview…) effectively never display.

---

## Problem 7 — Visible workflow state does not reflect actual backend execution state

**Finding on timers first:** the frontend genuinely has **no simulated-progress timers** (only `WidgetCard.jsx:60`, a cosmetic loading-message rotator). The mismatch is real state divergence, not animation:

1. **Serverless split-brain: SSE subscribers and run state are per-lambda-instance.**
   `server/oda/events.js:30` — `subscribers` is an **in-process `Map`**; `emitRunEvent` (`events.js:74-96`) fans out only to connections attached to *that* process. `server/paths.js:23-28` — on Vercel `ODA_DATA_DIR` is `/tmp/oda-data`, "**ephemeral and per-instance — data written at runtime does not persist across cold starts or between concurrent lambda instances**" (the file's own comment). The long-lived `GET /runs/:id/events` SSE request and the short `POST /runs` request that owns the executing engine can land on **different instances**: the subscriber then replays a stale `/tmp` copy of the run (`events.js:130-140`) and receives **zero live frames** while the real engine progresses elsewhere. The visible state (frozen at "Interpreting"/"Executing", or an eternal skeleton) is then *provably* not the backend execution state. The same split makes `GET /runs/:id` rehydration (`useOdaRun.js:195-205`) racy.

2. **Engine death leaves non-terminal statuses on display indefinitely** (same mechanism as Problem 3.5): killed lambda → run stuck `executing` in state files → UI badge "Executing" (`Canvas.jsx:40-45` STATUS_PILL) forever; orphan sweep (`runStore.js:150-165`) only corrects it after a *later cold start of an instance sharing that /tmp*, which may never observe it.

3. **Frontend optimism and force-finalisation mask backend truth.**
   - `src/oda/useOdaRun.js:241-245` — gate resolution **optimistically sets `status: 'executing'`** before any backend frame confirms.
   - `src/oda/useOdaRun.js:112-114` — `deck.ready` maps **all four slides to `final`** regardless of per-slide backend state; `liveDeck.js:204-212` similarly stamps an empty Evidence card final at completion (card shows "Final" for a stage that never executed — the core of the user-visible lie).
   - Slide "status" (`pending/filling/final`) is a **narrative-card state**, not node state: `onPipelineSelected` (`liveDeck.js:115-123`) marks card 4 "filling" at planning; `onArtifactPreview` fills cards 3/4 from the first draft — so cards visually "progress" ahead of the actual nodeStates (`queued/running/verifying/completed`), which the four-card view doesn't display at all (nodeStates are only visible in the ArtifactRail, `ArtifactRail.jsx:96-160`).

4. **Status oscillation from concurrent nodes.** `transition(run,'verifying')`/`'executing'` are global run-level statuses flipped inside per-node code paths (`orchestrator.js:494, 546, 584, 608`); with `Promise.allSettled` parallel nodes (`orchestrator.js:314`) two nodes interleave transitions, so the pill can show "Verifying" while another node is authoring — approximately true at best.

**Timestamps:** events/in-memory bus `d51e489` (2026-07-22); serverless /tmp move `b8178d3` (2026-07-24 09:48:56 +0530) + `8006aaa` (2026-07-20 12:36:42 +0530 on checkpoint branch); optimistic gate update `f086250`-era Phase 3 (2026-07-23), unchanged at HEAD.

**Impact:** on Vercel deployments, live progress frequently freezes or lies (stale replay, stranded "Executing"); even locally, card status ≠ node status by construction.

---

## Problem 8 — Final outputs lack grounding in the original request, evidence, analysis, and clarification

**Root cause: the final document is authored by an external plugin from a truncated markdown blob; the composition chain drops the request, evidence, assumptions, and (nonexistent) clarifications at four successive stages.**

Trace of final-prompt composition (`completeRun` → `packageRunArtifact` → `generateHostedDoc`):

1. **Only the last node's artifact survives.** `server/oda/autoArtifact.js:43-45` — `primary` = newest verified non-synthesis artifact. Upstream artifacts (evidence pack, workbook, model) are **not** merged into the final document input; they only influenced it indirectly via context during authoring.
2. **The plugin prompt contains no run context.** `server/oda/pluginDoc.js:77-88` — the instruction sent to the OnDemand Agent (plugin-1775547203) is layout-only: brand brief, logo, images, "one slide/page per '##' heading". It includes **neither `run.request.text`, nor `run.intent`, nor evidence, nor assumptions, nor gate decisions**. The plugin (running on the user-chosen brain, `autoArtifact.js:117-130`) regenerates the deliverable file from:
3. **A hard 12,000-character truncation.** `pluginDoc.js:51` — `const body = String(content || '').slice(0, 12000);` A ~5-page document or 10-slide deck draft (DOC_SIZING/DECK_SIZING targets, `orchestrator.js:84-93`) easily exceeds 12k chars — **the tail of the analysis is silently cut** before the final file is built. (The local fallback builders don't truncate, but the plugin path is default-ON: `autoArtifact.js:104-112`, `ODA_PLUGIN_DOCS !== '0'`, formats `pptx,pdf,xlsx`.)
4. **Upstream grounding was already thin.**
   - `verifiedFacts` in every handoff come from `run.evidence` (`orchestrator.js:365`), which is populated only by the near-never-matching `**fact**` regex (`orchestrator.js:433`, Problem 1.2) — so the "Verified facts" section of the worker brief is almost always "(none)" (`contextLoader.js:130`).
   - Clarifications cannot exist: `unresolvedQuestions: []` hardcoded (`orchestrator.js:367`); gates never raised (Problem 4), so `run.assumptions` gains user edits only in the dead `resolveGateAndContinue` path (`orchestrator.js:260-262`).
   - The original request reaches intermediate workers only as the one-line `objective` (`orchestrator.js:362`, truncated to 600 chars in `handoff.js:73`) — and in fast-collapsed single-node runs, `objective` is `c.intent`, GLM's ≤400-char paraphrase (`interpreter.js:137`).
   - The synthesis note is generated from **titles only**: `completeRun` query lists artifact titles/types + assumptions (`orchestrator.js:640`), explicitly "No new claims" — it cannot re-ground the document; and it is appended as a separate `run-synthesis` artifact, not merged into the deliverable.

**Timestamps:** plugin-first packaging + 12k truncation + image enrichment in `88bf693` (2026-07-25 00:20:22 +0530); "always-docx final deliverable" precursor `7d64f17` (2026-07-23 19:56:47 +0000); download-route format upgrades `d63009d` (2026-07-23 20:00:02 +0000).

**Impact:** the downloaded file is a *re-authored, truncated re-render* of the last draft — original user phrasing, evidence citations beyond 12k chars, cross-stage analysis and any user clarifications are structurally absent from the final-prompt context.

---

## Cross-cutting note

Five of the eight problems intersect at two commits:
- **`664eed6` (2026-07-23 18:08:28 +0000)** — "never-park gating" removed every interactive stop (P1 ordering guard, P2 problem-definition gate, P4 interactivity) to fix the earlier "Waiting for you" dead-ends.
- **`88bf693` (2026-07-25 00:20:22 +0530, misleadingly titled "added log level fixes")** — introduced fast-collapse pipelines (P1), fast-model authoring + plugin-built finals with 12k truncation (P8), and the sequential imagery/hosted-doc completion tail (P3).

The repository has no test suite for `server/oda/*` (only `tests/{interaction,regression,voice}.test.mjs` and `test/world.test.mjs` targeting other subsystems; `package.json` defines no `test` script), so none of these regressions were caught mechanically.


---

# RESOLUTIONS (2026-07-25)

- **Problem 1 — RESOLVED 2026-07-25T06:28Z.** enforceOutputClass fast-collapse keeps planned
  evidence stages (05:06Z); liveDeck Recommendations gated to the terminal node + honest Evidence
  stamp (05:06Z); heuristicInterpret multi-node FULL pipelines, normaliseControl illegal-graph
  REPAIR (drop only illegal edges), and the 4-pattern extractEvidenceClaims() replacing the
  never-matching '**fact**' regex (06:28Z). Verified: FULL heuristic probes return multi-node
  chains; extractor hits 6/6 tag shapes on sample; 8/8 contract tests green.
- **Problem 2 — RESOLVED 2026-07-25T05:09Z.** problem-solve→benchmark edge added (validatePipeline
  accepts, unit-proven); depth-0 roots sequential (sequential_depth0 notice); interpreter prompt
  reordered; pre-execution gate restored (raiseRunGate live, orchestrator.js:226-227).
- **Problem 4 (gates) — RESOLVED 2026-07-25 (prior pass).** Clarification gate chain + GLM 4.7
  final-prompt synthesis + POST /runs/:id/message; e2e 10/10 with 3 real gates answered.
- **Problem 8 — RESOLVED 2026-07-25T05:12Z.** autoArtifact merges newest upstream verified
  artifacts as appendix sections + passes runContext {originalRequest, clarifications,
  finalPrompt, evidence, assumptions}; pluginDoc renders the RUN CONTEXT block in both templates.
- **Problem 3 — PARTIALLY RESOLVED, verified 2026-07-25T22:20Z.** Bounded-execution controls at
  HEAD e56acfd: 90s upstream-stall watchdog (`server/ondemand.js:263-264 STALL_MS = 90000`),
  verifier revise cap `REVISE_POLICY {maxReviseLoops: 2}` + `shouldEscalate` (`server/oda/verifier.js:361-369`),
  never-park verifier escalation (ships instead of looping), boot orphan sweep marking dead
  in-flight runs failed (`server/oda/runStore.js:150-165`), sequential depth-0 execution
  (`orchestrator.js` sequential_depth0). HONEST GAP: no TOTAL per-run wall-clock cap exists
  (grep RUN_MAX/wallClock/runTimeout → none) — a pathologically slow model can still extend a
  run; every individual stage is bounded but the sum is not. Flagged as future work.
- **Problem 5 — RESOLVED 2026-07-25 (re-verified at HEAD e56acfd, 22:15Z).** Mid-run message
  channel live end-to-end: `POST /runs/:id/message` (`server/oda/routes.js:157`),
  `handleRunMessage` (`server/oda/orchestrator.js:351`), composer answers the ACTIVE run when
  parked (`src/oda/OdaWorkspace.jsx:43 runIsWaiting`, `:56 sendMessage`; hook
  `src/oda/useOdaRun.js:254`), answering affordance (`src/oda/OdaSidebar.jsx:125`).
- **Problem 6 — RESOLVED BY DESIGN, verified 2026-07-25T22:20Z.** Rendering is no longer
  constrained to four cards: 14 per-skill stage renderers exist (`src/oda/stages/` — 15 STAGES
  incl. idle/failed in `src/oda/stageMap.js:7-23`), gates route to their owning canvases
  (`stageMap.js:52-71`). The four-slide LIVE DECK remains as the intentional universal live
  render while executing (`stageMap.js:82` preemption) — a design decision, not a constraint:
  gate/completed/failed states always reach the per-skill canvases.
- **Problem 7 — RESOLVED, verified 2026-07-25T22:20Z.** Visible state mirrors backend state:
  durable event log with SSE seq replay (`server/oda/events.js:8, :112 subscribe(since)`),
  single-source status graph `LEGAL_TRANSITIONS` (`runStore.js:192-204`, illegal moves throw),
  one-frame-per-state-change emits (7 emitRunEvent sites in runStore) + write-through persistence
  (12 persist(run) sites), boot orphan sweep eliminates stranded 'Executing' ghosts
  (`runStore.js:150-165`), optimistic UI updates reconciled by authoritative SSE
  (`useOdaRun.js` resolveGate/sendMessage).
