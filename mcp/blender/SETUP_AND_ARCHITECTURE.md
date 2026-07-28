# OnDemand Blender MCP — Setup & Architecture

**Package:** `ondemand-blender-mcp` v1.5.6 · **Licence:** MIT · **Python:** 3.10+ · **Blender:** 3.0+
**MCP protocol revision:** `2025-06-18` · **Transports:** stdio + streamable-HTTP
**Document generated:** 2026-07-28 (UTC)

---

## Table of contents

1. [Architecture](#1-architecture)
2. [Three-step Mac setup](#2-three-step-mac-setup)
3. [OnDemand registration — curl and Python](#3-ondemand-registration--curl-and-python)
4. [The 94-skill → MCP tool mapping](#4-the-94-skill--mcp-tool-mapping)
5. [Security hardening](#5-security-hardening)
6. [Live deployment reference](#6-live-deployment-reference)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Architecture

### 1.1 The call chain

Every tool call an OnDemand agent makes travels five hops and comes back the same way:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  1. OnDemand Agent (LLM + reasoning mode)                                │
│     Decides "I need to inspect/modify the Blender scene"                 │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  POST /chat/v1/sessions/{id}/query
                                │  pluginIds: ["plugin-XXXXXXXXXX"]
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  2. OnDemand tool/plugin layer (REST API Agent)                          │
│     RAG selects the tool, validates args against the OpenAPI schema      │
│     registered in action.schema, injects the X-Bridge-Key header         │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  HTTPS POST /tools/<tool_name>
                                │  (2.5-minute hard execution cap)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  3. ondemand-blender-mcp  (this package)                                 │
│     stdio  → JSON-RPC on stdin/stdout   (local MCP clients)              │
│     http   → POST/GET /mcp + /health    (hosted / remote)                │
│     Validates against JSON-Schema 2020-12, enforces the exec kill switch │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  TCP JSON  {"type": ..., "params": {...}}
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  4. TCP socket — localhost:9876                                          │
│     Loopback only. Never bind 0.0.0.0 (DNS-rebinding exposure).          │
└───────────────────────────────┬──────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  5. addon.py inside the live Blender process                             │
│     Threaded socket server → bpy.app.timers.register() marshals every    │
│     mutation onto Blender's MAIN THREAD → bpy executes → result returns  │
└──────────────────────────────────────────────────────────────────────────┘
```

Response envelope on the way back, at hop 4:

```json
{ "status": "success", "result": { } }
{ "status": "error",   "message": "..." }
```

### 1.2 Why a bridge exists at all

OnDemand's public API has **no native MCP server registration**. Verified against the live docs
(28 OpenAPI specs plus `docs.on-demand.io/llms.txt`): the token `mcp` appears **zero** times. There is no
endpoint that accepts an MCP `server.json`, a stdio command such as `uvx blender-mcp`, or a `tools/list`
capability document.

So the tool surface is re-expressed as a **REST API Agent** ("plugin"): an OpenAPI 3.0 document registered
through `POST /plugin/v1`, yielding a `pluginId` of the form `plugin-<digits>` which is then passed in
`pluginIds`. The MCP server remains a genuine MCP server for Claude Desktop / Cursor / Claude Code over
stdio — the HTTP transport is what OnDemand reaches.

### 1.3 Why the main-thread hop (hop 5) matters

Blender's `bpy` API is **not thread-safe**. Touching it from the socket thread corrupts state or segfaults
the process. `addon.py` therefore never calls `bpy` from the socket thread: it pushes a closure onto
`bpy.app.timers.register(...)`, which Blender runs on the main thread, and blocks the socket thread on a
`queue.Queue` until the result is posted back. This is the single most important correctness property of
the add-on.

### 1.4 Component inventory

| Component | File | Role |
|---|---|---|
| Tool registry | `src/ondemand_blender_mcp/tools.py` | 14 descriptors + validating dispatcher — single source of truth |
| JSON-RPC router | `src/ondemand_blender_mcp/protocol.py` | `initialize`, `tools/list`, `tools/call`, `ping`, notifications |
| stdio transport | `src/ondemand_blender_mcp/server_stdio.py` | Newline-delimited JSON-RPC; diagnostics to **stderr** only |
| HTTP transport | `src/ondemand_blender_mcp/server_http.py` | `/mcp` (POST+GET/SSE), `/health`, Origin validation |
| Blender client | `src/ondemand_blender_mcp/blender_client.py` | TCP, partial-read reassembly, retries + backoff |
| Manifest generator | `src/ondemand_blender_mcp/manifest.py` | Emits `tools.json` (MCP + OpenAPI + plugin body) |
| Config | `src/ondemand_blender_mcp/config.py` | Env-driven; security defaults closed |
| CLI | `src/ondemand_blender_mcp/cli.py` | `--transport`, `--check`, `--print-manifest` |
| Blender add-on | `addon.py` | Socket server, N-panel UI, 14 `bpy` command handlers |

### 1.5 The 14 tools

| # | Tool | Mutates scene? | Network? |
|---|---|---|---|
| 1 | `get_scene_info` | no | no |
| 2 | `get_object_info` | no | no |
| 3 | `get_viewport_screenshot` | no | no |
| 4 | `execute_blender_code` | **yes — arbitrary** | possible |
| 5 | `create_object` | yes | no |
| 6 | `modify_object` | yes | no |
| 7 | `delete_object` | **yes — destructive** | no |
| 8 | `set_material` | yes | no |
| 9 | `poly_haven_search` | no | yes |
| 10 | `poly_haven_download` | yes | yes |
| 11 | `sketchfab_search` | no | yes |
| 12 | `sketchfab_download` | yes | yes |
| 13 | `hyper3d_generate_model` | yes | yes |
| 14 | `hunyuan3d_generate_model` | yes | yes |

---

## 2. Three-step Mac setup

### Step 1 — Install the Blender add-on and start the socket server

1. Download `addon.py` from `mcp/blender/addon.py`.
2. In Blender: **Edit → Preferences → Add-ons → Install…**, select `addon.py`, then tick the checkbox
   next to **Interface: BlenderMCP — OnDemand Bridge** to enable it.
3. In the 3D viewport press **`N`** to open the sidebar, choose the **BlenderMCP** tab, and click
   **Connect**. The status label flips to *Running* and the add-on listens on `localhost:9876`.

Leave **Enable Code Execution** and **Telemetry** unticked unless you have read [§5](#5-security-hardening).

### Step 2 — Install `uv`

```bash
brew install uv
```

### Step 3 — Register the MCP server with your client

```bash
claude mcp add blender -- uvx blender-mcp
```

For **this** package instead of upstream:

```bash
claude mcp add blender -- uvx ondemand-blender-mcp
```

Claude Desktop (`claude_desktop_config.json`) equivalent:

```json
{
  "mcpServers": {
    "blender": {
      "command": "uvx",
      "args": ["ondemand-blender-mcp"]
    }
  }
}
```

Verify the socket end-to-end before involving an LLM:

```bash
uvx ondemand-blender-mcp --check
# OK localhost:9876 — scene Scene with 3 object(s); 14 tools exposed
```

### Running the HTTP transport (what OnDemand calls)

```bash
ondemand-blender-mcp --transport http --host 0.0.0.0 --port 8080
# POST/GET http://localhost:8080/mcp   ·   GET http://localhost:8080/health
```

---

## 3. OnDemand registration — curl and Python

> **Verified API facts.** `action.schema` is typed as a **string**, so the OpenAPI document must be
> JSON-stringified into it. The `POST /plugin/v1` success response has **no documented body schema** — do
> not expect a `pluginId` back; read it from `GET /plugin/v1/list` instead.

### 3.1 Register the plugin — curl

```bash
curl -X POST 'https://gateway-dev.on-demand.io/plugin/v1' \
  -H 'apikey: <YOUR_API_KEY>' \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "name": "Blender MCP Bridge",
  "identifier": "rest_api",
  "description": "Inspect and edit a live Blender scene through the ondemand-blender-mcp bridge.",
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
    "authentication": { "type": "apiKey" },
    "fields": [
      { "key": "X-Bridge-Key", "site": "header", "required": true, "editable": false }
    ],
    "schema": "<<< the openapi object from tools.json, JSON-stringified into ONE string >>>"
  },
  "creatorPluginConfig": {
    "active": true,
    "fields": { "X-Bridge-Key": "<BRIDGE_SHARED_SECRET>" }
  }
}
JSON
```

### 3.2 Register the plugin — Python (does the stringify for you)

```python
import json, os, requests

API_KEY = os.environ["ONDEMAND_API_KEY"]
PLUGIN_HOST = "https://gateway-dev.on-demand.io"

with open("mcp/blender/tools.json", encoding="utf-8") as fh:
    manifest = json.load(fh)

body = dict(manifest["ondemandPlugin"])                     # pre-built, registration-ready
body["action"] = dict(body["action"])
body["action"]["schema"] = json.dumps(manifest["openapi"])  # STRING, not an object
body["creatorPluginConfig"]["fields"]["X-Bridge-Key"] = os.environ["BRIDGE_SHARED_SECRET"]

resp = requests.post(
    f"{PLUGIN_HOST}/plugin/v1",
    headers={"apikey": API_KEY, "Content-Type": "application/json"},
    json=body, timeout=60,
)
print(resp.status_code, resp.text)
# The 200 has no documented body schema — fetch the id separately (below).
```

### 3.3 Retrieve the `pluginId`

```bash
curl -X GET 'https://api.on-demand.io/plugin/v1/list?limit=50' -H 'apikey: <YOUR_API_KEY>'
```

```python
r = requests.get("https://api.on-demand.io/plugin/v1/list",
                 headers={"apikey": API_KEY}, params={"limit": 50}, timeout=30)
plugins = r.json()["data"]["plugins"]
blender = next(p for p in plugins if p["name"] == "Blender MCP Bridge")
PLUGIN_ID = blender["pluginId"]     # "plugin-1234567890" — use this, NOT blender["id"]
```

> A `206 Partial Success` whose message reads `plugin-…: plugin subscription not active` means the plugin
> exists but is not subscribed. Always read `message` on a 206 — the HTTP status alone looks like success.

### 3.4 Create a chat session

```bash
curl -X POST 'https://api.on-demand.io/chat/v1/sessions' \
  -H 'apikey: <YOUR_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{ "externalUserId": "blender-user-001", "pluginIds": ["plugin-1234567890"] }'
```

```python
API = "https://api.on-demand.io"
H = {"apikey": API_KEY, "Content-Type": "application/json"}

r = requests.post(f"{API}/chat/v1/sessions", headers=H,
                  json={"externalUserId": "blender-user-001", "pluginIds": [PLUGIN_ID]},
                  timeout=30)
session_id = r.json()["data"]["id"]      # data.id — NOT data.sessionId
```

### 3.5 Submit a query that invokes the tools

```bash
curl -X POST 'https://api.on-demand.io/chat/v1/sessions/<SESSION_ID>/query' \
  -H 'apikey: <YOUR_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "Inspect my Blender scene, create a cube named HeroCube at [0,0,2], and give it a red metallic material.",
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
    "query": ("Inspect my Blender scene, create a cube named HeroCube at [0,0,2], "
              "and give it a red metallic material."),
    "endpointId": "predefined-openai-gpt4o",
    "responseMode": "sync",
    "pluginIds": [PLUGIN_ID],
    "modelConfigs": {
        "fulfillmentPrompt": "You control Blender through the bridge tool. "
                             "Always call get_scene_info before mutating the scene.",
        "temperature": 0.2,
    },
}
r = requests.post(f"{API}/chat/v1/sessions/{session_id}/query",
                  headers=H, json=payload, timeout=180)   # tool cap is 2.5 min
data = r.json()["data"]
print(data["status"], data["answer"])
```

**`pluginIds` precedence — the #1 cause of "my tool was never called":**

| Where `pluginIds` is set | Effect |
|---|---|
| On the query | **Replaces** the session list entirely (not merged) |
| Session only | Session list is used |
| **Neither** | **RAG is bypassed** — the model answers with no tool access |
| `fulfillmentOnly: true` | Skips RAG even when `pluginIds` is set |

Confirm attachment afterwards with
`GET /chat/v1/sessions/{sessionId}/messages` and check `data[].pluginIds`.

### 3.6 Calling the bridge directly (no OnDemand layer)

```bash
curl -X POST 'https://sb-6byhg0drpmla.vercel.run/mcp' \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"create_object","arguments":{"type":"CUBE","name":"HeroCube","location":[0,0,2]}}}'
```

---

## 4. The 94-skill → MCP tool mapping

> **Provenance.** The upstream `arjun988_blender-skills` pack manifest could **not** be retrieved in this
> session — a file/directory search returned only unrelated documents. The 94 rows in
> `mcp/blender/docs/SKILLS_MAPPING.md` are therefore a **canonical reconstruction** of the Blender skill
> surface, organised by domain. **The tool bindings are authoritative for this server**; the skill *names*
> are illustrative and must be reconciled against the real pack before publication.

The full 94-row table lives in **[`docs/SKILLS_MAPPING.md`](docs/SKILLS_MAPPING.md)**. Coverage summary:

| MCP tool | Skills bound as primary | % of 94 |
|---|---:|---:|
| `execute_blender_code` | 34 | 36.2% |
| `create_object` | 17 | 18.1% |
| `modify_object` | 9 | 9.6% |
| `set_material` | 8 | 8.5% |
| `get_scene_info` | 4 | 4.3% |
| `poly_haven_download` | 4 | 4.3% |
| `get_object_info` | 3 | 3.2% |
| `get_viewport_screenshot` | 3 | 3.2% |
| `sketchfab_download` | 3 | 3.2% |
| `poly_haven_search` | 2 | 2.1% |
| `sketchfab_search` | 2 | 2.1% |
| `hyper3d_generate_model` | 2 | 2.1% |
| `hunyuan3d_generate_model` | 2 | 2.1% |
| `delete_object` | 1 | 1.1% |
| **Total** | **94** | **100%** |

### The finding that matters

**36.2% of skills (34 of 94) have no first-class tool and must fall back to `execute_blender_code`.**
The uncovered domains are:

- **Animation & rigging** — keyframes, drivers, constraints, armatures
- **Modifiers** — subdivision, bevel, boolean, array, mirror
- **Mesh edit-mode operations** — extrude, inset, loop cuts, merges
- **Render settings & output** — engine choice, samples, resolution, file format
- **Compositor & node graphs** — beyond the Principled BSDF basics `set_material` covers
- **Collections, parenting and scene organisation**

This is a **security finding, not just a coverage gap**: those 34 skills force the most dangerous tool in
the surface to stay switched on. Promoting the top domains (modifiers, keyframes, render settings) to
first-class tools would let most deployments run with `execute_blender_code` permanently disabled — the
single highest-value hardening change available to this project.

---

## 5. Security hardening

### 5.1 `execute_blender_code` — unsandboxed arbitrary Python

This tool runs Python **inside the Blender process with no sandbox**: full `bpy`, plus `os`, `subprocess`,
`open()` and `socket`. It can read or destroy any file the Blender user can touch and open outbound
connections.

**Prompt injection becomes remote code execution.** Once the tool is attached to an agent, any text the
model ingests — a user message, a fetched web page, an asset description — can attempt to steer it into
running attacker-chosen Python. The LLM is the only thing between untrusted text and `exec()`.

Defences implemented in this build:

| Layer | Control |
|---|---|
| Add-on | `enable_code_execution` BoolProperty, **default `False`** — returns a refusal envelope when off |
| MCP server | `EXEC_ENABLED` env var, **default `false`** — `ToolDisabledError` before the socket is touched |
| CLI | Requires an explicit `--allow-code-execution` flag |
| Schema | `destructiveHint: true` + `openWorldHint: true` annotations so clients can warn |

Defence in depth is deliberate: the MCP server may be exposed over HTTP while Blender is not, so **both**
ends enforce the switch independently.

Recommended posture, in order:

1. **Omit `/exec` from the registered OpenAPI schema entirely** — if the tool is not in the document, the
   agent cannot call it. Correct default for anything user-facing.
2. If required, isolate it in a **separate private plugin** used only by trusted operators.
3. Run Blender in a **disposable, network-isolated container** with no credentials mounted.
4. **Allow-list, never deny-list** — Python has too many escapes for a deny-list to hold.
5. **Log every executed snippet** with its session and message ID.
6. Never combine it with agents that ingest untrusted web content in the same session.

### 5.2 File-path validation

Upstream `blender-mcp` has weak path validation (documented issue): tools that accept local paths can be
steered into reading or writing arbitrary files.

This build adds `_safe_path()` in `addon.py`, which resolves every user-supplied path with
`os.path.realpath()` and **rejects anything outside an allow-list** (the system temp directory and the
`.blend` file's own directory by default). `realpath` is used specifically so `../../` traversal and
symlink escapes both collapse before the check.

### 5.3 Telemetry — off by default

Upstream ships telemetry **enabled by default**, collecting prompts, code and screenshots. This build
**inverts that**: `TELEMETRY_ENABLED` defaults to `false` in both `.env.example` and the add-on
PropertyGroup, and the add-on contains no telemetry transmission path at all — the toggle exists for UI
parity only. Scene data in a commercial pipeline is confidential; silent egress is a governance incident.

### 5.4 Remote transport authentication

Local stdio needs no auth — the client owns the process. **The moment you expose `/mcp` over a network,
everything changes.**

| Control | Requirement |
|---|---|
| **TLS** | Mandatory. Never plain HTTP off-host. Terminate at a reverse proxy or tunnel. |
| **Origin validation** | Implemented — `is_origin_allowed()` rejects unknown origins with **403**. Browsers cannot forge `Origin`, which is what makes this a real DNS-rebinding defence. Localhost is allowed; anything else needs `MCP_ALLOWED_ORIGINS`. |
| **Loopback binding** | The Blender socket binds `localhost` only. Never `0.0.0.0`. |
| **Shared secret** | `X-Bridge-Key`, declared in `action.fields[]` and injected by OnDemand on every call. Store it Creator-Defined and **Masked**. |
| **OAuth 2.1 + PKCE** | What the MCP specification requires for a genuinely public remote server: PKCE, dynamic client registration, and `.well-known/oauth-authorization-server` metadata. **Not implemented here** — this build uses shared-secret auth, which is adequate behind a private tunnel but *not* for a public multi-tenant endpoint. |

> ⚠️ A 2026 survey of 7,973 live remote MCP servers found **40.55% expose tools with no authentication at
> all.** Do not add to that statistic. The live sandbox endpoint in §6 is a **demonstration** with no
> Blender attached and no secrets — it is not a production pattern.

### 5.5 Operational limits

| Limit | Value | Consequence |
|---|---|---|
| Plugin execution timeout | **2.5 minutes** | Longer renders must be async (return a job id, poll) or you get `plugin_execution_timeout` / HTTP 504 |
| RAG calls (free plan) | 100/min | Practical ceiling on agent-driven Blender traffic |
| Media upload (free plan) | 5/min | Affects screenshot round-trips |
| OpenAPI schema | ≤ 5 MB, ≤ 10 operations to publish | This manifest has **14** — valid for a private plugin, must be split before marketplace publication |

---

## 6. Live deployment reference

A live instance of the streamable-HTTP transport was deployed and verified on 2026-07-28:

| Item | Value |
|---|---|
| Base URL | `https://sb-6byhg0drpmla.vercel.run` |
| MCP endpoint | `https://sb-6byhg0drpmla.vercel.run/mcp` (POST + GET/SSE) |
| Health endpoint | `https://sb-6byhg0drpmla.vercel.run/health` |

Verified behaviour:

```text
GET  /health                      → 200  {"status":"ok","toolCount":14,
                                          "codeExecutionEnabled":false,"telemetryEnabled":false}
POST /mcp  initialize             → 200  protocolVersion 2025-06-18, tools.listChanged true
POST /mcp  tools/list             → 200  14 tools
POST /mcp  tools/call             → 200  isError:true "Blender unreachable" (no Blender in the cloud)
POST /mcp  Origin: evil.example   → 403  Origin not allowed
POST /mcp  Origin: localhost:3000 → 200
GET  /mcp                         → 200  text/event-stream, notifications/ready
```

`blender.connected: false` is **correct and expected**: the sandbox is a cloud container with no Blender
process. It demonstrates the transport, protocol and security layers; hops 4–5 require Blender on your own
machine. This is an **ephemeral sandbox** and will expire.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Blender unreachable … Connection refused` | Blender not running, or **Connect** not clicked | Press `N` → BlenderMCP tab → **Connect** |
| `401 unauthenticated` from OnDemand | Wrong header name | Header is exactly `apikey`, lowercase — not `Authorization: Bearer` |
| Model answers but never calls the tool | `pluginIds` absent at both session and query level → RAG bypassed | Send `pluginIds` on the query |
| Tool worked, then stopped after an edit | Query-level `pluginIds` **replaces** the session list | Include every needed id in the query array |
| `KeyError: 'sessionId'` after creating a session | Create returns `data.id` | Only `submitQuery` returns `data.sessionId` |
| `504 plugin_execution_timeout` | Operation exceeded 2.5 min | Make it async: return a job id and poll |
| `403 Origin not allowed` | Origin validation | Add the origin to `MCP_ALLOWED_ORIGINS` |
| `Code execution is disabled` | Intentional default | Set `EXEC_ENABLED=true` **and** tick the panel toggle — read §5.1 first |
| `206` from `/plugin/v1/list` | Plugin subscription not active | Read `message`; subscribe/activate the plugin |
| Blender freezes during a call | Heavy op on the main thread | Expected — `bpy` is single-threaded; keep operations small |

---

*`ondemand-blender-mcp` v1.5.6 — MIT. Upstream inspiration: [`ahujasid/blender-mcp`](https://github.com/ahujasid/blender-mcp) (MIT, ~22.7k stars).*
