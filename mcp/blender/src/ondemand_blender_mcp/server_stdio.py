"""stdio transport — newline-delimited JSON-RPC on stdin/stdout.

This is the transport Claude Desktop, Claude Code and Cursor use when they
launch the server as a subprocess (``uvx ondemand-blender-mcp``).

Rule that bites everyone once: **stdout is the protocol channel.** Anything
printed there that is not a JSON-RPC message corrupts the stream, so every
diagnostic in this module goes to stderr.
"""

from __future__ import annotations

import json
import sys
from typing import Any, TextIO

from .blender_client import BlenderClient
from .config import Config
from .protocol import handle_message, jsonrpc_error, PARSE_ERROR


def _log(message: str) -> None:
    """Diagnostics go to stderr — never stdout."""
    print(f"[ondemand-blender-mcp] {message}", file=sys.stderr, flush=True)


def serve_stdio(
    client: Any | None = None,
    stdin: TextIO | None = None,
    stdout: TextIO | None = None,
    config: Config | None = None,
) -> None:
    """Read newline-delimited JSON-RPC from ``stdin`` and reply on ``stdout``.

    Returns cleanly at EOF. Notifications produce no output line.
    """
    cfg = config or Config.from_env()
    active_client = client or BlenderClient(
        host=cfg.blender_host,
        port=cfg.blender_port,
        timeout=cfg.blender_timeout,
        retries=cfg.blender_retries,
    )
    source = stdin if stdin is not None else sys.stdin
    sink = stdout if stdout is not None else sys.stdout

    _log(
        f"stdio transport ready (Blender at {cfg.blender_host}:{cfg.blender_port}, "
        f"code execution {'ENABLED' if cfg.exec_enabled else 'disabled'})"
    )

    for line in source:
        line = line.strip()
        if not line:
            continue

        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            reply: dict[str, Any] | None = jsonrpc_error(
                None, PARSE_ERROR, f"Invalid JSON: {exc}"
            )
        else:
            try:
                reply = handle_message(message, active_client, cfg)
            except Exception as exc:  # pragma: no cover - defensive
                _log(f"unhandled error: {exc}")
                reply = jsonrpc_error(
                    message.get("id") if isinstance(message, dict) else None,
                    -32603,
                    f"Internal error: {exc}",
                )

        if reply is None:
            continue  # notification — no response permitted

        sink.write(json.dumps(reply, ensure_ascii=False, default=str) + "\n")
        sink.flush()

    _log("stdin closed; shutting down")
