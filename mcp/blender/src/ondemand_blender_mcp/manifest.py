"""Generate ``tools.json`` — the OnDemand plugin-registration manifest.

OnDemand has no native MCP registration, so the tool surface is registered as a
REST API Agent whose ``action.schema`` is an OpenAPI 3.0 document. This module
emits BOTH shapes from the single source of truth in :mod:`.tools`:

* ``mcpTools``     — the raw MCP descriptors (name/description/inputSchema).
* ``openapi``      — an OpenAPI 3.0.1 document, one POST operation per tool,
                     ready to be JSON-stringified into ``action.schema``.
* ``ondemandPlugin`` — the ready-to-POST ``/plugin/v1`` body skeleton.
"""

from __future__ import annotations

import json
from typing import Any

from . import __version__
from .tools import TOOLS, tool_descriptors

DEFAULT_BRIDGE_URL = "https://blender-bridge.example.com/v1"


def build_openapi(server_url: str = DEFAULT_BRIDGE_URL) -> dict[str, Any]:
    """Build an OpenAPI 3.0 document exposing every tool as a POST operation."""
    paths: dict[str, Any] = {}
    for tool in TOOLS:
        schema = json.loads(json.dumps(tool["inputSchema"]))
        schema.pop("$schema", None)  # OpenAPI 3.0 Schema Objects omit $schema
        operation: dict[str, Any] = {
            "summary": tool["description"].split(".")[0][:120],
            "description": tool["description"],
            "operationId": tool["name"],
            "responses": {
                "200": {
                    "description": f"{tool['name']} executed successfully.",
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "description": "Result payload returned by Blender.",
                                "properties": {
                                    "status": {"type": "string", "description": "success or error."},
                                    "result": {"type": "object", "description": "Tool-specific result."},
                                },
                            }
                        }
                    },
                },
                "400": {"description": "Invalid arguments for this tool."},
                "502": {"description": "The Blender socket server is unreachable."},
            },
        }
        if schema.get("properties"):
            operation["requestBody"] = {
                "required": bool(schema.get("required")),
                "content": {"application/json": {"schema": schema}},
            }
        paths[f"/tools/{tool['name']}"] = {"post": operation}

    return {
        "openapi": "3.0.1",
        "info": {
            "title": "OnDemand Blender MCP Bridge",
            "description": (
                "HTTP surface for a live Blender instance, bridged from the "
                "ondemand-blender-mcp server to the Blender add-on socket on "
                "localhost:9876."
            ),
            "version": __version__,
        },
        "servers": [{"url": server_url, "description": "Public HTTPS bridge"}],
        "paths": paths,
        "components": {
            "securitySchemes": {
                "BridgeKey": {
                    "type": "apiKey",
                    "in": "header",
                    "name": "X-Bridge-Key",
                    "description": "Shared secret sent by OnDemand on every bridge call.",
                }
            }
        },
        "security": [{"BridgeKey": []}],
    }


def build_plugin_body(server_url: str = DEFAULT_BRIDGE_URL) -> dict[str, Any]:
    """The POST /plugin/v1 body, with the OpenAPI schema JSON-stringified."""
    return {
        "name": "Blender MCP Bridge",
        "identifier": "rest_api",
        "description": (
            "Inspect and edit a live Blender scene: query objects, create and "
            "modify geometry, assign materials, import Poly Haven and Sketchfab "
            "assets, and generate 3D models."
        ),
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
            # OnDemand types action.schema as a STRING -> stringify the document.
            "schema": json.dumps(build_openapi(server_url)),
        },
        "creatorPluginConfig": {
            "active": True,
            "fields": {"X-Bridge-Key": "<BRIDGE_SHARED_SECRET>"},
        },
    }


def build_manifest(server_url: str = DEFAULT_BRIDGE_URL) -> dict[str, Any]:
    """The complete tools.json payload."""
    return {
        "$comment": (
            "Generated by ondemand_blender_mcp.manifest — do not hand-edit. "
            "Regenerate with: ondemand-blender-mcp --print-manifest > tools.json"
        ),
        "name": "ondemand-blender-mcp",
        "version": __version__,
        "protocolVersion": "2025-06-18",
        "transports": ["stdio", "streamable-http"],
        "endpoints": {"mcp": "/mcp", "health": "/health"},
        "capabilities": {"tools": {"listChanged": True}},
        "tools": tool_descriptors(),
        "openapi": build_openapi(server_url),
        "ondemandPlugin": build_plugin_body(server_url),
    }
