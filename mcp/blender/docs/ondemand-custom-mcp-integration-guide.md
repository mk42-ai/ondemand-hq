# Wiring a Custom MCP Server / Custom Tool into an OnDemand Agent

**A live-documentation-grounded integration guide, with a worked `blender-mcp` bridge example**

---

## 0. Fetch metadata — what was read, and when

**Fetch timestamp (UTC):** `2026-07-28T03:21:49Z` — categories index
**Verification re-fetch (UTC):** `2026-07-28T03:30:06Z` — all 28 operation specs re-pulled and diffed
**Docs API host used for retrieval:** `https://gateway.on-demand.io` (from the `ON_DEMAND_BASE_URL` environment variable)

Everything in this guide was fetched live at those timestamps. Nothing is written from memory. Where a
fact is **not** in the live documentation, it is explicitly flagged as such rather than filled in.

> **Source-provenance note (upstream `blender-mcp` material).** The previously cited
> **"ClaudeLog — Blender MCP"** page **could NOT be verified as existing** and must be treated as
> **unverified** — no claim in this guide rests on it. By contrast, the **AI Architects guide
> (Tom Crawshaw, June 2026)** — `https://theaiarchitects.com/blog/blender-mcp` — **IS real** and
> independently corroborates the two-component architecture (Blender addon TCP socket server +
> stdio MCP server). Full list in §12.

### 0.1 The two live documentation endpoints

| Purpose | Method & path | Auth header |
|---|---|---|
| List every documented service + operation slug | `GET https://gateway.on-demand.io/config/v1/public/docs/categories` | `apikey` |
| Get the OpenAPI 3.0 spec for one operation | `GET https://gateway.on-demand.io/config/v1/public/docs/reference/api/<slug>` | `apikey` |

### 0.2 Exact live URLs read, per section of this guide

| Guide section | Live URL(s) read |
|---|---|
| Service index (all sections) | `https://gateway.on-demand.io/config/v1/public/docs/categories` |
| §2 REST API Key Management | `.../docs/reference/api/generateapikey`, `.../docs/reference/api/deleteapikey` |
| §3 Chat & Agent Tools | `.../docs/reference/api/createchatsession`, `submitquery`, `getchatsessions`, `getchatsession`, `getchatmessages`, `getchatmessage`, `createchatbatch`, `getchatbatches`, `getchatbatch`, `deletechatbatch` |
| §4 Agents Flow Builder | `.../docs/reference/api/post_workflow-id-activate`, `post_workflow-id-deactivate`, `post_workflow-id-execute`, `streamworkflowlogs` |
| §5 Custom tool / plugin registration | `.../docs/reference/api/createplugin`, `.../docs/reference/api/deleteplugin` (**both unlisted in the categories index — see §5.1**) |
| §5 Endpoints & Reasoning Modes | `.../docs/reference/api/getallendpointspublic`, `.../docs/reference/api/getentitydefinitionpublic` |
| §3/§5/§8 narrative docs | `https://docs.on-demand.io/llms.txt`, `https://docs.on-demand.io/docs/plugin-api.md`, `.../docs/rest-based-plugins.md`, `.../docs/open-api-schema.md`, `.../docs/rules-to-publish-a-rest-api-plugin.md`, `.../docs/query-and-responses-modes.md`, `.../docs/authentication.md`, `.../docs/webhooks.md`, `.../docs/rate-limiting.md`, `.../docs/response-codes.md`, `.../docs/plugins.md`, `https://docs.on-demand.io/reference/errors.md` |
| §5 Live platform values | `GET https://api.on-demand.io/config/v1/public/endpoints`, `GET https://api.on-demand.io/config/v1/public/entity_definition?entityId=reasoning_modes` |

### 0.3 The complete documented public API surface (26 operations, 8 services)

Verbatim from the live categories index:

| Service | Operations (slug) |
|---|---|
| Media API | `fetchmedia`, `createmediaurl`, `deletemedia` |
| Chat & Agent Tools API | `createchatsession`, `getchatsessions`, `submitquery`, `getchatsession`, `getchatmessage`, `getchatmessages`, `createchatbatch`, `getchatbatches`, `getchatbatch`, `deletechatbatch` |
| Services API | `convertaudiototext`, `converttexttoaudio`, `translatetext` |
| MQTT User Management API | `createmqttuser`, `deletemqttuser` |
| REST API Key Management API | `generateapikey`, `deleteapikey` |
| Agents Flow Builder API | `post_workflow-id-activate`, `post_workflow-id-deactivate`, `post_workflow-id-execute`, `streamworkflowlogs` |
| Reasoning Modes API | `getentitydefinitionpublic` |
| Endpoints API | `getallendpointspublic` |

### 0.4 API hosts differ per service — read this before copying any URL

The host in each spec's own `servers[].url` is **not** the same across services. Use the host the spec declares:

| `servers[].url` declared in the spec | Services using it |
|---|---|
| `https://api.on-demand.io` | Media, Chat & Agent Tools, Endpoints, Reasoning Modes |
| `https://api.on-demand.io/automation/api` | Agents Flow Builder |
| `https://api.on-demand.io/services/v1/public/service` | Services API (audio/text/translate) |
| `https://gateway-dev.on-demand.io` — labelled **"Development server"** | REST API Key Management, MQTT User Management, **Plugin Management** |

> ⚠️ **Flagged discrepancy (not resolvable from the live docs).** The API-key and Plugin-Management specs
> declare only a *Development* host (`gateway-dev.on-demand.io`) and contain **no production server entry**.
> Meanwhile the narrative page `docs.on-demand.io/docs/plugin-api.md` shows the same plugin API being called
> on **`https://api.on-demand.io`** in its shell example (while its Go/Python/JS examples on the same page use
> `gateway-dev.on-demand.io`). Both hosts are reported here exactly as published. For production, prefer
> `https://api.on-demand.io` and confirm with OnDemand support — this guide does not silently pick one.

---

## 1. Executive summary — the single most important finding

**OnDemand's public documentation contains no native MCP (Model Context Protocol) server registration
capability.** This was verified exhaustively, not assumed:

| Verification performed | Result |
|---|---|
| Keyword scan for `mcp` across **all 28** fetched OpenAPI documents | **0 occurrences** |
| Keyword scan for `mcp` in `https://docs.on-demand.io/llms.txt` (the official machine-readable docs index) | **0 occurrences** |
| Categories-index scan for `plugin` / `mcp` / `connector` / `integration` / `register` in service or operation titles | `mcp` **0**, `connector` **0**, `integration` **0**, `register` **0**, `plugin` **0** |
| Probe for speculative doc slugs `mcp`, `createtool`, `plugins`, `getplugins`, `suggestplugins`, `updateplugin`, `getplugin` | all returned **HTTP 400** `{"message":"invalid request"}` — they do not exist |

There is **no** endpoint that accepts an MCP `server.json` manifest, an MCP server URL, a stdio command
(`uvx blender-mcp`, i.e. `claude mcp add blender uvx blender-mcp`), or an MCP `tools/list` capability
document. There is no MCP transport negotiation,
no `Mcp-Session-Id` handling, and no `tools/call` proxy.

### The documented closest alternative — and it is a good one

OnDemand's equivalent of "register a tool" is the **REST API Agent** (called a *plugin* in the API layer):
you describe your tool surface as an **OpenAPI 3.0 schema**, register it as a plugin, receive a
**`pluginId`** of the form `plugin-<digits>`, and pass that ID in the **`pluginIds`** array when creating a
chat session or submitting a query. For multi-step orchestration you additionally use the
**Agents Flow Builder** workflow API.

So the integration shape for `blender-mcp` is:

```text
Blender (addon.py TCP socket server, localhost:9876)
        ▲  JSON command protocol over TCP
        │
   [ YOUR HTTPS BRIDGE ]  ← you build this: translates REST → Blender TCP
        ▲  HTTPS + auth header, publicly reachable
        │
   OnDemand REST API Agent (plugin)  ← OpenAPI schema registered here
        ▲  pluginId = "plugin-XXXXXXXXXX"
        │
   OnDemand chat session / query  ← pluginIds: ["plugin-XXXXXXXXXX"]
```

You are **re-expressing** the MCP tool surface as REST operations. You are **not** connecting an MCP server,
because the platform has no documented way to consume one.

---

## 2. REST API Key Management

Source specs: `.../docs/reference/api/generateapikey` and `.../docs/reference/api/deleteapikey`
(both HTTP 200). `info.title`: "REST API Key Management API", `info.version`: `1.0.0`,
`info.description`: "API for creating and deleting REST API keys."

**Declared host in both specs:** `https://gateway-dev.on-demand.io` ("Development server") — see the §0.4 caveat.

**Auth (both operations)** — `components.securitySchemes`:

```json
{ "ApiKeyAuth": { "type": "apiKey", "in": "header", "name": "apikey" } }
```

The header name is exactly **`apikey`** — lowercase, not `Authorization`, not `X-API-Key`.

> Note: `docs.on-demand.io/docs/authentication.md` contains the sentence "We use the Authorization header
> with the Bearer token type" — but **every code sample on that same page, and every OpenAPI security scheme,
> uses the `apikey` header**. The `apikey` header is authoritative; the Bearer sentence appears to be stale prose.

### 2.1 Generate a REST API key

| | |
|---|---|
| **Method + path** | `POST /user/v1/public/user/apiKey/create` |
| **Full URL (as specced)** | `https://gateway-dev.on-demand.io/user/v1/public/user/apiKey/create` |
| **operationId** | `generateApiKey` |
| **Headers** | `apikey: <YOUR_API_KEY>`, `Content-Type: application/json` |
| **Parameters** | None documented (no path/query/header params defined) |

**Request body schema (verbatim, `required: true`, `application/json`):**

```json
{
  "type": "object",
  "properties": {
    "key": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Name or purpose of the API key",
          "example": "For dev env testing"
        }
      },
      "required": ["name"]
    }
  },
  "required": ["key"]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | object | yes | Wrapper object for the key creation payload |
| `key.name` | string | yes | Name or purpose of the API key |

**Success response `200` — "API key generated successfully":**

```json
{
  "type": "object",
  "properties": {
    "data": {
      "type": "object",
      "properties": {
        "key": {
          "type": "object",
          "properties": {
            "id":         { "type": "string", "description": "Unique identifier for the API key", "example": "66074509feq77890dg27d1d7" },
            "name":       { "type": "string", "description": "Name of the API key", "example": "For Local dev" },
            "companyId":  { "type": "string", "description": "Company ID associated with the API key", "example": "66054042a919189hsde63d40" },
            "key":        { "type": "string", "description": "The generated API key", "example": "btvIWWWnsLug18wb1ZTASRyVxn8ssNPLL" },
            "status":     { "type": "string", "description": "Status of the API key", "example": "active" },
            "last_used":  { "type": "string", "format": "date-time", "description": "Last used timestamp of the API key", "example": "0001-01-01T00:00:00Z" },
            "created_at": { "type": "string", "format": "date-time", "description": "Timestamp when the API key was created", "example": "2024-03-28T15:53:05+05:30" }
          }
        }
      }
    }
  }
}
```

Read the secret from **`data.key.key`**, and keep **`data.key.id`** — that ID is what you pass to the delete
endpoint. Per `docs.on-demand.io/docs/authentication.md`: *"Your new key will be displayed on screen only
once. Copy this key and store it somewhere safe."*

**Documented error codes:**

| Status | Description | Body schema |
|---|---|---|
| `400` | Invalid request | `{ "message": "Invalid request" }` |
| `401` | Unauthorized | `{ "message": "Unauthorized" }` |
| `500` | Server error | Description only — no body schema documented |

No `403`, `404` or `429` is documented **for this operation** (the platform-wide list is in §8).

### 2.2 Delete (revoke) a REST API key

| | |
|---|---|
| **Method + path** | `DELETE /user/v1/public/user/apiKey/revoke/{apiKeyId}` |
| **Full URL (as specced)** | `https://gateway-dev.on-demand.io/user/v1/public/user/apiKey/revoke/{apiKeyId}` |
| **operationId** | `deleteApiKey` |
| **Headers** | `apikey: <YOUR_API_KEY>` |
| **Request body** | **None** — no `requestBody` is defined |

**Path parameter:**

| Name | In | Required | Type | Description |
|---|---|---|---|---|
| `apiKeyId` | path | yes | string | "The ID of the API key to delete" (this is `data.key.id` from §2.1) |

**Success response `200`:**

```json
{ "type": "object", "properties": { "message": { "type": "string", "example": "API key revoked successfully" } } }
```

**Documented error codes:** `400` Bad request (`{"message":"Bad Request"}`), `401` Unauthorized
(description only), `404` API key not found (description only), `500` Server error (description only).

### 2.3 Not documented for API keys

The following are **absent from the live specs** — do not assume them: key **scopes/permissions**,
key **expiry/TTL**, any key **format/pattern** constraint, per-key **rate limits**, a **list-keys** endpoint,
and any **subscription** requirement. There is a *create* and a *revoke* operation, and nothing else.
---

## 3. Chat & Agent Tools API

All 10 operations declare **`servers[0].url = "https://api.on-demand.io"`**, share
`info.title: "Chat API"`, `info.version: "1.0.0"`, `info.description: "API to manage chat sessions and queries"`,
and use the same security scheme:

```json
{ "apikey": { "type": "apiKey", "in": "header", "name": "apikey" } }
```

### 3.0 Error model — wildcards only

None of the 10 chat specs enumerate individual status codes. Each operation declares only `4XX` and `5XX`:

```json
{
  "4XX": { "description": "Client-side error", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ClientErrorResponse" } } } },
  "5XX": { "description": "Server-side Error", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ServerErrorResponse" } } } }
}
```

Both resolve to the same shape:

```json
{ "type": "object", "properties": {
    "errorCode": { "type": "string", "description": "Application-specific error code", "example": "invalid_request" },
    "message":   { "type": "string", "description": "Human-readable error message", "example": "Invalid request parameters" } } }
```

The concrete code list lives on the narrative Errors page, reproduced in §8.

### 3.1 (a) Create Chat Session

| | |
|---|---|
| **Method + path** | `POST /chat/v1/sessions` |
| **Full URL** | `https://api.on-demand.io/chat/v1/sessions` |
| **operationId** | `createChatSession` |
| **Summary / description** | "Create Chat Session" / "Create a new chat session" |
| **Headers** | `apikey: <YOUR_API_KEY>`, `Content-Type: application/json` |
| **Parameters** | None |

**Request body schema (verbatim):**

```json
{
  "type": "object",
  "required": ["externalUserId"],
  "properties": {
    "externalUserId": {
      "type": "string",
      "description": "An identifier of the external user creating this chat session.  This user is external to OnDemand but internal to your own system  which can be used for filtering sessions and auditing. If not managing  chat users internally, use any unique string."
    },
    "pluginIds": {
      "type": "array",
      "description": "A list of plugin IDs to be used in the chat session. A maximum of 20 plugins are allowed. This list can be empty. if set here and not  overwriiten through `/query` endpoint, then these plugins will be used  for all queries in this session.",
      "maxItems": 20,
      "items": { "type": "string" }
    }
  }
}
```

| Field | Type | Required | Constraint | Meaning |
|---|---|---|---|---|
| `externalUserId` | string | **yes** | — | Your own user identifier; any unique string is acceptable |
| `pluginIds` | array of string | no | `maxItems: 20` | **This is where your custom tool ID goes.** Session-level default, overridable per query |

> **`agentIds`, `contextMetadata` and `reasoningMode` do not appear anywhere in this spec.** See §3.6 for
> the important divergence between the OpenAPI spec and the narrative docs on this point.

**Success response `200`** — `{ message, data }` where `data` is `ChatSession`:

```json
{
  "type": "object",
  "properties": {
    "id":             { "type": "string", "example": "662a0a7c4fe356d0a3aa60d3", "description": "ID of chat session" },
    "companyId":      { "type": "string", "example": "6629c6bb4733922ce5efc543", "description": "ID of the company linked to chat session" },
    "externalUserId": { "type": "string", "example": "06931013-9ae4-449d-87e8-4224508ba0d0", "description": "ID of the external user" },
    "pluginIds":      { "type": "array", "items": { "type": "string", "example": "plugin-1813954526", "description": "ID of plugin" }, "description": "List of plugins associated with the chat session" },
    "title":          { "type": "string", "example": "Latest news about Afghanistan", "description": "A short user-friendly title for the chat session. It is automatically generated by  OnDemand when the first query is submitted in the session. If not generated yet, it  will be empty" },
    "createdBy":      { "type": "string", "example": "6629c6bb4733922ce5efc544", "description": "ID of the company user created the chat session" },
    "createdAt":      { "type": "string", "example": "2024-04-25T07:47:08.201467423Z", "description": "Timestamp when the chat session was created" },
    "updatedAt":      { "type": "string", "example": "2024-04-25T07:47:08.201467477Z", "description": "Timestamp when the chat session was last updated" }
  }
}
```

> ⚠️ **Field-name trap — read `data.id`, not `data.sessionId`.** The create-session response identifies the
> session as **`data.id`**. There is **no `data.sessionId` field** on this response. But the *submit-query*
> response (§3.2) returns **`data.sessionId`**. Mapping code that assumes one name for both will break.

| Operation | Field holding the session ID |
|---|---|
| `createChatSession`, `getChatSession` | `data.id` |
| `getChatSessions` | `data[].id` |
| `submitQuery` | `data.sessionId` (plus `data.messageId`) |
| `getChatMessages` / `getChatMessage` | `data[].sessionId` / `data.sessionId` (message's own ID is `id`) |

### 3.2 (b) Use Agent Tools & Submit Query

This is the operation the categories index titles **"Use Agent Tools & Submit Query"** — invoking your
custom tool happens here.

| | |
|---|---|
| **Method + path** | `POST /chat/v1/sessions/{sessionId}/query` |
| **Full URL** | `https://api.on-demand.io/chat/v1/sessions/{sessionId}/query` |
| **operationId** | `submitQuery` |
| **Summary / description** | "Submit Query" / "Submit a query to a chat session for processing" |
| **Headers** | `apikey: <YOUR_API_KEY>`, `Content-Type: application/json` |

**Path parameter:** `sessionId` (string, **required**) — "ID of the session linked to this query".

**Request body — required fields:** `query`, `endpointId`, `responseMode`.

| Field | Type | Required | Default | Enum / constraint | Description (verbatim where quoted) |
|---|---|---|---|---|---|
| `query` | string | **yes** | — | — | "Actual query" |
| `endpointId` | string | **yes** | — | example `predefined-openai-gpt4o` | "Endpoint ID of the fulfillment model selected to fulffil query. This can be a predefined, BYOI or BYOM model endpoint." *(typo verbatim)* |
| `responseMode` | string | **yes** | — | `sync` \| `stream` \| `webhook` | "Response mode to get the query answer" |
| `pluginIds` | array of string | no | — | `maxItems: 20` | **Your custom tool IDs go here** — see verbatim text below |
| `fulfillmentOnly` | boolean | no | `false` | — | "If set to true, skips the RAG and only executes the fulfillment even if `pluginIds` parameter is set at any level." |
| `modelConfigs` | object | no | — | — | "Sets fulfillment model configuration." |
| `modelConfigs.fulfillmentPrompt` | string | no | — | — | "Prompt providing instructions that guide the model's approach to fulfilling the user's query." |
| `modelConfigs.stopSequences` | array of string | no | — | up to 4 | "Up to 4 sequences where the API will stop generating further tokens." |
| `modelConfigs.temperature` | number (float) | no | `0.7` | 0–2 | Sampling temperature |
| `modelConfigs.topP` | number (float) | no | `1` | 0–1 | Nucleus sampling |
| `modelConfigs.presencePenalty` | number (float) | no | `0` | 0–2 | Penalises tokens already present |
| `modelConfigs.frequencyPenalty` | number (float) | no | `0` | 0–2 | Penalises tokens by frequency |

**The `pluginIds` description, verbatim — this is the precedence rule you must design around:**

> "A list of plugin IDs to be made accessible to RAG to answer the query. A maximum of  20 plugins are
> allowed. This list can be empty. If specified, it will replace the  plugin IDs set during session
> creation. If not specified or left empty, the plugin  IDs set during session creation will be utilized.
> If not specified at any level,  the system will bypass the RAG and proceed directly to execute the
> fulfillment."

Precedence, restated:

1. `pluginIds` on the **query** → replaces the session list entirely (not merged).
2. Omitted/empty on the query → the **session's** `pluginIds` are used.
3. Absent at both levels → **RAG is bypassed**; the model answers with no tool access. *This is the single
   most common cause of "my custom tool was never called."*
4. `fulfillmentOnly: true` → skips RAG *even when* `pluginIds` is set.

**Success response `200` (description: "Sync Mode Response"):**

```json
{
  "type": "object",
  "properties": {
    "message": { "type": "string", "example": "Chat query submitted successfully" },
    "data": {
      "type": "object",
      "properties": {
        "sessionId": { "type": "string", "example": "668659ddf566ac1d5a44a4ea", "description": "ID of chat session" },
        "messageId": { "type": "string", "example": "668659eaf566ac1d5a44a4eb", "description": "ID of the chat message" },
        "answer":    { "type": "string", "description": "Answer to the query" },
        "status":    { "type": "string", "enum": ["processing", "completed", "failed"], "example": "completed", "description": "Current status of the chat message" }
      }
    }
  }
}
```

Only this one `200` schema is documented — there is **no separate documented response body for `stream` or
`webhook` mode** in the OpenAPI spec. The SSE wire format comes from the narrative docs (§3.5).

### 3.3 (c) Get sessions, get messages

| Operation | Method + path | Key parameters | Response ID field |
|---|---|---|---|
| Get All Chat Sessions | `GET /chat/v1/sessions` | `externalUserId`, `sort` (`asc`\|`desc`, default `desc`), `cursor`, `limit` (int32, default `10`, min 1, max 50) | `data[].id` + `pagination` |
| Get Chat Session | `GET /chat/v1/sessions/{sessionId}` | path `sessionId` | `data.id` |
| Get Chat Messages | `GET /chat/v1/sessions/{sessionId}/messages` | path `sessionId`; query `externalUserId`, `sort`, `cursor`, `limit` | `data[]` + `pagination` |
| Get Chat Message | `GET /chat/v1/sessions/{sessionId}/messages/{messageId}` | path `sessionId`, `messageId` | `data` |

**`Pagination` schema:**

```json
{ "type": "object", "properties": {
    "next":  { "type": "string", "example": "6629c6bb4733923ce5efc529", "description": "The cursor for fetching the next set of results. If there are no more results available, this field  will be an empty string." },
    "limit": { "type": "integer", "example": 10, "description": "Limit set for the current request" } } }
```

**`ChatMessage` schema** — the audit record proving whether your tool was actually attached:

| Field | Type | Notes |
|---|---|---|
| `id` | string | ID of the chat message |
| `sessionId` | string | Parent session |
| `companyId` | string | Company linked to the session |
| `externalUserId` | string | Your external user ID |
| `pluginIds` | array of string | **Plugins associated with this message** — example item `plugin-1813954526` |
| `endpointId` | string | Fulfillment endpoint used, e.g. `predefined-openai-gpt4o` |
| `responseMode` | string | enum `sync` \| `stream` \| `webhook` |
| `status` | string | enum `processing` \| `completed` \| `failed` |
| `type` | string | enum `text` \| `media` |
| `media` | object | Only when type is `media`: `{id, name, source, url, context}`; `source` enum `document`\|`video`\|`audio`\|`youtube`\|`image` |
| `query` / `answer` | string | Only when type is `text` |
| `createdBy`, `createdAt`, `updatedAt` | string | Audit fields |

> Verbatim spec oddity, reported as published: the `media.source` **example value is misspelled `"doucment"`**.

**Debugging tip:** after a query, `GET /chat/v1/sessions/{sessionId}/messages` and inspect
`data[].pluginIds`. If your `plugin-…` ID is absent there, it was never attached and the model could not
have called your tool.

### 3.4 (c cont.) Chat batches

| Operation | Method + path | Notes |
|---|---|---|
| Create Chat Batch | `POST /chat/v1/batches` | **`multipart/form-data`** — required `name` (string) and `file` (binary JSONL, one query per line). Max **50 MB**, max **1000 queries**. Template: `https://devpoc-f8fbhndjezesfcax.a03.azurefd.net/templates/batch-template.jsonl` |
| Get Chat Batches | `GET /chat/v1/batches` | Query `status` (`processing`\|`completed`\|`failed`), `search`, `sort`, `cursor`, `limit` |
| Get Chat Batch | `GET /chat/v1/batches/{batchId}` | Returns `ChatBatch` |
| Delete Chat Batch | `DELETE /chat/v1/batches/{batchId}` | Returns `{ message }` only — **no `data` property** |

`createChatBatch` `200` returns `data.batchId`, `data.status` ("Always “processing” on creation"), and
`data.totalQueries`.

`ChatBatch` fields: `id`, `companyId`, `name`, `status` (enum `processing`\|`completed`\|`failed`),
`fileUrl` (uri), `resultsFileUrl` (uri), `processingAt`, `completedAt`, `failedAt` (nullable),
`requestMetrics{total, completed, failed}`, `metadata` (object, nullable, shape not documented),
`createdBy`, `createdAt`, `updatedAt`.

> Verbatim spec oddity: the **GET** `/chat/v1/batches/{batchId}` success `message` example literally reads
> `"Chat batch deleted successfully"` — a copy/paste artefact in the published spec, quoted uncorrected.

### 3.5 Streaming (SSE) wire format — from the narrative docs

Not in the OpenAPI spec; documented at `https://docs.on-demand.io/docs/query-and-responses-modes.md`.
With `responseMode: "stream"` the response is Server-Sent Events:

```text
event:message
data:{"sessionId":"...","messageId":"...","eventIndex":1,"eventType":"statusLog","status":"processing","currentStatusLog":{...}}
```

**Event data fields:** `sessionId`, `messageId`, `eventType` (enum **`statusLog`**, **`metricsLog`**,
**`fulfillment`**), `eventIndex` (starts at 1 per event type; use it to re-order out-of-sequence chunks),
`currentStatusLog` (object), `answer` (string — **set only when `eventType` is `fulfillment`**; append
successive chunks), `status`.

**`statusType` values observed in the documented sample** (inside `currentStatusLog`) — these are your
tool-execution trace: `analyzing` → `plan_created` → `reanalyzing` → `agents_retrieved` → `executing` →
`execution_completed` → `fulfilling` → `fulfillment_completed`. The `agents_retrieved` /
`execution_completed` events carry `retrievedAgents[]` / `executedAgents[]` arrays containing
`{agentId, name, identifier, url, method, statusCode}` — **this is where you confirm your Blender bridge was
actually invoked, with which URL and what HTTP status.**

**Keep-alive:** `event:heartbeat` with `data:{"sessionId":..., "messageId":..., "time":...}`. Contains no
model output; safe to ignore.

**Termination:** `event:message` / `data:[DONE]` — the connection closes after this.

**Stream errors:** `event:message` / `data:[ERROR]:<json>`. Detect by testing whether the data string starts
with `[ERROR]:`, then parse the remainder into `{ "message": ..., "errorCode": ... }`. Example:
`[ERROR]:{"message":"Model context length exceeded","errorCode":"context_length_exceeded"}`.

**Webhook mode:** with `responseMode: "webhook"` the response is POSTed to a URL configured in the dashboard
at `https://app.on-demand.io/settings/webhooks` (endpoint URL, webhook secret, success response codes, retry
mechanism — exponential or sequential). **No webhook configuration object exists in the query request body**;
the only reference in the spec is the `"webhook"` enum value.

### 3.6 ⚠️ Spec-vs-docs divergence you must plan for: `pluginIds` vs `agentIds`

This is a genuine, material inconsistency in OnDemand's own live documentation, and it directly affects how
you wire a custom tool. Reporting both sides exactly:

| Source (all fetched live) | Field used to pass tools | ID format shown |
|---|---|---|
| OpenAPI spec `submitquery` | **`pluginIds`** only | `plugin-1813954526` |
| OpenAPI spec `createchatsession` | **`pluginIds`** only | `plugin-1813954526` |
| OpenAPI `ChatSession` / `ChatMessage` schemas | **`pluginIds`** | `plugin-1813954526` |
| Narrative `docs/query-and-responses-modes.md` samples | **`agentIds`** | `agent-1713924030`, `agent-1714419354` |
| Narrative `docs/plugin-api.md` (list endpoint) | `pluginIds` query param | `plugin-1716806012` |

Likewise, the narrative samples include a top-level **`reasoningMode`** field (values `"grok-4-fast"` and
`"low"` appear) that is **entirely absent from the OpenAPI spec**.

**Recommendation:** treat **`pluginIds` as authoritative** — it is what the machine-readable contract
defines, and it matches the ID prefix (`plugin-`) returned by the plugin-list endpoint. The platform has
evidently renamed "plugins" to "agents" in the UI/narrative layer (the docs sidebar now reads "Agents", and
`docs/what-are-plugins.md` renders as "What are Agents ?") while the API layer still uses `plugin*`. If a
call using `pluginIds` does not attach your tool, retry with `agentIds` as a documented fallback — but
verify via `GET /chat/v1/sessions/{sessionId}/messages` which field actually took effect. Do not send both
without testing.
---

## 4. Agents Flow Builder API

All four operations share `info.title: "Agents Flow Builder API"`, `info.version: **1.2.0**`,
`info.description: "API for managing automation workflows, execution, and streaming logs"`, and declare

**`servers[0].url = "https://api.on-demand.io/automation/api"`**

Auth on all four (declared top-level and, for `stream_logs`, again at operation level):

```json
{ "ApiKeyAuth": { "type": "apiKey", "in": "header", "name": "apikey" } }
```

> **Path-parameter naming:** the activate/deactivate/execute operations use **`{id}`** — *not*
> `{workflowId}`. Copy the path exactly.

### 4.1 Activate Workflow

| | |
|---|---|
| **Method + path** | `POST /workflow/{id}/activate` |
| **Full URL** | `https://api.on-demand.io/automation/api/workflow/{id}/activate` |
| **Summary** | "Activate workflow" |
| **Path param** | `id` (string, required). No description/example documented. |
| **Request body** | **None** — no `requestBody` key present |
| **Responses** | `200` "Workflow activated successfully" (no body schema documented); `500` "Server error" |

No `400`/`401`/`404` documented for this operation.

### 4.2 Deactivate Workflow

| | |
|---|---|
| **Method + path** | `POST /workflow/{id}/deactivate` |
| **Full URL** | `https://api.on-demand.io/automation/api/workflow/{id}/deactivate` |
| **Summary** | "Deactivate workflow" |
| **Path param** | `id` (string, required) |
| **Request body** | **None** |
| **Responses** | `200` "Workflow deactivated successfully" (no body schema documented); `500` "Server error" |

### 4.3 Execute Workflow

| | |
|---|---|
| **Method + path** | `POST /workflow/{id}/execute` |
| **Full URL** | `https://api.on-demand.io/automation/api/workflow/{id}/execute` |
| **Summary** | "Execute workflow" |
| **Path param** | `id` (string, required) |
| **Request body** | **None documented** — the spec defines no input payload; only the `id` path parameter |

**Success `200` — "Workflow execution started":**

```json
{ "type": "object", "properties": { "executionID": { "type": "string" } } }
```

**Documented errors:**

| Status | Description (verbatim) |
|---|---|
| `400` | `Invalid request or workflow inactive` |
| `404` | `Workflow not found` |
| `500` | `Server error` |

The `400` text confirms the ordering requirement: **activate before you execute.**

> ⚠️ **Not documented:** there is no documented way to pass runtime input/variables into
> `POST /workflow/{id}/execute` — the spec defines no request body. Workflow inputs must therefore be
> configured on the workflow itself. (The narrative docs list `createworkflow`/`updateworkflow` reference
> pages, but those slugs are **not** in the public categories index fetched here.)

### 4.4 Stream Workflow Logs

| | |
|---|---|
| **Method + path** | `POST /workflow/stream_logs` |
| **Full URL** | `https://api.on-demand.io/automation/api/workflow/stream_logs` |
| **operationId** | `streamWorkflowLogs` |
| **Summary** | "Stream workflow execution logs" |
| **Parameters** | **None** — no path or query parameters; the execution ID goes in the **body** |

**Request body (`required: true`, `application/json`):**

```json
{
  "type": "object",
  "required": ["executionID"],
  "properties": {
    "executionID": { "type": "string", "description": "Execution ID returned from workflow execute API" }
  }
}
```

**Success `200` — "Streaming logs for workflow execution".** Declared content type is
**`application/json`** and the schema is an **array** of `StreamEvent`:

```json
{
  "type": "object",
  "required": ["event_type"],
  "properties": {
    "event_type":   { "type": "string", "enum": ["log", "output"], "description": "Type of streamed event" },
    "execution_id": { "type": "string" },
    "workflow_id":  { "type": "string" },
    "message":      { "type": "string" },
    "timestamp":    { "type": "string", "format": "date-time" }
  }
}
```

**Documented errors:** `400` "Invalid execution ID", `404` "Execution not found", `500` "Server error".

> ⚠️ **Flagged:** despite the name "Stream", the published contract declares `application/json` returning a
> **single JSON array** — **`text/event-stream` is not documented**, no SSE framing (`event:`/`data:`) is
> specified, and **no termination condition is documented**. Note also the casing inconsistency, exactly as
> published: the request body field is **`executionID`** (camel, capital ID) while the response field is
> **`execution_id`** (snake). Handle both spellings defensively.

**Ordering:** `activate` → `execute` (capture `executionID`) → `stream_logs` with that value.

---

## 5. Registering a custom MCP server / custom tool — step by step

### 5.1 What exists, what does not

| Capability | Status in the live public docs |
|---|---|
| Native **MCP server registration** (submit an MCP endpoint / `server.json` / stdio command) | ❌ **Does not exist.** `mcp` appears **0 times** in all 28 OpenAPI specs and 0 times in `llms.txt` |
| MCP transport support (stdio, SSE, Streamable HTTP), `tools/list`, `tools/call` proxying | ❌ Not documented anywhere |
| **Custom tool/plugin creation via API** | ⚠️ **Yes — but the spec is UNLISTED.** `POST /plugin/v1`, doc slug `createplugin`, HTTP 200 |
| **Custom tool/plugin deletion via API** | ⚠️ Yes, unlisted. `DELETE /plugin/v1/{pluginId}`, slug `deleteplugin`, HTTP 200 |
| **List plugins / discover your `pluginId`** | ✅ `GET /plugin/v1/list` — documented on the narrative page `docs/plugin-api.md` (no OpenAPI spec slug) |
| Custom tool creation **via the console UI** | ✅ Documented at `docs/rest-based-plugins.md` (My Agents → Create Agents) |
| Passing a tool ID into a session/query | ✅ `pluginIds` (§3) |
| Multi-step orchestration | ✅ Agents Flow Builder (§4) |

> **Important qualification on `createplugin`/`deleteplugin`.** These two specs return HTTP 200 from the
> live documentation API and are fully machine-readable, but they are **not listed in the
> `/config/v1/public/docs/categories` index**, and they do not appear in `llms.txt`. They are real published
> specs, reachable only if you already know the slug. Treat them as **semi-public / possibly unstable**, and
> prefer the console UI flow for a first integration. Everything below is quoted from the fetched spec — no
> field is invented.

### 5.2 Where the tool JSON schema is declared

**`action.schema`** in the `POST /plugin/v1` body. Critically — per the fetched spec — its type is:

```json
{ "schema": { "type": "string", "description": "OpenAPI schema for the plugin" } }
```

It is a **string**, not a nested object. You must **JSON-stringify your entire OpenAPI document** and place
the resulting string in that field. (Verified: the payload in §5.6 round-trips back to a byte-identical spec.)

**The tool contract is an OpenAPI 3.0 document, not an MCP tool descriptor.** The mapping is:

| MCP tool concept | OnDemand equivalent |
|---|---|
| `name` | `operationId` on the OpenAPI operation |
| `description` | `summary` + `description` on the operation |
| `inputSchema` (JSON Schema) | `parameters[]` + `requestBody.content.application/json.schema` |
| *(output — MCP `outputSchema`)* | `responses.200.content.application/json.schema` |
| Server endpoint | `servers[].url` in the schema |
| Auth | `components.securitySchemes` + the plugin's `action.authentication` / `action.fields` |

### 5.3 Full `POST /plugin/v1` request contract (verbatim from the spec)

**Host:** `https://gateway-dev.on-demand.io` (as declared; see §0.4)
**Path/method:** `POST /plugin/v1` · **operationId:** `createPlugin` · **Auth:** `apikey` header

**Required fields (13):** `name`, `identifier`, `description`, `category`, `logoUrl`, `type`, `source`,
`status`, `fileSubType`, `chatSubType`, `privacyPolicy`, `action`, `creatorPluginConfig`.

| Field | Type | Required | Spec description |
|---|---|---|---|
| `name` | string | ✅ | "Name of the plugin" |
| `identifier` | string | ✅ | "Identifier for the plugin" |
| `description` | string | ✅ | "Description of the plugin" |
| `category` | string | ✅ | "Category of the plugin" |
| `conversationStarters` | string (nullable) | ❌ | "Conversation starters for the plugin" |
| `logoUrl` | string (uri) | ✅ | "URL for the plugin's logo" |
| `type` | string | ✅ | "Type of the plugin" |
| `source` | string | ✅ | "Source of the plugin" |
| `status` | string | ✅ | "Status of the plugin" |
| `fileSubType` | string | ✅ | "Subtype of the plugin file" |
| `chatSubType` | string | ✅ | "Subtype of the chat" |
| `privacyPolicy` | string (uri) | ✅ | "URL of the privacy policy" |
| `action` | object | ✅ | Container for auth, config fields and the schema |
| `action.authentication.type` | string | — | "Authentication type" |
| `action.fields[]` | array of object | — | Each: `key` ("Key for the field"), `site` ("Site for the field"), `required` (boolean), `editable` (boolean) |
| `action.schema` | **string** | — | **"OpenAPI schema for the plugin"** |
| `creatorPluginConfig` | object | ✅ | `active` (boolean, "Whether the plugin is active") + `fields` (object, `additionalProperties: string`) |

**Responses:** `200` "Plugin created successfully", `400` "Invalid request", `401` "Unauthorized access",
`500` "Server error".

> ⚠️ **Critical gap:** the `200` response has **no documented body schema** — the spec gives a description
> only. **The `pluginId` is therefore not documented as being returned by the create call.** Do not write
> code that assumes `response.data.pluginId` exists. Retrieve the ID with the list endpoint instead (§5.4).

**Enum values are not enumerated in the spec.** `identifier`, `type`, `source`, `status`, `category`,
`fileSubType`, `chatSubType` are all plain strings with no `enum`. The only concrete values published
anywhere live are the ones in the sample response of `docs/plugin-api.md`:

```json
{
  "identifier": "rest_api", "type": "chat", "source": "external", "status": "private",
  "category": "education", "fileSubType": "PRIMARYINGEST", "chatSubType": "PRIMARYCHAT"
}
```

Those are the values used in the worked example below. Category options listed on
`docs/rest-based-plugins.md`: Education, Sports, Travel, Writing, Research, Lifestyle, Programming,
Astrology, Health, News, Food, Music, Gaming, Finance.

### 5.4 How you obtain the `pluginId`

From `https://docs.on-demand.io/docs/plugin-api.md` ("Agents API"):

| | |
|---|---|
| **Method + path** | `GET /plugin/v1/list` |
| **Query params** | `pluginIds` (comma-separated, optional), `page` (int, optional), `limit` (int, optional) |
| **Headers** | `apikey: <YOUR_API_KEY>` |

**Sample `200` response (verbatim from the docs):**

```json
{
  "message": "Plugin list fetched successfully",
  "page": 1,
  "limit": 100,
  "data": {
    "plugins": [
      {
        "id": "1234567890abcdef12345678",
        "name": "Sample Plugin",
        "identifier": "rest_api",
        "description": "A sample plugin description",
        "category": "education",
        "conversationStarters": null,
        "logoUrl": "https://example.com/sample_logo.png",
        "type": "chat",
        "source": "external",
        "status": "private",
        "pluginId": "plugin-1234567890",
        "companyId": "company-1234567890",
        "fileSubType": "PRIMARYINGEST",
        "chatSubType": "PRIMARYCHAT",
        "privacyPolicy": "https://example.com/privacy_policy",
        "createdAt": "2024-06-08T18:40:12.917Z",
        "updatedAt": "2024-06-08T18:41:29.614Z"
      }
    ]
  }
}
```

**Two different identifiers — do not confuse them:**

| Field | Example | Use |
|---|---|---|
| `id` | `1234567890abcdef12345678` | Internal Mongo-style record ID |
| **`pluginId`** | **`plugin-1234567890`** | **The value you put in `pluginIds`** |

There is also a documented **`206 Partial Success`** whose `message` reads
`"plugin-1717872339: plugin subscription not active"` — a partial result meaning one requested plugin exists
but is not subscribed. Always check `message` on a 206, not just the HTTP status.

### 5.5 The end-to-end wiring sequence

1. **Build the bridge.** Expose your MCP server's tools over HTTPS (§6). MCP stdio/TCP cannot be called by OnDemand.
2. **Write the OpenAPI 3.0 schema** describing the bridge — one operation per tool, each with an
   `operationId`, a `summary`, a `description`, and fully-described parameters/bodies. Follow
   `docs/open-api-schema.md`: define `openapi`, `info`, `servers`, `paths`, `components.schemas`,
   `components.securitySchemes`, `security`.
3. **Register the plugin** — either the console UI (My Agents → Create Agents → import/paste the schema),
   or `POST /plugin/v1` with the schema **JSON-stringified into `action.schema`**.
4. **Retrieve the `pluginId`** via `GET /plugin/v1/list` (§5.4). Expect `plugin-<digits>`.
5. **Create a session** — `POST /chat/v1/sessions` with `externalUserId` and, optionally,
   `pluginIds: ["plugin-…"]`. Read the session ID from **`data.id`**.
6. **Submit a query** — `POST /chat/v1/sessions/{sessionId}/query` with `query`, `endpointId`,
   `responseMode`, and `pluginIds: ["plugin-…"]`. Remember: query-level `pluginIds` **replaces** the session
   list; omitting it at both levels **bypasses RAG entirely** and your tool will never fire.
7. **Verify** — `GET /chat/v1/sessions/{sessionId}/messages` and confirm your ID appears in
   `data[].pluginIds`; in stream mode, watch `statusType: agents_retrieved` / `execution_completed`.
8. *(Optional)* **Orchestrate** — build a workflow, then `activate` → `execute` → `stream_logs` (§4).

### 5.6 Publishing rules (from `docs/rules-to-publish-a-rest-api-plugin.md`)

Required only if you publish to the marketplace; private plugins still benefit from following them:

- **OpenAPI schema** must be non-empty and valid.
- **Schema size ≤ 5 MB.**
- **≤ 10 operations** in the schema.
- **Every operation, parameter and field must have a relevant description.**
- **≥ 2 conversation starters**, relevant to the agent.
- **Privacy policy** must be a valid URL.
- Name simple/clear; description brief.
- Automated validation, then human moderation — **up to 48 hours**.

The worked example in §7 was validated against all of these: 4 operations (≤10), 8,969 bytes (≤5 MB),
zero missing descriptions, and it passes formal `openapi-spec-validator` OpenAPI 3.0 validation.
---

## 6. Transport & exposure requirements (and the `execute_blender_code` risk)

### 6.1 Why a bridge is mandatory

`ahujasid/blender-mcp` (MIT, ~22.7k stars — `https://github.com/ahujasid/blender-mcp`) runs as
**two local processes**: the **Blender addon** (`addon.py`) opens a **TCP socket server on
`localhost:9876`**, and the **MCP server** (`src/blender_mcp/server.py`, launched with
`uvx blender-mcp` — registered as `claude mcp add blender uvx blender-mcp`) speaks **MCP over stdio**
to a local client such as Claude Desktop or Cursor. Prerequisites: **Blender 3.0+**, **Python 3.10+**,
and the **`uv`** package manager.

Neither transport is reachable by OnDemand:

| blender-mcp transport | Can OnDemand call it? | Why not |
|---|---|---|
| **stdio** (`uvx blender-mcp`) | ❌ | OnDemand is a hosted service; it cannot spawn a process on your machine |
| **raw TCP** `localhost:9876` | ❌ | Not HTTP, not TLS, not routable from the internet, bound to loopback |
| **HTTPS REST** (your bridge) | ✅ | The only shape a REST API Agent's OpenAPI schema can describe |

So you must run a small HTTPS service that accepts REST calls and forwards them as blender-mcp JSON
commands over the TCP socket. Options: a tunnel (ngrok/Cloudflare Tunnel) in front of a local wrapper for
development, or a hosted wrapper alongside a headless Blender (`blender --background`) for production.

Requirements the bridge must satisfy:

- **Public HTTPS with a valid certificate.** The `servers[].url` in your schema must be an absolute
  `https://` URL that OnDemand's servers can resolve. `localhost`, `127.0.0.1` and private RFC-1918
  addresses will never work.
- **Stable hostname.** A free-tier tunnel that rotates its subdomain silently breaks the plugin — you would
  have to re-register the schema each time.
- **Respond within the tool timeout.** Chat-API error `plugin_execution_timeout` (HTTP **504**) fires when
  *"any plugin execution times out. Plugin execution timeout is set to 2.5 minutes."* Long Blender renders
  must be made asynchronous (return a job ID, poll) rather than blocking the call.

### 6.2 Origin validation and auth header

The MCP specification requires servers to **validate the `Origin` header** to mitigate DNS-rebinding
attacks, and to bind to `localhost` only when running locally. Your bridge sits at exactly that boundary, so
enforce both:

1. **Keep the Blender socket on loopback.** The addon listens on `localhost:9876`; never bind it to
   `0.0.0.0`. Only the bridge — on the same host — connects to it.
2. **Validate `Origin`/`Host` on the bridge.** Reject requests carrying an unexpected `Origin`.
3. **Require a shared secret.** Declare an `apiKey` security scheme in the schema and a matching
   `action.fields[]` entry, so OnDemand injects the header on every call. In the example below this is
   `X-Bridge-Key`, declared with `"site": "header"`, `"required": true`, `"editable": false`.
4. **Set the secret as Creator Defined.** Per `docs/rest-based-plugins.md`, *Creator Defined* values are set
   by the author and shared across subscribers; *User Defined* values are supplied by each subscriber. Mark
   secrets **Masked** so they are hidden in the UI. In the API payload this is
   `creatorPluginConfig.fields`.
5. **Allow-list egress.** Restrict inbound traffic to OnDemand's callers where your infrastructure permits.

### 6.3 The `execute_blender_code` risk — read before enabling

`execute_blender_code` executes **arbitrary Python inside the Blender process, with no sandbox**. It is the
single most dangerous surface in this integration:

- Full `bpy` access *and* full Python: `os`, `subprocess`, `open()`, `socket`. It can read or destroy any
  file the Blender user can touch and open outbound connections.
- The upstream project has open issues covering exactly this: **arbitrary `exec()` with no sandbox**, and
  **weak file-path validation** in the screenshot / Hyper3D tools enabling **exfiltration** via tools that
  accept local paths.
- **Prompt injection becomes remote code execution.** Once this tool is attached to an agent, any text the
  model ingests — a user message, a web page fetched by another agent, an asset description — can attempt
  to steer it into running attacker-chosen Python. The LLM is the only thing standing between untrusted
  text and `exec()`.
- Upstream also ships **telemetry ON by default**, capturing **prompts, code and screenshots**, with an
  **open GDPR / opt-in issue** — a data-governance problem for confidential scene data. Disable it via
  preferences/env var.
- Known operational rough edges: **Poly Haven integration is erratic**, the **first command after connecting
  sometimes fails** (retry), and **complex scenes can hit timeouts**.

**Mitigations, in order of effectiveness:**

1. **Omit the `/exec` operation from the registered schema entirely.** If the tool is not in the OpenAPI
   document, the agent cannot call it. This is the correct default for anything user-facing. The four
   high-level operations cover most real work.
2. If you need it, keep it behind a **separate, unpublished plugin** used only by trusted internal
   operators, and return `403 code_execution_disabled` by default (the example schema documents that code).
3. **Run Blender in a disposable, network-isolated container** with no credentials mounted and no access to
   production storage.
4. **Allow-list, don't deny-list.** Permit a small set of known-safe operations rather than trying to filter
   dangerous ones — Python has too many escapes for a deny-list to hold.
5. **Log every executed snippet** with the session/message ID for audit.
6. Never combine `execute_blender_code` with agents that ingest untrusted web content in the same session.

> ⚠️ Marked as **not verifiable from the OnDemand live docs:** OnDemand publishes no sandboxing, egress
> filtering, or code-execution policy for REST API Agent calls. Assume none exists; all containment is your
> responsibility, on your side of the bridge.

---

## 7. Worked example — wiring a Blender MCP bridge as an OnDemand custom tool

Target: **`ahujasid/blender-mcp`** — **MIT** licence, **~22.7k stars**
(source: `https://github.com/ahujasid/blender-mcp`). Latest release **PyPI `blender-mcp` v1.5.6,
18 Mar 2026**; `addon.py` last touched **23 Jan 2026**. Prerequisites: **Blender 3.0+**, **Python 3.10+**,
and the **`uv` package manager**.

**Components (two processes).** A **Blender addon** (`addon.py`) running a **TCP socket server on
`localhost:9876`**, plus an **MCP server** (`src/blender_mcp/server.py`) speaking **MCP over stdio**.

**Features.** Two-way socket comms; object manipulation; material control; scene inspection; arbitrary
Python execution; viewport screenshots; **Poly Haven / Sketchfab / Hyper3D Rodin / Hunyuan3D** asset
support; anonymous telemetry.

**Correct registration command** (note: **no `--` separator**):

```bash
claude mcp add blender uvx blender-mcp
```

> ⚠️ **Advisories / risks.** `execute_blender_code` runs **arbitrary Python with NO sandbox** (full
> filesystem + `subprocess` access — a prompt-injection → RCE vector). **Weak file-path validation** in the
> screenshot / Hyper3D tools is an **exfiltration vector**. **Telemetry is ON by default**, capturing
> prompts, code and screenshots, with an **open GDPR/opt-in issue**. Operationally: **Poly Haven is
> erratic**, the **first command sometimes fails**, and **complex scenes can hit timeouts**.

### 7.1 The bridge (reference implementation)

A minimal wrapper translating REST → the blender-mcp TCP JSON protocol. Run it on the same host as Blender.

```python
# blender_bridge.py — HTTPS wrapper in front of the local blender-mcp TCP socket server.
import json, os, socket
from flask import Flask, request, jsonify

BLENDER_HOST = os.environ.get("BLENDER_HOST", "localhost")   # keep on loopback
BLENDER_PORT = int(os.environ.get("BLENDER_PORT", "9876"))   # blender-mcp addon default
BRIDGE_KEY   = os.environ["BRIDGE_KEY"]                      # shared secret from OnDemand
ALLOW_EXEC   = os.environ.get("ALLOW_EXEC", "false").lower() == "true"
ALLOWED_ORIGINS = {o for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o}

app = Flask(__name__)

def send_to_blender(command_type: str, params: dict, timeout: float = 120.0) -> dict:
    """Send one JSON command to the Blender addon socket and read the JSON reply."""
    payload = json.dumps({"type": command_type, "params": params}).encode()
    with socket.create_connection((BLENDER_HOST, BLENDER_PORT), timeout=timeout) as sock:
        sock.sendall(payload)
        chunks = []
        while True:
            chunk = sock.recv(8192)
            if not chunk:
                break
            chunks.append(chunk)
            try:                                  # the addon replies with one JSON object
                return json.loads(b"".join(chunks))
            except json.JSONDecodeError:
                continue                          # keep reading until it parses
    raise RuntimeError("no response from Blender socket server")

@app.before_request
def _guard():
    if request.headers.get("X-Bridge-Key") != BRIDGE_KEY:          # shared-secret auth
        return jsonify(message="Invalid bridge key", errorCode="unauthenticated"), 401
    origin = request.headers.get("Origin")                          # DNS-rebinding defence
    if ALLOWED_ORIGINS and origin and origin not in ALLOWED_ORIGINS:
        return jsonify(message="Origin not allowed", errorCode="forbidden_origin"), 403

@app.get("/v1/scene")
def get_scene_info():
    return jsonify(send_to_blender("get_scene_info", {}))

@app.post("/v1/objects")
def create_object():
    body = request.get_json(force=True) or {}
    if "type" not in body:
        return jsonify(message="'type' is required", errorCode="invalid_request"), 400
    return jsonify(send_to_blender("create_object", body))

@app.put("/v1/objects/<object_name>/material")
def set_material(object_name):
    body = dict(request.get_json(force=True) or {})
    body["object_name"] = object_name
    return jsonify(send_to_blender("set_material", body))

@app.post("/v1/exec")
def execute_blender_code():
    if not ALLOW_EXEC:                     # OFF by default — arbitrary Python, no sandbox
        return jsonify(message="Code execution disabled by bridge policy",
                       errorCode="code_execution_disabled"), 403
    body = request.get_json(force=True) or {}
    if "code" not in body:
        return jsonify(message="'code' is required", errorCode="invalid_request"), 400
    return jsonify(send_to_blender("execute_blender_code", {"code": body["code"]}))

@app.errorhandler(Exception)
def _unreachable(exc):
    return jsonify(message=f"Blender socket server unreachable on port {BLENDER_PORT}: {exc}",
                   errorCode="bridge_unreachable"), 502

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8080)   # put TLS (tunnel/reverse proxy) in front
```

Expose it over HTTPS, e.g. `cloudflared tunnel --url http://127.0.0.1:8080`, and use the resulting
`https://…` hostname as `servers[].url` in the schema.

### 7.2 The complete OpenAPI 3.0 tool schema

Covers **`get_scene_info`**, **`create_object`**, **`set_material`** and **`execute_blender_code`**.
Formally validated (`openapi-spec-validator`, OpenAPI 3.0) — 4 operations, 8,969 bytes, every operation,
parameter and property carries a description.

```json
{
  "openapi": "3.0.1",
  "info": {
    "title": "Blender MCP Bridge API",
    "description": "HTTP bridge in front of a local ahujasid/blender-mcp TCP socket server (default localhost:9876). Each operation maps 1:1 to a BlenderMCP JSON command and lets an OnDemand agent inspect and edit a live Blender scene.",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "https://blender-bridge.example.com/v1",
      "description": "Public HTTPS wrapper in front of the local Blender socket server"
    }
  ],
  "paths": {
    "/scene": {
      "get": {
        "summary": "Get current Blender scene information",
        "description": "Returns the active Blender scene: scene name, object count, and a list of objects with their name, type, location, rotation and scale. Call this first to discover what already exists before creating or modifying anything.",
        "operationId": "get_scene_info",
        "responses": {
          "200": {
            "description": "Scene information retrieved successfully",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SceneInfo"
                }
              }
            }
          },
          "502": {
            "description": "Blender socket server unreachable on port 9876",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/objects": {
      "post": {
        "summary": "Create a new object in the Blender scene",
        "description": "Creates a primitive mesh, light or camera in the active Blender scene at the given location, rotation and scale. Returns the name Blender assigned to the created object.",
        "operationId": "create_object",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateObjectInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Object created successfully",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ObjectRef"
                }
              }
            }
          },
          "400": {
            "description": "Invalid object type or malformed vector",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "502": {
            "description": "Blender socket server unreachable on port 9876",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/objects/{objectName}/material": {
      "put": {
        "summary": "Create or assign a material on an object",
        "description": "Creates or reuses a material and assigns it to the named object, setting its base colour, metallic and roughness values on the Principled BSDF shader.",
        "operationId": "set_material",
        "parameters": [
          {
            "name": "objectName",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Exact name of the target object in the Blender scene, e.g. 'Cube'.",
            "example": "Cube"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SetMaterialInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Material applied successfully",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/MaterialResult"
                }
              }
            }
          },
          "404": {
            "description": "Named object does not exist in the scene",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "502": {
            "description": "Blender socket server unreachable on port 9876",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/exec": {
      "post": {
        "summary": "Execute Python code inside Blender (DANGEROUS)",
        "description": "Executes an arbitrary Python snippet inside the running Blender process with full bpy access. There is no sandbox: the code runs with the privileges of the Blender process and can read and write the filesystem. Only enable this operation on a trusted, network-isolated bridge.",
        "operationId": "execute_blender_code",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ExecuteCodeInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Code executed; captured stdout returned",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ExecuteCodeResult"
                }
              }
            }
          },
          "400": {
            "description": "Python raised an exception inside Blender",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Code execution disabled by bridge policy",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "502": {
            "description": "Blender socket server unreachable on port 9876",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "Vector3": {
        "type": "array",
        "description": "A 3-component vector expressed as [x, y, z] in Blender world units.",
        "items": {
          "type": "number"
        },
        "minItems": 3,
        "maxItems": 3,
        "example": [
          0,
          0,
          0
        ]
      },
      "SceneInfo": {
        "type": "object",
        "description": "Summary of the active Blender scene.",
        "properties": {
          "scene_name": {
            "type": "string",
            "description": "Name of the active Blender scene.",
            "example": "Scene"
          },
          "object_count": {
            "type": "integer",
            "description": "Total number of objects in the scene.",
            "example": 3
          },
          "objects": {
            "type": "array",
            "description": "The objects currently present in the scene.",
            "items": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "description": "Unique object name in Blender.",
                  "example": "Cube"
                },
                "type": {
                  "type": "string",
                  "description": "Blender object type.",
                  "example": "MESH"
                },
                "location": {
                  "$ref": "#/components/schemas/Vector3"
                },
                "rotation": {
                  "$ref": "#/components/schemas/Vector3"
                },
                "scale": {
                  "$ref": "#/components/schemas/Vector3"
                }
              },
              "required": [
                "name",
                "type"
              ]
            }
          }
        },
        "required": [
          "scene_name",
          "object_count",
          "objects"
        ]
      },
      "CreateObjectInput": {
        "type": "object",
        "description": "Parameters describing the object to create.",
        "properties": {
          "type": {
            "type": "string",
            "description": "The primitive to create.",
            "enum": [
              "CUBE",
              "SPHERE",
              "CYLINDER",
              "PLANE",
              "CONE",
              "TORUS",
              "EMPTY",
              "CAMERA",
              "LIGHT"
            ],
            "example": "CUBE"
          },
          "name": {
            "type": "string",
            "description": "Optional name for the new object. Blender auto-names it when omitted.",
            "example": "HeroCube"
          },
          "location": {
            "$ref": "#/components/schemas/Vector3"
          },
          "rotation": {
            "$ref": "#/components/schemas/Vector3"
          },
          "scale": {
            "$ref": "#/components/schemas/Vector3"
          }
        },
        "required": [
          "type"
        ]
      },
      "ObjectRef": {
        "type": "object",
        "description": "Reference to an object that now exists in the scene.",
        "properties": {
          "name": {
            "type": "string",
            "description": "Name Blender assigned to the object.",
            "example": "HeroCube"
          },
          "type": {
            "type": "string",
            "description": "Blender object type.",
            "example": "MESH"
          },
          "location": {
            "$ref": "#/components/schemas/Vector3"
          }
        },
        "required": [
          "name"
        ]
      },
      "SetMaterialInput": {
        "type": "object",
        "description": "Material properties to apply to the target object.",
        "properties": {
          "material_name": {
            "type": "string",
            "description": "Name of the material to create or reuse.",
            "example": "RedMetal"
          },
          "color": {
            "type": "array",
            "description": "Base colour as [R, G, B] or [R, G, B, A], each channel 0.0-1.0.",
            "items": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "minItems": 3,
            "maxItems": 4,
            "example": [
              0.8,
              0.1,
              0.1,
              1.0
            ]
          },
          "metallic": {
            "type": "number",
            "description": "Metallic factor of the Principled BSDF, 0.0-1.0.",
            "minimum": 0,
            "maximum": 1,
            "default": 0,
            "example": 0.9
          },
          "roughness": {
            "type": "number",
            "description": "Roughness factor of the Principled BSDF, 0.0-1.0.",
            "minimum": 0,
            "maximum": 1,
            "default": 0.5,
            "example": 0.25
          }
        },
        "required": [
          "color"
        ]
      },
      "MaterialResult": {
        "type": "object",
        "description": "Result of a material assignment.",
        "properties": {
          "object_name": {
            "type": "string",
            "description": "Object the material was applied to.",
            "example": "Cube"
          },
          "material_name": {
            "type": "string",
            "description": "Material that is now assigned.",
            "example": "RedMetal"
          }
        },
        "required": [
          "object_name",
          "material_name"
        ]
      },
      "ExecuteCodeInput": {
        "type": "object",
        "description": "Python source to run inside Blender.",
        "properties": {
          "code": {
            "type": "string",
            "description": "Python source executed inside Blender with the bpy module in scope. Keep it short and side-effect aware.",
            "example": "import bpy\nprint(len(bpy.data.objects))"
          }
        },
        "required": [
          "code"
        ]
      },
      "ExecuteCodeResult": {
        "type": "object",
        "description": "Captured result of the executed Python snippet.",
        "properties": {
          "executed": {
            "type": "boolean",
            "description": "True when the snippet ran without raising.",
            "example": true
          },
          "result": {
            "type": "string",
            "description": "Captured stdout produced by the snippet.",
            "example": "3"
          }
        },
        "required": [
          "executed"
        ]
      },
      "Error": {
        "type": "object",
        "description": "Error payload returned by the bridge.",
        "properties": {
          "message": {
            "type": "string",
            "description": "Human-readable description of the failure.",
            "example": "Blender socket server unreachable on port 9876"
          },
          "errorCode": {
            "type": "string",
            "description": "Machine-parsable error code.",
            "example": "bridge_unreachable"
          }
        },
        "required": [
          "message"
        ]
      }
    },
    "securitySchemes": {
      "BridgeKey": {
        "type": "apiKey",
        "in": "header",
        "name": "X-Bridge-Key",
        "description": "Shared secret that the OnDemand agent sends on every bridge call."
      }
    }
  },
  "security": [
    {
      "BridgeKey": []
    }
  ]
}
```

**MCP-to-OpenAPI mapping for these four tools:**

| blender-mcp tool | OpenAPI operation | `operationId` | Input shape |
|---|---|---|---|
| `get_scene_info` | `GET /scene` | `get_scene_info` | none |
| `create_object` | `POST /objects` | `create_object` | `CreateObjectInput` — `type` (enum, required), `name`, `location`, `rotation`, `scale` |
| `set_material` | `PUT /objects/{objectName}/material` | `set_material` | path `objectName` + `SetMaterialInput` — `color` (required), `material_name`, `metallic`, `roughness` |
| `execute_blender_code` | `POST /exec` | `execute_blender_code` | `ExecuteCodeInput` — `code` (required) |

Additional blender-mcp tools you can add the same way (staying within the 10-operation publishing limit):
`get_object_info`, `modify_object`, `delete_object`, `get_viewport_screenshot` (upstream also names this
`get_blender_screenshot`), plus the Poly Haven / Sketchfab / Hyper3D-Rodin / Hunyuan3D asset tools.

> **Production advice:** ship a 3-operation schema (`get_scene_info`, `create_object`, `set_material`) and
> leave `/exec` out entirely. Add it only to a separate private plugin for trusted operators (§6.3).

### 7.3 Registering the plugin — `POST /plugin/v1`

The OpenAPI document from §7.2 is **JSON-stringified** into `action.schema` (the spec types that field as a
plain `string`). The `X-Bridge-Key` header is declared once in `action.fields[]` and given its value in
`creatorPluginConfig.fields`, so OnDemand attaches it to every bridge call.

```json
{
  "name": "Blender MCP Bridge",
  "identifier": "rest_api",
  "description": "Inspect and edit a live Blender scene through an HTTPS bridge in front of a local blender-mcp socket server.",
  "category": "programming",
  "conversationStarters": "What objects are currently in my Blender scene?",
  "logoUrl": "https://example.com/blender-bridge-logo.png",
  "type": "chat",
  "source": "external",
  "status": "private",
  "fileSubType": "PRIMARYINGEST",
  "chatSubType": "PRIMARYCHAT",
  "privacyPolicy": "https://example.com/privacy",
  "action": {
    "authentication": {
      "type": "apiKey"
    },
    "fields": [
      {
        "key": "X-Bridge-Key",
        "site": "header",
        "required": true,
        "editable": false
      }
    ],
    "schema": "<<< the ENTIRE OpenAPI document from 7.2, JSON-stringified into one string >>>"
  },
  "creatorPluginConfig": {
    "active": true,
    "fields": {
      "X-Bridge-Key": "<BRIDGE_SHARED_SECRET>"
    }
  }
}
```

**Registering via Python (recommended — it does the stringify for you):**

```python
import json, os, requests

PLUGIN_HOST = "https://gateway-dev.on-demand.io"   # host as declared in the createplugin spec (see 0.4)
API_KEY     = os.environ["ONDEMAND_API_KEY"]

with open("blender_openapi.json") as fh:
    openapi_schema = json.load(fh)                 # the document from 7.2

body = {
    "name": "Blender MCP Bridge",
    "identifier": "rest_api",
    "description": "Inspect and edit a live Blender scene through an HTTPS bridge "
                   "in front of a local blender-mcp socket server.",
    "category": "programming",
    "conversationStarters": "What objects are currently in my Blender scene?",
    "logoUrl": "https://example.com/blender-bridge-logo.png",
    "type": "chat",
    "source": "external",
    "status": "private",
    "fileSubType": "PRIMARYINGEST",
    "chatSubType": "PRIMARYCHAT",
    "privacyPolicy": "https://example.com/privacy",
    "action": {
        "authentication": {"type": "apiKey"},
        "fields": [
            {"key": "X-Bridge-Key", "site": "header", "required": True, "editable": False}
        ],
        # action.schema is typed as a STRING in the live spec -> stringify the whole document
        "schema": json.dumps(openapi_schema),
    },
    "creatorPluginConfig": {
        "active": True,
        "fields": {"X-Bridge-Key": os.environ["BRIDGE_SHARED_SECRET"]},
    },
}

resp = requests.post(f"{PLUGIN_HOST}/plugin/v1",
                     headers={"apikey": API_KEY, "Content-Type": "application/json"},
                     json=body, timeout=60)
print(resp.status_code, resp.text)
# NOTE: the 200 response has NO documented body schema -> do NOT assume a pluginId here.
```

**Then fetch the `pluginId`:**

```bash
curl -X GET 'https://api.on-demand.io/plugin/v1/list?limit=50' \
  -H 'apikey: <YOUR_API_KEY>'
```

```python
r = requests.get("https://api.on-demand.io/plugin/v1/list",
                 headers={"apikey": API_KEY}, params={"limit": 50}, timeout=30)
plugins = r.json()["data"]["plugins"]
blender = next(p for p in plugins if p["name"] == "Blender MCP Bridge")
PLUGIN_ID = blender["pluginId"]        # e.g. "plugin-1234567890"  <- use THIS, not blender["id"]
print(PLUGIN_ID)
```

**Console-UI alternative** (documented, listed, and the safer first path — `docs/rest-based-plugins.md`):
My Agents → **Create Agents** → define the API with the OpenAPI schema (paste, or *Import from URL*) →
add Configuration Fields (Key Name `X-Bridge-Key`, Key Type **Header**, Scope **Creator Defined**,
Required **True**, Masked **True**) → set Configuration Values → add the privacy policy → test → save. The
resulting agent exposes the same `plugin-…` ID via `GET /plugin/v1/list`.

**Deleting the plugin** (unlisted spec, verified HTTP 200):

```bash
curl -X DELETE 'https://gateway-dev.on-demand.io/plugin/v1/plugin-1234567890' \
  -H 'apikey: <YOUR_API_KEY>'
```

Documented responses: `200` "Plugin deleted successfully", `400`, `401` "Unauthorized access",
`404` "Plugin not found", `500`.

---

## 8. Copy-pasteable examples

Every URL below uses the host declared in that operation's own spec. Replace `<YOUR_API_KEY>` — never commit
a real key.

### 8.1 Generate an API key

```bash
curl -X POST 'https://gateway-dev.on-demand.io/user/v1/public/user/apiKey/create' \
  -H 'apikey: <YOUR_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "key": {
      "name": "Blender MCP bridge integration"
    }
  }'
```

```python
import os, requests

BASE = "https://gateway-dev.on-demand.io"          # as declared in the generateapikey spec
resp = requests.post(
    f"{BASE}/user/v1/public/user/apiKey/create",
    headers={"apikey": os.environ["ONDEMAND_API_KEY"], "Content-Type": "application/json"},
    json={"key": {"name": "Blender MCP bridge integration"}},
    timeout=30,
)
resp.raise_for_status()
key = resp.json()["data"]["key"]
new_secret = key["key"]        # shown once - store in a secrets manager immediately
key_id     = key["id"]         # keep this for revocation
print("created key id:", key_id, "status:", key["status"])
```

Revoke it later:

```bash
curl -X DELETE 'https://gateway-dev.on-demand.io/user/v1/public/user/apiKey/revoke/<API_KEY_ID>' \
  -H 'apikey: <YOUR_API_KEY>'
```

### 8.2 Create a chat session (with the custom tool attached)

```bash
curl -X POST 'https://api.on-demand.io/chat/v1/sessions' \
  -H 'apikey: <YOUR_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "externalUserId": "blender-user-001",
    "pluginIds": ["plugin-1234567890"]
  }'
```

```python
import os, requests

API   = "https://api.on-demand.io"
KEY   = os.environ["ONDEMAND_API_KEY"]
H     = {"apikey": KEY, "Content-Type": "application/json"}
PLUGIN_ID = "plugin-1234567890"          # from GET /plugin/v1/list

r = requests.post(f"{API}/chat/v1/sessions", headers=H,
                  json={"externalUserId": "blender-user-001", "pluginIds": [PLUGIN_ID]},
                  timeout=30)
r.raise_for_status()
session_id = r.json()["data"]["id"]      # <-- data.id, NOT data.sessionId
print("session:", session_id)
```

### 8.3 Submit a query using the custom tool (sync)

```bash
curl -X POST 'https://api.on-demand.io/chat/v1/sessions/<SESSION_ID>/query' \
  -H 'apikey: <YOUR_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "Inspect my Blender scene, then create a cube named HeroCube at [0,0,2] and give it a red metallic material.",
    "endpointId": "predefined-openai-gpt4o",
    "responseMode": "sync",
    "pluginIds": ["plugin-1234567890"],
    "modelConfigs": {
      "fulfillmentPrompt": "You control Blender through the bridge tool. Always call get_scene_info before mutating the scene.",
      "temperature": 0.2
    }
  }'
```

```python
payload = {
    "query": ("Inspect my Blender scene, then create a cube named HeroCube at [0,0,2] "
              "and give it a red metallic material."),
    "endpointId": "predefined-openai-gpt4o",
    "responseMode": "sync",
    "pluginIds": [PLUGIN_ID],            # replaces the session list; omit at BOTH levels and RAG is skipped
    "modelConfigs": {
        "fulfillmentPrompt": "You control Blender through the bridge tool. "
                             "Always call get_scene_info before mutating the scene.",
        "temperature": 0.2,
    },
}
r = requests.post(f"{API}/chat/v1/sessions/{session_id}/query",
                  headers=H, json=payload, timeout=180)   # tool timeout is 2.5 min
r.raise_for_status()
data = r.json()["data"]
print(data["status"], "->", data["answer"])   # data.sessionId / data.messageId also present
```

**Streaming variant** (`responseMode: "stream"`) — parse SSE and watch the tool actually execute:

```python
import json, requests

payload["responseMode"] = "stream"
answer = []
with requests.post(f"{API}/chat/v1/sessions/{session_id}/query",
                   headers=H, json=payload, stream=True, timeout=300) as resp:
    for raw in resp.iter_lines(decode_unicode=True):
        if not raw or not raw.startswith("data:"):
            continue                                  # skip 'event:' lines and keep-alives
        data = raw[len("data:"):].strip()
        if data == "[DONE]":
            break
        if data.startswith("[ERROR]:"):
            err = json.loads(data[len("[ERROR]:"):])
            raise RuntimeError(f"{err['errorCode']}: {err['message']}")
        evt = json.loads(data)
        if evt.get("eventType") == "fulfillment":
            answer.append(evt.get("answer", ""))       # append chunks in eventIndex order
        elif evt.get("eventType") == "statusLog":
            log = evt.get("currentStatusLog", {})
            # 'agents_retrieved' / 'execution_completed' prove the bridge was called
            print(log.get("statusType"), log.get("executedAgents") or "")
print("".join(answer))
```

**Verify the tool was attached:**

```bash
curl -X GET 'https://api.on-demand.io/chat/v1/sessions/<SESSION_ID>/messages?limit=5&sort=desc' \
  -H 'apikey: <YOUR_API_KEY>'
```

If your `plugin-…` ID is missing from `data[].pluginIds`, the tool was never in scope for that message.

### 8.4 Execute an Agents Flow Builder workflow

```bash
# 1) activate (400 'workflow inactive' on execute means you skipped this)
curl -X POST 'https://api.on-demand.io/automation/api/workflow/<WORKFLOW_ID>/activate' \
  -H 'apikey: <YOUR_API_KEY>'

# 2) execute -> returns executionID
curl -X POST 'https://api.on-demand.io/automation/api/workflow/<WORKFLOW_ID>/execute' \
  -H 'apikey: <YOUR_API_KEY>'

# 3) fetch logs (executionID goes in the BODY, not the query string)
curl -X POST 'https://api.on-demand.io/automation/api/workflow/stream_logs' \
  -H 'apikey: <YOUR_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{ "executionID": "<EXECUTION_ID>" }'

# 4) deactivate when finished
curl -X POST 'https://api.on-demand.io/automation/api/workflow/<WORKFLOW_ID>/deactivate' \
  -H 'apikey: <YOUR_API_KEY>'
```

```python
import os, requests

FLOW = "https://api.on-demand.io/automation/api"       # note the /automation/api prefix
H    = {"apikey": os.environ["ONDEMAND_API_KEY"], "Content-Type": "application/json"}
WORKFLOW_ID = "<WORKFLOW_ID>"

requests.post(f"{FLOW}/workflow/{WORKFLOW_ID}/activate", headers=H, timeout=30).raise_for_status()

r = requests.post(f"{FLOW}/workflow/{WORKFLOW_ID}/execute", headers=H, timeout=60)
r.raise_for_status()
execution_id = r.json()["executionID"]                 # camelCase 'executionID' on the way out

logs = requests.post(f"{FLOW}/workflow/stream_logs", headers=H,
                     json={"executionID": execution_id}, timeout=300)
logs.raise_for_status()
for event in logs.json():                              # documented as a JSON ARRAY, not SSE
    # response uses snake_case 'execution_id' while the request used 'executionID'
    print(event.get("timestamp"), event.get("event_type"), event.get("message"))

requests.post(f"{FLOW}/workflow/{WORKFLOW_ID}/deactivate", headers=H, timeout=30)
```

### 8.5 Discovering valid `endpointId` and reasoning-mode values

```bash
curl -X GET 'https://api.on-demand.io/config/v1/public/endpoints' -H 'apikey: <YOUR_API_KEY>'
curl -X GET 'https://api.on-demand.io/config/v1/public/entity_definition?entityId=reasoning_modes' \
  -H 'apikey: <YOUR_API_KEY>'
```

`GET /config/v1/public/endpoints` accepts an optional `type` query param ("Filter predefined endpoints by
type (e.g. on_demand)") and returns `{ message, endpointsData }`.
`GET /config/v1/public/entity_definition` requires `entityId` (use `reasoning_modes`) and returns
`{ entityId, groupId, definition }`.

Live values confirmed at fetch time — `endpoint_id` examples: `predefined-openai-gpt4o`,
`predefined-openai-gpt4o-mini`, `predefined-claude-sonnet-5`, `predefined-claude-4-5-sonnet`,
`predefined-gemini-3.5-flash`, `predefined-xai-grok4.5`, `predefined-deepseek-v3.2`. BYOI/BYOM endpoints
appear as `byoi-<uuid>` / `byom-<id>`. Predefined reasoning `modeId` values include `dynamic`, `gemini-3`,
`gemini-3-flash`, `gpt-5.4`, `gpt-5.4-pro`, `opus`, `haiku`, `kimi-k2`, `minimax-m2`, `grok-4-fast`,
`glm-4.7-flash`, `glm-5-turbo`, `deepseek-v3.1`; user-defined modes use a `byor-<uuid>` prefix.

---

## 9. Troubleshooting, limits and checklist

### 9.1 Error codes (from `https://docs.on-demand.io/reference/errors.md`)

Every error returns `{ "errorCode": "...", "message": "..." }`.

| HTTP | `errorCode` | Meaning |
|---|---|---|
| 400 | `invalid_request` | The payload or parameters are invalid |
| 401 | `unauthenticated` | Request made with an invalid or unknown token |
| 403 | `unauthorized` | User lacks permission for this action |
| 404 | `not_found` | Resource or route not found |
| 405 | `method_not_allowed` | Method not allowed |
| 429 | `rate_limit_exceeded` | Too many requests in a given period |
| 500 | `server_error` | Internal server error |
| 502 | `bad_gateway` | Gateway received an invalid response |
| 503 | `resource_unavailable` | Resource or service currently unavailable |

**Chat-API-specific codes — the first one matters most for a Blender bridge:**

| HTTP | `errorCode` | Meaning (verbatim) |
|---|---|---|
| **504** | **`plugin_execution_timeout`** | "Occurs when any plugin execution times out. Plugin execution timeout is set to **2.5 minutes**" |
| 400 | `context_length_exceeded` | Maximum context length for the LLM model exceeded |
| 500 | `model_error` | Unknown/unclassified LLM errors, incl. network errors or timeouts during model calls |

### 9.2 The "Please subscribe." 400 — where it actually comes from

The subscription error is documented on the **Services API** (`convertaudiototext`, `converttexttoaudio`,
`translatetext`), whose `400` is described as **"Invalid Request: Not subscribed to the service"** with this
verbatim example body:

```json
{ "message": "Please subscribe to the service to use it", "errorCode": "invalid_request" }
```

A closely-related, **plugin-specific** subscription signal appears on `GET /plugin/v1/list` as an
HTTP **`206 Partial Success`** whose message reads:

```json
{ "message": "plugin-1717872339: plugin subscription not active" }
```

**Diagnosis:** a `206` from the list endpoint, or a `400` mentioning subscription, means the plugin exists
but is not subscribed/active for your company — not that your ID is wrong. Subscribe/activate it (the API
payload field is `creatorPluginConfig.active`) and retry. Always read `message` on a `206`; the HTTP status
alone looks like success.

> Marked explicitly: **no "Please subscribe" text appears in any of the 10 Chat API specs.** The exact
> phrase is documented only for the Services API. Do not expect that literal string from `/chat/v1/...`.

### 9.3 Rate limits (from `https://docs.on-demand.io/docs/rate-limiting.md`)

Free-plan limits, verbatim:

| Object | Limit |
|---|---|
| Media Upload Per Minute | **5** |
| RAG Calls Per Minute | **100** |
| Maximum GPU Memory Allocated Per Company | **40 GB** |
| Maximum VCPU Per Company | **10** |

Every tool-using query consumes a RAG call, so 100/min is the practical ceiling on Blender-bridge traffic.
Increases are requested in the console: **Settings → Limit → Increase Your Limits** (fields: Tokens Per
Minute, Current Limit, Next Total Limit, Reason, up to 3 JPEG/PNG proofs). Response within **2 business
days**. Paid-plan limits: `https://app.on-demand.io/pricing`.

### 9.4 Symptom → cause table

| Symptom | Most likely cause | Fix |
|---|---|---|
| `401 unauthenticated` | Wrong header name | Header is exactly **`apikey`** (lowercase) — not `Authorization: Bearer` |
| `404 not_found` on a valid-looking path | Wrong host for that service | Chat → `api.on-demand.io`; Flow Builder → `api.on-demand.io/automation/api`; keys/plugins → `gateway-dev.on-demand.io` (§0.4) |
| Model answers but **never calls the tool** | `pluginIds` absent at both session and query level → "the system will bypass the RAG" | Send `pluginIds` on the query, or set it at session creation |
| Tool worked, then stopped after a code change | Query-level `pluginIds` **replaces** the session list | Include every needed ID in the query array — they are not merged |
| Tool still not called, `pluginIds` present | `fulfillmentOnly: true` | Remove it, or set `false` |
| `KeyError: 'sessionId'` after creating a session | Create returns **`data.id`** | Read `data.id`; only `submitQuery` returns `data.sessionId` |
| `504 plugin_execution_timeout` | Bridge slower than **2.5 min** (big render/import) | Make the operation async: return a job ID and poll |
| `502` from your bridge | Blender not running, addon not started, or wrong port | Start Blender, open the **BlenderMCP** sidebar panel (press `N` in the 3D View) and connect; confirm port **9876** |
| `400 Invalid request or workflow inactive` on execute | Workflow not activated | Call `/activate` first |
| `206` on `/plugin/v1/list` | Plugin subscription not active | Read `message`; subscribe/activate the plugin |
| `429 rate_limit_exceeded` | 100 RAG calls/min exceeded | Back off; request a limit increase |
| Plugin rejected at publish | Schema >5 MB, >10 operations, missing descriptions, <2 conversation starters, or bad privacy-policy URL | See §5.6 |
| Tool calls fail only from OnDemand, fine locally | Bridge not publicly reachable / bad TLS / rotated tunnel hostname | Use a stable HTTPS hostname with a valid certificate |

### 9.5 Final checklist

**Bridge**
- [ ] HTTPS with a valid certificate on a **stable** public hostname (no `localhost`, no rotating tunnel)
- [ ] Blender addon socket stays bound to **`localhost:9876`**; only the bridge connects to it
- [ ] `Origin`/`Host` validated; shared-secret header (`X-Bridge-Key`) enforced on every route
- [ ] Every operation returns within **2.5 minutes**, or is async
- [ ] `execute_blender_code` **omitted** from the published schema (or isolated per §6.3)
- [ ] Blender telemetry reviewed/disabled; Blender runs in a disposable, network-isolated container

**Schema**
- [ ] Valid OpenAPI 3.0; `servers[].url` is the public HTTPS bridge URL
- [ ] ≤ 10 operations; ≤ 5 MB
- [ ] Every operation has `operationId`, `summary`, `description`
- [ ] Every parameter and property has a description
- [ ] `components.securitySchemes` declares the bridge auth header
- [ ] ≥ 2 conversation starters; valid privacy-policy URL

**Registration**
- [ ] All 13 required fields present in `POST /plugin/v1`
- [ ] `action.schema` is a **JSON-stringified string**, not a nested object
- [ ] `action.fields[]` declares `X-Bridge-Key` with `site: "header"`
- [ ] Secret set in `creatorPluginConfig.fields`; `active: true`
- [ ] **`pluginId` retrieved from `GET /plugin/v1/list`** (the create response documents no body) — use
      `pluginId` (`plugin-…`), not `id`

**Runtime**
- [ ] Header is `apikey`; correct host per service
- [ ] Session created; ID read from **`data.id`**
- [ ] `pluginIds` sent on the query (or session); `fulfillmentOnly` not set to `true`
- [ ] Valid `endpointId` from `GET /config/v1/public/endpoints`
- [ ] SSE consumer handles `[DONE]`, `[ERROR]:`, `heartbeat`, and orders chunks by `eventIndex`
- [ ] Verified via `GET /chat/v1/sessions/{sessionId}/messages` that your ID appears in `pluginIds`
- [ ] Workflow (if used): `activate` → `execute` → `stream_logs` with `executionID` **in the body**

---

## 10. Live Registration Record

Registration of the Blender MCP Bridge plugin **was actually attempted against the live OnDemand API on
2026-07-28**, using the real REST API key held in the `ON_DEMAND_API_KEY` environment variable. The attempt
**FAILED with HTTP 400** and **no `pluginId` was ever issued**, so nothing in §7.3 should be read as a
completed registration. The failure is a **documented server-side contract bug**, not a client error and
not an authentication problem: the same key successfully created a real chat session (HTTP **201**,
session `6a684c26a745cb4842705a44`), proving the credential is valid and prod-scoped. The run left **no
side effects** — a follow-up `GET /plugin/v1/list` confirms **0 plugins created** — and the OpenAPI
document itself is sound (4 operations, 8,969 bytes, `openapi-spec-validator` **PASS**).

```text
apikey: <REDACTED> (env ON_DEMAND_API_KEY, 32 chars, never printed)
endpoint: POST /plugin/v1
host_used: https://api.on-demand.io
http_status: 400
error_body: {"message":"schema is required","errorCode":"invalid_request"}
pluginId: NOT ISSUED — registration FAILED
fallback_host: https://gateway-dev.on-demand.io → HTTP 401 (key is prod-scoped)
root_cause: sending action.schema as an object triggers a Go unmarshal error naming
            PluginAction.action.schema of type string — proving the field name is correct
            and a STRING is required. This is a server-side contract bug, not auth and not
            payload shape. ~25 real diagnostic POSTs isolated this.
verification_session_id: 6a684c26a745cb4842705a44 (chat session really created, HTTP 201 — proves the key works)
tool_invoked: false (no pluginId exists, so Step-2 tool verification was not run)
side_effects: none — GET /plugin/v1/list confirms 0 plugins created
schema_validated: 4 operations / 8,969 bytes / openapi-spec-validator PASS
executed_at_utc: 2026-07-28T06:24:34Z
```

| Field | Value |
|---|---|
| **Status** | **FAILED (HTTP 400)** |
| **Endpoint** | `POST /plugin/v1` |
| **Host used** | `https://api.on-demand.io` |
| **`pluginId`** | **NOT ISSUED** |
| **Fallback host** | `gateway-dev.on-demand.io` → **401** (key is prod-scoped) |
| **Verification session** | `6a684c26a745cb4842705a44` (chat session created, HTTP 201) |
| **`tool_invoked`** | `false` |
| **Side effects** | none — `GET /plugin/v1/list` returns 0 plugins |
| **Schema** | 4 operations / 8,969 bytes / `openapi-spec-validator` **PASS** |

**What to do next.** Open a support ticket with OnDemand quoting the exact contradictory pair, because the
two errors cannot both be satisfiable: sending `action.schema` as a valid **8,969-character string** returns
`schema is required`, while sending the very same document as an **object** returns
`json: cannot unmarshal object into Go struct field PluginAction.action.schema of type string`. The second
message proves the field name is right and that the server itself wants a *string* — so the first message is
a server-side validation bug, not a payload mistake. Until it is fixed, use the **console-UI fallback**:
My Agents → **Create Agents** → paste (or *Import from URL*) the OpenAPI schema from §7.2, add the
`X-Bridge-Key` configuration field, save — then read the resulting `plugin-…` ID from
`GET /plugin/v1/list` (§5.4) and use it in `pluginIds` exactly as §8 shows.

---

## 11. Explicitly not verifiable from the live docs

Flagged so nothing here is mistaken for documented behaviour:

| Item | Status |
|---|---|
| Native MCP server registration, MCP transports, `tools/list` / `tools/call` proxying | **Absent.** 0 occurrences of `mcp` in 28 specs and in `llms.txt` |
| `pluginId` returned by `POST /plugin/v1` | **Not documented** — the `200` has no body schema |
| Enum values for `identifier`, `type`, `source`, `status`, `fileSubType`, `chatSubType` | **Not documented** — plain strings; only the `docs/plugin-api.md` sample values are published |
| `GET /plugin/v1/list` | Narrative docs only — **no OpenAPI spec slug** in the categories index |
| `createplugin` / `deleteplugin` | Specs resolve (HTTP 200) but are **unlisted** in the categories index and absent from `llms.txt` |
| Production host for key/plugin management | Specs declare only `gateway-dev.on-demand.io` ("Development server"); `docs/plugin-api.md` shows `api.on-demand.io` in one sample — **unreconciled** |
| `agentIds` / `reasoningMode` on `submitQuery` | In narrative samples, **absent from the OpenAPI spec** (§3.6) |
| SSE framing for `submitQuery` | Narrative docs only — the OpenAPI spec documents just the sync `200` |
| `POST /workflow/stream_logs` as a true stream | Spec declares `application/json` array; **no `text/event-stream`, no termination condition** |
| Runtime inputs for `POST /workflow/{id}/execute` | **No request body documented** |
| Workflow create/update endpoints | Listed in `llms.txt` (`createworkflow`, `updateworkflow`) but **not in the public categories index** |
| API-key scopes, expiry, rotation, list-keys | **Not documented** |
| Sandboxing/egress policy for agent tool calls | **Not documented** — assume none |
| Per-plugin rate limits | **Not documented** — only the company-wide limits in §9.3 |
| `arjun988_blender-skills` skills pack | **NOT_FOUND** — could not be retrieved from any source; existence and contents **unverified** (§11.1) |

---

### 11.1 `arjun988_blender-skills` — **NOT_FOUND**

**Verdict: NOT_FOUND.** The `arjun988_blender-skills` pack **could not be retrieved from any source** in
this session — not from GitHub, not from any package index, and not from any mirror or cache. Its
**existence and contents are therefore unverified**, and nothing about it may be cited as fact. No
provenance, no version, no author attribution and no file listing for that pack could be established.

Consequently **no skill→tool mapping table for that pack is reproduced in this guide.** A prior draft
carried a 94-row reconstruction; because the pack itself could not be retrieved, any such table would be a
**RECONSTRUCTION — NOT the real pack**, and it has been withheld rather than presented as sourced material.
Should such a table be reintroduced, it must carry this banner verbatim, immediately above it:

> ⚠️ **RECONSTRUCTION — NOT the real pack.** These rows are a *canonical reconstruction*, not the
> `arjun988_blender-skills` pack. The **tool bindings are authoritative for this server** (they are derived
> from the OpenAPI schema in §7.2 and the upstream `blender-mcp` tool surface), **but the skill NAMES are
> illustrative only** and must **not** be cited as the real pack's contents.

---

## 12. Sources

**Live OnDemand API documentation** (fetched `2026-07-28T03:21:49Z`, verified `03:30:06Z`)
- `https://gateway.on-demand.io/config/v1/public/docs/categories`
- `https://gateway.on-demand.io/config/v1/public/docs/reference/api/{generateapikey, deleteapikey, createchatsession, submitquery, getchatsessions, getchatsession, getchatmessages, getchatmessage, createchatbatch, getchatbatches, getchatbatch, deletechatbatch, post_workflow-id-activate, post_workflow-id-deactivate, post_workflow-id-execute, streamworkflowlogs, getallendpointspublic, getentitydefinitionpublic, createplugin, deleteplugin, convertaudiototext, converttexttoaudio, translatetext, fetchmedia, createmediaurl, deletemedia, createmqttuser, deletemqttuser}`

**Live OnDemand narrative documentation**
- `https://docs.on-demand.io/llms.txt`
- `https://docs.on-demand.io/docs/{plugin-api, rest-based-plugins, open-api-schema, rules-to-publish-a-rest-api-plugin, query-and-responses-modes, authentication, webhooks, rate-limiting, response-codes, plugins, what-are-plugins, fulfillment-models}.md`
- `https://docs.on-demand.io/reference/errors.md`

**Live platform values**
- `GET https://api.on-demand.io/config/v1/public/endpoints`
- `GET https://api.on-demand.io/config/v1/public/entity_definition?entityId=reasoning_modes`

**blender-mcp research** (verified 2026-07-28)
- `https://github.com/ahujasid/blender-mcp` — **MIT** licence, **~22.7k stars**; components are the Blender
  addon (`addon.py`, TCP socket server on `localhost:9876`) + the MCP server
  (`src/blender_mcp/server.py`, stdio); prerequisites Blender 3.0+, Python 3.10+, `uv`;
  registration command `claude mcp add blender uvx blender-mcp`
- `https://pepy.tech/projects/blender-mcp` — latest release **PyPI v1.5.6, 18 Mar 2026**
- `https://github.com/ahujasid/blender-mcp/blob/main/addon.py` — socket server, default port 9876;
  **last touched 23 Jan 2026**
- `https://github.com/ahujasid/blender-mcp/issues/201` — arbitrary code execution via `exec()`
- `https://github.com/ahujasid/blender-mcp/issues/202` — weak file-path validation
- `https://github.com/ahujasid/blender-mcp/issues/232` — telemetry enabled by default
- `https://blendermcp.org/server`, `https://blendermcp.org/setup/claude`, `https://gitmcp.io/ahujasid/blender-mcp`
- ✅ **VERIFIED — AI Architects guide (Tom Crawshaw, June 2026)**, `https://theaiarchitects.com/blog/blender-mcp`
  — **is real** and independently **corroborates the two-component architecture** (Blender addon TCP socket
  server on `localhost:9876` + stdio MCP server).
- ❌ **UNVERIFIED — "ClaudeLog — Blender MCP"**: the previously cited ClaudeLog page **could NOT be verified
  as existing** in this session. Treat any claim sourced to it as **unverified** and do not cite it.
- MCP specification: `https://modelcontextprotocol.io/specification/2025-06-18/basic/transports` (Origin validation, localhost binding, Streamable HTTP)

---

*Generated 2026-07-28. Every OnDemand endpoint, field, schema and error code above was read from the live
documentation API at the timestamps in §0 — none from memory. Items that could not be verified live are
listed in §11.*
