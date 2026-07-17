# NOTES.md — ODA Productivity Suite engineering log

## 2026-07-17 — Streaming reference (Workstream 1)

**Read at 2026-07-17 ~16:29–16:33 UTC. Sources actually read (live, not memory):**

1. **`ondemand-api-docs` skill (installed in this terminal)** — followed its documented flow:
   - `GET /config/v1/public/docs/categories` (live) — enumerated all documented services/slugs.
   - `GET /config/v1/public/docs/reference/api/submitquery` (live) — full OpenAPI 3.0 spec for
     `POST /chat/v1/sessions/{sessionId}/query`.
2. **Live public docs (fetched over HTTP because the skill's OpenAPI spec does not describe the
   stream wire format):**
   - `https://docs.on-demand.io/docs/chat-api.md` (958 lines) — contains the only documented
     SSE stream sample.
   - `https://docs.on-demand.io/reference/submitquery.md` — reference page for submit query.
   - `https://docs.on-demand.io/llms.txt` — page index (confirmed there is NO dedicated
     streaming/SSE guide page; `docs/streaming` → 404).
3. **Live SSE captures (2026-07-17 ~16:31 UTC)** against `predefined-gpt-5.6-sol` — two real
   streamed queries (reasoningEffort `medium`: 45 frames; `max`: 94 frames), used to verify
   behaviour the docs do not state.

### Extracted — SSE event types (documented + live-verified)

Wire format: every frame is `event:message` + `data:<json>` (single-line JSON), frames separated
by a blank line; the terminal sentinel is the literal `data:[DONE]`.

| eventType | Payload keys (live) | Meaning |
|---|---|---|
| `fulfillment` | `sessionId, messageId, answer, status:"processing", eventIndex, eventType` | **Answer token delta** in `.answer` (the ONLY event type shown in the docs' stream sample) |
| `fulfillment_thinking` | `.thinking.delta` | **Thinking/reasoning token delta** — NOT in the public docs; retained from prior live captures. **Live status 2026-07-17: `predefined-gpt-5.6-sol` emitted ZERO `fulfillment_thinking` frames at both `medium` and `max` reasoningEffort (45- and 94-frame captures today; consistent with the three captures from the earlier pass).** Parser support kept; synthetic demo route proves the render path. |
| `statusLog` | `currentStatusLog:{statusType,statusMessage}, eventIndex, …` | Progress/status frames (e.g. `fulfillment_started`, `fulfillment_completed`) — live-observed, not in the docs sample |
| `metricsLog` | `publicMetrics:{…}, eventIndex, …` | Token/latency metrics at end of generation — live-observed, not in the docs sample |
| *(no eventType)* | `sessionId, messageId, time` | Heartbeat/keep-alive data frame — live-observed; must be silently ignored |
| `data:[DONE]` | — | **End/completion sentinel** closing the stream (documented in chat-api.md) |

### Thinking-token flagging
- Thinking tokens are distinguished from answer tokens by **`eventType: "fulfillment_thinking"`**
  (delta in `.thinking.delta`) vs **`eventType: "fulfillment"`** (delta in `.answer`).
- **Explicit doc-coverage statement:** the public docs (skill OpenAPI spec + chat-api.md) do NOT
  document `fulfillment_thinking`, `statusLog`, `metricsLog`, heartbeat frames, or any
  reasoning-output request flag. These are live-observed behaviours only.

### Error and end/completion events
- **End:** `data:[DONE]` terminal sentinel (documented). `statusLog` with
  `statusType: fulfillment_completed` and a final `metricsLog` precede it (live-observed).
- **HTTP-level errors:** documented envelopes — `4XX` → `ClientErrorResponse
  {errorCode, message}`, `5XX` → `ServerErrorResponse {errorCode, message: "Internal server
  error", errorCode: "server_error"}` (from the submitquery OpenAPI spec).
- **In-stream error frames:** NOT documented. Our client defensively treats any frame with
  `eventType:"error"` or an `error` key as fatal (`UPSTREAM_ERROR_FRAME`).

### Request flags for enabling reasoning output
- Documented `submitquery` body: `query`, `endpointId`, `responseMode` (`sync|stream|webhook`),
  `pluginIds`, `fulfillmentOnly`, `modelConfigs{fulfillmentPrompt, stopSequences, temperature,
  topP, presencePenalty, frequencyPenalty}`. **No reasoning/thinking flag exists in the
  documented schema.**
- `reasoningEffort` (top-level body key, e.g. `"medium"`/`"max"`) is a **live-accepted extension**
  — the API returns HTTP 200 and streams normally with it; it is how gpt-5.6-sol-medium is
  addressed (`endpointId: predefined-gpt-5.6-sol` + `reasoningEffort: "medium"`; the fused id
  form returns HTTP 400 per Phase-1 verification).
- Even with `reasoningEffort: max`, today's captures show the platform does not currently
  surface thinking frames for this endpoint. If/when it does, the pipeline (parser →
  SSE passthrough → `Thinking…` accordion) renders them live token-by-token — proven via the
  synthetic `/api/debug/stream-demo` route which pushes `fulfillment_thinking`-shaped deltas
  through the identical wire path.

### Workstream 1 audit fixes applied today (see git log for the commit)
- `/api/chat` now aborts the **upstream** OnDemand fetch when the browser disconnects
  (AbortController wired to req/res `close`) — previously the upstream stream kept running and
  tokens were written to a dead socket.
- `send()` in `/api/chat` is now guarded by a `closed` flag so no frames are written after
  client disconnect.
- Added missing **`.env.example`** (ONDEMAND_API_KEY / ONDEMAND_BASE_URL / PORT /
  **STREAM_DEBUG=true** — debug mode ON by default at start).
- Re-verified the rest of the path clean: correct SSE headers (`text/event-stream`,
  `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`), `flushHeaders()` +
  per-frame `flush()`, no compression middleware on the SSE route, line-by-line parser with
  multi-byte-safe `TextDecoder(stream:true)` and tail-flush on both server and client, and
  incremental thinking rendering (`patchLive` appends each delta; accordion renders live —
  no end-of-stream dump).

---

## 2026-07-17 — OnDemand Chat API streaming investigation (docs + live capture)

Scope: establish, with documentation excerpts and raw live-API evidence, (1) the
request parameter that enables reasoning/thinking output for `gpt-5.6-sol-medium`,
(2) the parameter that enables streaming, and (3) the complete set of SSE event
types the streaming endpoint actually emits — including thinking/reasoning deltas
and plugin/tool-call events.

Method note: "gpt-5.6-sol-medium" is not a single endpoint id. It decomposes into
`endpointId: "predefined-gpt-5.6-sol"` + `reasoningEffort: "medium"` (confirmed
live — see §1b; also recorded in `server/env.js` from the Phase-1 build).

---

### 1) Reasoning/thinking token request parameter

**Parameter (live-verified): top-level `reasoningEffort` — allowed values `low`, `medium`, `max`.**

a. **The documented `submitquery` schema does NOT contain any reasoning parameter.**
   Source: live OpenAPI spec, `GET https://gateway.on-demand.io/config/v1/public/docs/reference/api/submitquery`
   (Chat & Agent Tools API → "Use Agent Tools & Submit Query"), fetched 2026-07-17 ~16:42 UTC.
   Documented request-body properties (verbatim, complete list):
   `query`, `endpointId`, `responseMode`, `pluginIds`, `fulfillmentOnly`, `modelConfigs`
   — and `modelConfigs` contains only: `fulfillmentPrompt`, `stopSequences`,
   `temperature`, `topP`, `presencePenalty`, `frequencyPenalty`.
   A full-text search of the spec for "reasoning" / "thinking" / "effort" returned 0 hits.

b. **The live API nevertheless parses and validates a top-level `reasoningEffort` field.**
   Proof (2026-07-17 16:46:5x UTC, POST /chat/v1/sessions/{sessionId}/query):
   - `"reasoningEffort": "bogus-value"` → HTTP 400:
     `{"message":"reasoningEffort must be one of low, medium, max","errorCode":"invalid_request"}`
   - `"reasoningEffort": "medium"` → HTTP 200, accepted.
   The 400 error text is server-side proof the parameter is real and its enum is
   `low | medium | max` — it is an undocumented extension of the submitquery schema.

c. **The endpoint itself advertises reasoning support.** Documented Endpoints API
   (`GET https://api.on-demand.io/config/v1/public/endpoints`, slug `getallendpointspublic`,
   fetched 2026-07-17 ~16:43 UTC) returns for `predefined-gpt-5.6-sol`:
   `"reasoning_efforts": ["low", "medium", "max"]`, `"streaming_supported": true`,
   `"model_id": "gpt-5.6-sol"`, `"status": "active"`.

### 2) Streaming request parameter

**Parameter (documented): `responseMode: "stream"`.**
Source: same live `submitquery` OpenAPI spec (docs slug `submitquery`,
path `POST /chat/v1/sessions/{sessionId}/query`, server `https://api.on-demand.io`):
`responseMode` is REQUIRED, type string, enum exactly `["sync", "stream", "webhook"]`.
The response section of the spec documents ONLY the sync-mode JSON shape
(`data.sessionId`, `data.messageId`, `data.answer`, `data.status` enum
`processing|completed|failed`). **The SSE event types are NOT documented anywhere
in the public spec** — hence the live capture in §3.

### 3) SSE event types — established from live raw captures

Captures (raw, unmodified, committed under `debug/sse-samples/`):

| File | Request config | Capture window (UTC) | Bytes |
|---|---|---|---|
| `debug/sse-samples/gpt-5.6-sol-medium-plugin-call.sse.log` | stream + reasoningEffort=medium + pluginIds=[plugin-1713924030] (internet search) | 2026-07-17T16:43:48.553Z → 16:44:04.427Z | 29,855 |
| `debug/sse-samples/gpt-5.6-sol-medium-reasoning.sse.log` | stream + reasoningEffort=medium + fulfillmentOnly=true (no plugins) | 2026-07-17T16:45:50.541Z → 16:45:59.866Z | 72,090 |
| `debug/sse-samples/gpt-5.6-sol-max-reasoning.sse.log` | stream + reasoningEffort=max + fulfillmentOnly=true (no plugins) | 2026-07-17T16:46:20.438Z → 16:46:34.284Z | 46,392 |

Session: `6a5a5bb8fe085fa6b0b185fa`, endpoint `predefined-gpt-5.6-sol`.
HTTP 200, `Content-Type: text/event-stream; charset=utf-8` on all three.

**Complete event taxonomy observed (outer SSE `event:` line × inner JSON `eventType`):**

| Outer `event:` | Inner `eventType` | Meaning | Seen in plugin run | Seen in no-plugin runs |
|---|---|---|---|---|
| `thinking` | `planning_output` | RAG planner streaming its plan JSON (objective + steps + chosen plugins) as deltas | 14 frames | — |
| `thinking` | `planning_thinking` | planner reasoning delta channel (`thinking.delta`) | 1 frame (empty delta) | — |
| `thinking` | `step_output` | **plugin/tool call event** — streams the plugin invocation JSON: `pluginId`, `name`, `api_request_parameters` (the tool arguments), `identifier` | 12 frames | — |
| `thinking` | `step_thinking` | step-execution reasoning delta channel (`thinking.delta`) | 1 frame (empty delta) | — |
| `message` | `statusLog` | operational phase (`statusType`: `fulfilling`, `fulfillment_completed`) | 2 | 2 each |
| `message` | `fulfillment` | answer token delta (`answer` field carries the delta) | 115 | 368 / 233 |
| `message` | `metricsLog` | final token/timing metrics (`publicMetrics`) | 1 | 1 each |
| `message` | *(non-JSON)* | terminal frame, literally `data: [DONE]` | 1 | 1 each |
| `heartbeat` | *(none)* | keepalive `{sessionId, messageId, time}` | 5 | 2 / 4 |

**One raw sample frame of EACH observed type (verbatim from `gpt-5.6-sol-medium-plugin-call.sse.log`, captured 2026-07-17T16:43:48–16:44:04Z):**

```
event:thinking
data:{"sessionId":"6a5a5bb8fe085fa6b0b185fa","messageId":"6a5a5bc4854da757be741e26","eventIndex":1,"eventType":"planning_output","status":"processing","output":{"delta":"{\n  \"objective\": \"Find the current"}}

event:thinking
data:{"sessionId":"6a5a5bb8fe085fa6b0b185fa","messageId":"6a5a5bc4854da757be741e26","eventIndex":14,"eventType":"planning_thinking","status":"processing","thinking":{"delta":""}}

event:thinking
data:{"sessionId":"6a5a5bb8fe085fa6b0b185fa","messageId":"6a5a5bc4854da757be741e26","eventIndex":16,"eventType":"step_output","status":"processing","output":{"delta":"{\"plugins\":[{\"pluginId\":\"plugin"}}

event:thinking
data:{"sessionId":"6a5a5bb8fe085fa6b0b185fa","messageId":"6a5a5bc4854da757be741e26","eventIndex":27,"eventType":"step_thinking","status":"processing","thinking":{"delta":""}}

event:message
data:{"sessionId":"6a5a5bb8fe085fa6b0b185fa","messageId":"6a5a5bc4854da757be741e26","eventIndex":1,"eventType":"statusLog","status":"processing","currentStatusLog":{"statusType":"fulfilling","statusMessage":"Fulfilling the prompt...","time":"2026-07-17T16:43:59Z"}}

event:message
data:{"sessionId": "6a5a5bb8fe085fa6b0b185fa", "messageId": "6a5a5bc4854da757be741e26", "answer": "As", "status": "processing", "eventIndex":2, "eventType": "fulfillment"}

event:message
data:{"sessionId":"6a5a5bb8fe085fa6b0b185fa","messageId":"6a5a5bc4854da757be741e26","eventIndex":118,"eventType":"metricsLog","status":"processing","publicMetrics":{"inputTokens":3771,"outputTokens":192,"totalTokens":3963,"ragTimeSec":9.85,"fulfillmentTimeSec":3.36,"totalTimeSec":13.21}}

event:heartbeat
data:{"sessionId":"6a5a5bb8fe085fa6b0b185fa","messageId":"6a5a5bc4854da757be741e26","time":"2026-07-17T16:43:51Z"}

event:message
data:[DONE]
```

**Plugin-call evidence (reassembled from the `step_output` deltas — full aggregate
present in the raw dump):** the stream carries the complete plugin invocation,
including arguments:

```json
{"plugins":[{"pluginId":"plugin-1713924030","name":"fetchInternetData",
  "description":"Searches the web for up-to-date weather observations and source details.",
  "api_request_parameters":{"query":"Abu Dhabi current weather latest observation time temperature conditions"},
  "all_parameters_hydrated":true,"dependencies":[],"identifier":"rest_api"}]}
```

There is no separate "plugin result" event type: after `step_output` completes, the
stream moves to `statusLog(fulfilling)` and the plugin's result surfaces only via
the grounded `fulfillment` answer deltas (the answer cited the fetched source).

### 4) Honest findings / limitations (backed by the dumps)

- **`fulfillment_thinking` (model-level reasoning deltas during the answer) was NOT
  observed in any of today's three captures.** In both no-plugin runs
  (`reasoningEffort` medium AND max, `fulfillmentOnly: true`), the stream contained
  ONLY `statusLog`, `fulfillment`, `metricsLog`, `heartbeat`, `[DONE]` — zero
  thinking-delta characters (see `gpt-5.6-sol-medium-reasoning.sse.log` and
  `gpt-5.6-sol-max-reasoning.sse.log`). `reasoningEffort` was accepted (HTTP 200)
  and is definitely parsed (bogus value → HTTP 400), but for these prompts
  gpt-5.6-sol emitted no model-reasoning deltas in the stream.
  Note: an earlier Phase-1 build comment in `server/index.js` reports
  `fulfillment_thinking` frames were observed on 48/216/37-frame runs; today's
  captures cannot confirm that event type, so it is listed as previously-reported,
  not as observed today. Nothing in today's dumps is simulated.
- **The `*_thinking` channels that DID appear today (`planning_thinking`,
  `step_thinking`) carried empty deltas** in the plugin run — the channel exists,
  but no reasoning text was populated in this capture.
- The documented spec's response section covers sync mode only; every SSE fact
  above comes from the raw dumps, not from documentation.

### 5) Practical integration recap (for this app's `server/ondemand.js`)

- Streaming: `responseMode: "stream"` (documented, required enum member).
- Reasoning: top-level `reasoningEffort: "low"|"medium"|"max"` (undocumented but
  live-validated; server enforces the enum).
- Frontend mapping used by the suite: `thinking/*` events → thinking accordion,
  `statusLog` → phase line, `step_output` → plugin activity, `fulfillment` →
  answer tokens (loader hides on first one), `metricsLog` → debug footer,
  `[DONE]` → close.
