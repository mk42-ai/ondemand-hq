# ondemand-blender-mcp

`ondemand-blender-mcp` is a Model Context Protocol (MCP) server that bridges the OnDemand AI
platform to a live Blender instance. It exposes scene inspection, object manipulation, material
editing, and third-party asset search/import (Poly Haven, Sketchfab, Hyper3D, Hunyuan3D) as
callable tools, so an OnDemand agent — or any other MCP-compatible client — can drive Blender
through natural language.

[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](#requirements)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/protocol-MCP-purple.svg)](#how-it-works)

## Table of Contents

- [What This Is](#what-this-is)
- [How It Works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Blender Add-on Installation](#blender-add-on-installation)
- [Client Configuration](#client-configuration)
- [Running the Server](#running-the-server)
- [Tools Reference](#tools-reference)
- [Configuration](#configuration)
- [OnDemand Registration](#ondemand-registration)
- [Docker](#docker)
- [Testing](#testing)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [License & Credits](#license--credits)

## What This Is

`ondemand-blender-mcp` is a small, focused MCP server written in Python. It does not embed
Blender or reimplement any of its functionality; instead it speaks a tiny newline-delimited JSON
protocol over a TCP socket to a companion add-on (`addon.py`) that runs *inside* a live Blender
process. The MCP server never touches `.blend` files directly — every scene read or mutation
happens inside Blender itself, executed by the add-on, and the result is relayed back to whichever
MCP client asked for it (an OnDemand agent, Claude Desktop, Claude Code, Cursor, or any other MCP
host).

The project exists to let an MCP client:

- Inspect a running Blender scene (`get_scene_info`, `get_object_info`, `get_viewport_screenshot`).
- Create, modify, delete, and material objects (`create_object`, `modify_object`,
  `delete_object`, `set_material`).
- Pull in third-party assets — HDRIs/textures/models from Poly Haven, models from Sketchfab, and
  AI-generated models from Hyper3D Rodin and Hunyuan3D.
- Optionally run arbitrary Python inside Blender (`execute_blender_code`) for anything the other
  tools don't cover — **disabled by default**, see [Security](#security).

## How It Works

```text
  OnDemand Agent
        │
        │  natural-language request ("add a red cube")
        ▼
  OnDemand tool/plugin layer   (REST API — a registered "plugin", see OnDemand Registration)
        │
        │  JSON-RPC 2.0, over stdio   OR   streamable-HTTP  POST/GET /mcp
        ▼
  ondemand-blender-mcp          (this repository — the MCP server)
        │
        │  newline-delimited JSON, TCP socket, localhost:9876
        ▼
  addon.py                      (running inside a live Blender instance)
        │
        ▼
  bpy — the actual Blender scene graph
```

The MCP server is transport-agnostic: it exposes the exact same 14 tools whether a client talks to
it over `stdio` (the default, used by desktop MCP hosts that spawn a subprocess) or over
`streamable-HTTP` (used for remote/server deployments, including the Docker image in this repo).
Neither transport talks to Blender directly — both go through the same internal Blender TCP
client, which sends a command to `addon.py` and waits for a JSON response.

## Requirements

| Requirement | Version |
|---|---|
| Blender | 3.0 or newer |
| Python | 3.10 or newer |
| [uv](https://github.com/astral-sh/uv) | latest (recommended installer/runner) |

## Installation

Pick whichever matches your workflow; all three install the same `ondemand-blender-mcp` console
script.

```bash
# Run directly with uv — no separate install step, always uses a fresh venv
uvx ondemand-blender-mcp

# Install from PyPI with pip
pip install ondemand-blender-mcp

# From source, editable install with the dev extras (tests, lint, etc.)
git clone https://github.com/on-demand-io/ondemand-blender-mcp.git
cd ondemand-blender-mcp
uv pip install -e ".[dev]"
```

## Blender Add-on Installation

The MCP server is only half of the picture — Blender needs the companion add-on running so it can
accept commands. This is the quickstart:

1. Install `addon.py` in Blender via Edit → Preferences → Add-ons → Install, enable it, then press
   `N` in the 3D viewport and hit **Connect** in the BlenderMCP panel.
2. `brew install uv`
3. `claude mcp add blender -- uvx blender-mcp`

Step 3 above is the reference Claude Desktop MCP registration for the upstream `blender-mcp`
project. For this OnDemand-flavoured server, the equivalent commands are:

```bash
# OnDemand / agent equivalent of step 3 above
uvx ondemand-blender-mcp
```

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

Step 1 (installing `addon.py` and clicking **Connect**) is unchanged no matter which MCP client or
agent you use afterwards — it is what opens the TCP socket on port 9876 that
`ondemand-blender-mcp` connects to.

## Client Configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

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

### Claude Code CLI

```bash
claude mcp add blender -- uvx ondemand-blender-mcp
```

### Cursor

Add to `.cursor/mcp.json` (project-local) or the global Cursor MCP settings:

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

## Running the Server

### stdio transport (default)

Used by desktop MCP hosts that spawn the server as a subprocess and speak JSON-RPC over
stdin/stdout.

```bash
# default transport is stdio, so these two are equivalent
ondemand-blender-mcp
ondemand-blender-mcp --transport stdio
```

### streamable-HTTP transport

Used for remote/server deployments, including the Docker image described below. Exposes a single
`/mcp` endpoint that accepts `POST` for JSON-RPC requests and `GET` for Server-Sent Events (SSE)
streaming, plus a `/health` endpoint for liveness checks.

```bash
ondemand-blender-mcp --transport http --port 8080
```

The HTTP transport validates the `Origin` header on every request against `MCP_ALLOWED_ORIGINS`
(rejecting anything not on the allow-list with `403`), and reads/echoes the
`MCP-Protocol-Version` header so clients can negotiate protocol revisions.

## Tools Reference

All 14 tools are available on both transports.

| Tool | Purpose | Key arguments |
|---|---|---|
| `get_scene_info` | Summarize the current Blender scene: objects, collections, active camera. | *(none)* |
| `get_object_info` | Return detailed properties (transform, mesh stats, materials) for one object. | `object_name` |
| `get_viewport_screenshot` | Capture the active 3D viewport as an image. | `max_size` |
| `execute_blender_code` | Run arbitrary Python inside Blender's interpreter. **Disabled by default.** | `code` |
| `create_object` | Create a new mesh, light, or camera object in the scene. | `type`, `name`, `location`, `rotation`, `scale` |
| `modify_object` | Change the transform or visibility of an existing object. | `object_name`, `location`, `rotation`, `scale`, `visible` |
| `delete_object` | Remove an object from the scene. | `object_name` |
| `set_material` | Create or assign a material (with a base colour) to an object. | `object_name`, `material_name`, `color` |
| `poly_haven_search` | Search the Poly Haven library for HDRIs, textures, or models. | `asset_type`, `query` |
| `poly_haven_download` | Download and import a Poly Haven asset into the scene. | `asset_id`, `asset_type`, `resolution` |
| `sketchfab_search` | Search Sketchfab for downloadable models. | `query`, `categories`, `count` |
| `sketchfab_download` | Download and import a Sketchfab model by UID. | `uid` |
| `hyper3d_generate_model` | Generate a 3D model from a text prompt and/or reference images via Hyper3D Rodin. | `prompt`, `images` |
| `hunyuan3d_generate_model` | Generate a 3D model from a text prompt or image via Hunyuan3D. | `prompt`, `image` |

## Configuration

All configuration is done via environment variables (see `.env.example` for a ready-to-copy
template).

| Variable | Default | Purpose |
|---|---|---|
| `BLENDER_HOST` | `localhost` | Hostname/IP where `addon.py` is listening inside Blender. |
| `BLENDER_PORT` | `9876` | TCP port `addon.py` listens on inside Blender. |
| `MCP_HTTP_PORT` | `8080` | Port the streamable-HTTP transport binds to (`--transport http`). |
| `ONDEMAND_API_KEY` | *(unset)* | OnDemand platform API key, used by registration/automation scripts. Never commit a real value. |
| `POLYHAVEN_ENABLED` | `false` | Enables the `poly_haven_search` / `poly_haven_download` tools. |
| `TELEMETRY_ENABLED` | `false` | Enables anonymous usage telemetry. Off by default here — see [Security](#security). |
| `MCP_ALLOWED_ORIGINS` | *(unset)* | Comma-separated list of Origins allowed to call the streamable-HTTP `/mcp` endpoint. |
| `BLENDER_TIMEOUT` | `15` | Seconds to wait for a response from `addon.py` over the TCP socket. |
| `BLENDER_RETRIES` | `3` | Number of retries for a failed Blender TCP command before giving up. |
| `EXEC_ENABLED` | `false` | Master switch for the `execute_blender_code` tool. Leave disabled unless every caller is trusted. |

## OnDemand Registration

OnDemand's public API has **no native "register an MCP server" endpoint**. The documented,
supported path is to register this server's tool surface as a REST API Agent — what OnDemand
calls a **plugin** — and let the OnDemand chat runtime call into it.

### 1. Create the plugin

`POST /plugin/v1` on host `https://gateway-dev.on-demand.io`, authenticated with an `apikey`
header. The OpenAPI schema describing the 14 tools goes in `action.schema` as a
**JSON-stringified string**, not a nested JSON object.

```bash
curl -X POST "https://gateway-dev.on-demand.io/plugin/v1" \
  -H "apikey: <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "ondemand-blender-mcp",
        "description": "Bridges OnDemand agents to a live Blender instance via MCP tools.",
        "action": {
          "type": "openapi",
          "schema": "{\"openapi\":\"3.0.0\",\"info\":{\"title\":\"ondemand-blender-mcp\",\"version\":\"1.0.0\"},\"paths\":{}}"
        }
      }'
```

The same call in Python:

```python
import json
import requests

API_KEY = "<YOUR_API_KEY>"
BASE_URL = "https://gateway-dev.on-demand.io"

openapi_schema = {
    "openapi": "3.0.0",
    "info": {"title": "ondemand-blender-mcp", "version": "1.0.0"},
    "paths": {
        # one entry per tool, e.g. "/tools/create_object": {...}
    },
}

response = requests.post(
    f"{BASE_URL}/plugin/v1",
    headers={"apikey": API_KEY, "Content-Type": "application/json"},
    json={
        "name": "ondemand-blender-mcp",
        "description": "Bridges OnDemand agents to a live Blender instance via MCP tools.",
        "action": {
            "type": "openapi",
            # action.schema MUST be a JSON string, not a nested object.
            "schema": json.dumps(openapi_schema),
        },
    },
)
response.raise_for_status()
plugin_id = response.json()["data"]["pluginId"]
print(plugin_id)  # e.g. "plugin-1234567890"
```

### 2. List registered plugins

```bash
curl -X GET "https://gateway-dev.on-demand.io/plugin/v1/list" \
  -H "apikey: <YOUR_API_KEY>"
```

The response contains `data.plugins[].pluginId`, formatted as `plugin-<digits>` — this exact
string is what gets passed as a `pluginIds` entry below.

### 3. Start a chat session and query it

```bash
curl -X POST "https://gateway-dev.on-demand.io/chat/v1/sessions" \
  -H "apikey: <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"externalUserId": "user-123", "pluginIds": ["plugin-1234567890"]}'
```

Read the new session id from `data.id` in the response, then query it:

```bash
curl -X POST "https://gateway-dev.on-demand.io/chat/v1/sessions/<SESSION_ID>/query" \
  -H "apikey: <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
        "query": "Add a red cube to the current Blender scene.",
        "endpointId": "predefined-openai-gpt4.1",
        "responseMode": "sync",
        "pluginIds": ["plugin-1234567890"]
      }'
```

`responseMode` is one of `sync`, `stream`, or `webhook`.

**`pluginIds` precedence:** if `pluginIds` is supplied on the `/query` call it **replaces** (not
merges with) any `pluginIds` set when the session was created. If `pluginIds` is absent at *both*
the session and query level, OnDemand's RAG-based automatic plugin selection is bypassed entirely
— pass `pluginIds` explicitly whenever you need this tool surface to be available to the agent.

**Timeout:** plugin execution is capped at **2.5 minutes**. A call that runs longer fails with
HTTP `504` and error code `plugin_execution_timeout` — keep `execute_blender_code` payloads and
asset downloads well under that budget.

## Docker

```bash
docker build -t ondemand-blender-mcp .
docker run --rm -p 8080:8080 --env-file .env ondemand-blender-mcp
```

The container only runs the MCP server — Blender itself runs on your host machine (or wherever
`addon.py` is listening), so the container needs to reach *out* to it:

- **macOS / Windows (Docker Desktop):** set `BLENDER_HOST=host.docker.internal` in your `.env`
  file so the container can reach the Blender instance running on the host.
- **Linux:** either set `BLENDER_HOST` to the host's LAN/bridge IP, or run the container with
  `--network host` so `localhost` inside the container is the same `localhost` Blender is
  listening on.

```bash
# Linux example using the host network namespace
docker run --rm --network host --env-file .env ondemand-blender-mcp
```

## Testing

```bash
pytest -q
```

## Security

`ondemand-blender-mcp` grants a client real control over a running Blender process. Please read
this section before exposing the server beyond your own machine.

- **`execute_blender_code` is unsandboxed arbitrary Python**, executed inside Blender's own
  interpreter with full access to `bpy` and the host filesystem. It is **disabled by default**
  (`EXEC_ENABLED=false`) precisely because the boundary between "the model decided to run some
  code" and "an attacker's prompt injection ran arbitrary code" (RCE) is only as strong as the
  prompt itself — treat enabling it as equivalent to giving the connected agent a local shell.
- Any tool argument that resolves to a filesystem path (asset downloads, imports) is validated
  before use; never point `BLENDER_HOST` or asset directories at paths outside the intended
  project workspace.
- **Telemetry is OFF by default** in this server (`TELEMETRY_ENABLED=false`). Note that the
  upstream project this is based on, [`ahujasid/blender-mcp`](https://github.com/ahujasid/blender-mcp),
  ships telemetry **ON** by default — if you are migrating configuration from that project,
  double-check this flag explicitly.
- Bind the HTTP transport to `localhost` unless you have a specific reason to do otherwise; do not
  publish `--port` directly to the public internet.
- If you do need remote access to the streamable-HTTP transport, put it behind **TLS**, enforce
  `Origin` header validation via `MCP_ALLOWED_ORIGINS`, and require **OAuth 2.1 with PKCE** at the
  front door.
- **Never expose `/mcp` publicly without authentication.** The endpoint accepts JSON-RPC requests
  that can trigger scene mutations and, if `EXEC_ENABLED=true`, arbitrary code execution.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Connection refused` on port 9876 | Blender is not running, or the BlenderMCP panel hasn't been connected | Open Blender, press `N` in the 3D viewport, click **Connect** in the BlenderMCP panel |
| HTTP `504`, error `plugin_execution_timeout` | The OnDemand plugin execution budget (2.5 minutes) was exceeded | Break the request into smaller steps; avoid long-running `execute_blender_code` calls or large asset downloads in one query |
| HTTP `403` on `/mcp` | The request's `Origin` header isn't in `MCP_ALLOWED_ORIGINS` | Add the calling client's origin to `MCP_ALLOWED_ORIGINS` |
| Agent never calls any Blender tool | `pluginIds` missing on the session or query | Pass the registered `plugin-<id>` explicitly in `pluginIds` (see [OnDemand Registration](#ondemand-registration)) |

## License & Credits

Released under the [MIT License](LICENSE), Copyright (c) 2026 OnDemand.

This project's Blender-side protocol and add-on design are inspired by, and interoperate
conceptually with, [`ahujasid/blender-mcp`](https://github.com/ahujasid/blender-mcp) (MIT
licensed, ~22.7k GitHub stars) — credit to that project for pioneering the MCP-to-Blender bridge
pattern that `ondemand-blender-mcp` adapts for the OnDemand platform.
