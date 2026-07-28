"""MCP JSON-RPC 2.0 message handling, shared by both transports.

``handle_message`` is transport-agnostic: stdio and streamable-HTTP both parse a
message into a dict, hand it here, and serialise whatever comes back. Returning
``None`` means "this was a notification — emit nothing", which is what the
JSON-RPC spec requires.
"""

from __future__ import annotations

import json
from typing import Any

from . import __version__
from .blender_client import BlenderCommandError, BlenderConnectionError
from .tools import (
    ToolDisabledError,
    ToolValidationError,
    UnknownToolError,
    dispatch,
    tool_descriptors,
)

#: The MCP revision this server implements.
PROTOCOL_VERSION = "2025-06-18"

#: Revisions we will accept in an ``initialize`` request or the
#: ``MCP-Protocol-Version`` HTTP header, newest first.
SUPPORTED_PROTOCOL_VERSIONS: tuple[str, ...] = (
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
)

SERVER_NAME = "ondemand-blender-mcp"

# JSON-RPC 2.0 reserved error codes.
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


def jsonrpc_result(request_id: Any, result: Any) -> dict[str, Any]:
    """Build a JSON-RPC success envelope."""
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def jsonrpc_error(
    request_id: Any, code: int, message: str, data: Any | None = None
) -> dict[str, Any]:
    """Build a JSON-RPC error envelope."""
    error: dict[str, Any] = {"code": int(code), "message": str(message)}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": error}


def server_capabilities() -> dict[str, Any]:
    """Advertise what this server supports.

    ``tools.listChanged`` is declared because the asset tools can become
    available at runtime when the operator flips a toggle in the Blender panel.
    """
    return {"tools": {"listChanged": True}, "logging": {}}


def server_info() -> dict[str, Any]:
    return {"name": SERVER_NAME, "version": __version__}


def _negotiate_version(requested: Any) -> str:
    """Pick a protocol version both sides understand."""
    if isinstance(requested, str) and requested in SUPPORTED_PROTOCOL_VERSIONS:
        return requested
    return PROTOCOL_VERSION


def _text_content(payload: Any) -> list[dict[str, str]]:
    """Wrap a payload as MCP ``content`` (a single JSON text block)."""
    if isinstance(payload, str):
        text = payload
    else:
        text = json.dumps(payload, indent=2, ensure_ascii=False, default=str)
    return [{"type": "text", "text": text}]


def _call_tool(params: dict[str, Any], client: Any, config: Any | None) -> dict[str, Any]:
    """Execute ``tools/call`` and shape the MCP result.

    Tool failures are reported as ``isError: true`` inside a *successful*
    JSON-RPC result — that is what the MCP spec prescribes, so the model can see
    and recover from the error rather than the transport swallowing it.
    """
    name = params.get("name")
    arguments = params.get("arguments") or {}

    if not isinstance(name, str) or not name:
        return {
            "content": _text_content("tools/call requires a string 'name' parameter."),
            "isError": True,
        }
    if not isinstance(arguments, dict):
        return {
            "content": _text_content("tools/call 'arguments' must be an object."),
            "isError": True,
        }

    try:
        result = dispatch(name, arguments, client, config=config)
    except (UnknownToolError, ToolValidationError, ToolDisabledError) as exc:
        return {"content": _text_content(str(exc)), "isError": True}
    except BlenderCommandError as exc:
        return {"content": _text_content(f"Blender error: {exc}"), "isError": True}
    except BlenderConnectionError as exc:
        return {"content": _text_content(f"Blender unreachable: {exc}"), "isError": True}
    except Exception as exc:  # pragma: no cover - defensive catch-all
        return {
            "content": _text_content(f"Unexpected error calling {name}: {exc}"),
            "isError": True,
        }

    return {"content": _text_content(result), "isError": False, "structuredContent": result}


def handle_message(
    message: dict[str, Any], client: Any, config: Any | None = None
) -> dict[str, Any] | None:
    """Route one JSON-RPC message.

    Returns the reply envelope, or ``None`` for notifications (which must not
    produce a response).
    """
    if not isinstance(message, dict):
        return jsonrpc_error(None, INVALID_REQUEST, "Request must be a JSON object.")

    method = message.get("method")
    request_id = message.get("id")
    params = message.get("params") or {}
    if not isinstance(params, dict):
        return jsonrpc_error(request_id, INVALID_PARAMS, "'params' must be an object.")

    if not isinstance(method, str):
        return jsonrpc_error(request_id, INVALID_REQUEST, "Missing 'method'.")

    # Notifications carry no id and never get a reply.
    is_notification = "id" not in message
    if method.startswith("notifications/"):
        return None

    if method == "initialize":
        result = {
            "protocolVersion": _negotiate_version(params.get("protocolVersion")),
            "capabilities": server_capabilities(),
            "serverInfo": server_info(),
            "instructions": (
                "Drive a live Blender instance. Call get_scene_info first to learn "
                "real object names, then create_object / modify_object / "
                "set_material to build. Use get_viewport_screenshot to verify "
                "visually. execute_blender_code is unsandboxed and disabled by "
                "default — prefer the first-class tools."
            ),
        }
        return jsonrpc_result(request_id, result)

    if method == "ping":
        return jsonrpc_result(request_id, {})

    if method in ("tools/list", "listTools"):
        return jsonrpc_result(request_id, {"tools": tool_descriptors()})

    if method in ("tools/call", "callTool"):
        return jsonrpc_result(request_id, _call_tool(params, client, config))

    if is_notification:
        return None

    return jsonrpc_error(
        request_id, METHOD_NOT_FOUND, f"Method not found: {method}"
    )


def handle_raw(raw: str, client: Any, config: Any | None = None) -> dict[str, Any] | None:
    """Parse a raw JSON string and route it. Malformed JSON -> parse error."""
    try:
        message = json.loads(raw)
    except json.JSONDecodeError as exc:
        return jsonrpc_error(None, PARSE_ERROR, f"Invalid JSON: {exc}")

    # A batch is a JSON array of messages; reply with an array of the non-null
    # results, or nothing at all if every element was a notification.
    if isinstance(message, list):
        replies = [
            reply
            for reply in (handle_message(item, client, config) for item in message)
            if reply is not None
        ]
        return replies or None  # type: ignore[return-value]

    return handle_message(message, client, config)
