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
