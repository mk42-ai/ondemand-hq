"""Streamable-HTTP transport — a single ``/mcp`` endpoint plus ``/health``.

Implements the MCP Streamable HTTP transport on a hand-rolled WSGI app so the
package keeps zero runtime dependencies:

* ``POST /mcp``   — a JSON-RPC request; replies with a JSON-RPC response.
* ``GET  /mcp``   — opens an SSE stream (``text/event-stream``) for
                    server-initiated messages and keep-alives.
* ``GET  /health``— liveness/readiness probe used by Docker and load balancers.

Security properties enforced here:

* **Origin validation** on every ``/mcp`` request. The MCP specification
  requires it to defeat DNS-rebinding: a browser on a malicious page can reach
  ``localhost``, but it cannot forge the ``Origin`` header.
* **``MCP-Protocol-Version``** is read from the request and echoed back so
  proxies and clients can negotiate without parsing the body.
* No credentials are ever logged.
"""

from __future__ import annotations

import json
import time
from typing import Any, Callable, Iterable
from urllib.parse import urlsplit

from .blender_client import BlenderClient
from .config import Config
from .protocol import (
    PARSE_ERROR,
    PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    handle_message,
    jsonrpc_error,
    server_capabilities,
    server_info,
)
from .tools import TOOL_NAMES

#: Hostnames that are always acceptable as a request Origin.
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]"}

_SSE_KEEPALIVE_SECONDS = 15.0
_SSE_MAX_SECONDS = 300.0


def is_origin_allowed(origin: str | None, allowed: set[str] | None = None) -> bool:
    """Decide whether a request ``Origin`` may talk to ``/mcp``.

    * ``None``/empty — a non-browser client (curl, an SDK, the OnDemand tool
      layer). Browsers always send Origin on cross-origin requests, so absence
      is not a rebinding risk. Allowed.
    * ``localhost`` / ``127.0.0.1`` / ``::1`` on any port and scheme. Allowed.
    * Anything else only when explicitly allow-listed via
      ``MCP_ALLOWED_ORIGINS``. A ``*`` entry disables the check entirely.
    """
    if origin is None or origin.strip() == "":
        return True

    origin = origin.strip()
    allowed = allowed or set()
    if "*" in allowed or origin in allowed:
        return True

    try:
        parts = urlsplit(origin)
    except ValueError:
        return False

    host = (parts.hostname or "").lower()
    return host in LOCAL_HOSTS


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")


def _negotiate_header_version(requested: str | None) -> str:
    if requested and requested in SUPPORTED_PROTOCOL_VERSIONS:
        return requested
    return PROTOCOL_VERSION


class MCPHttpApp:
    """A minimal WSGI application implementing the MCP HTTP transport."""

    def __init__(self, client: Any | None = None, config: Config | None = None) -> None:
        self.config = config or Config.from_env()
        self.client = client or BlenderClient(
            host=self.config.blender_host,
            port=self.config.blender_port,
            timeout=self.config.blender_timeout,
            retries=self.config.blender_retries,
        )
        self.started_at = time.time()

    # -- WSGI entry point ------------------------------------------------
    def __call__(
        self, environ: dict[str, Any], start_response: Callable[..., Any]
    ) -> Iterable[bytes]:
        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO", "/") or "/"
        path = path.rstrip("/") or "/"

        if path == "/health":
            return self._health(start_response)
        if path == "/mcp":
            if method == "POST":
                return self._mcp_post(environ, start_response)
            if method == "GET":
                return self._mcp_get(environ, start_response)
            if method == "DELETE":
                # Session teardown: this server is stateless, so acknowledge.
                return self._respond(start_response, "204 No Content", b"")
            if method == "OPTIONS":
                return self._preflight(environ, start_response)
            return self._respond(
                start_response,
                "405 Method Not Allowed",
                _json_bytes({"error": "Use POST or GET on /mcp."}),
                extra=[("Allow", "GET, POST, DELETE, OPTIONS")],
            )
        if path == "/":
            return self._root(start_response)

        return self._respond(
            start_response, "404 Not Found", _json_bytes({"error": f"No route {path}"})
        )

    # -- helpers ---------------------------------------------------------
    @staticmethod
    def _respond(
        start_response: Callable[..., Any],
        status: str,
        body: bytes,
        content_type: str = "application/json",
        extra: list[tuple[str, str]] | None = None,
    ) -> Iterable[bytes]:
        headers = [
            ("Content-Type", content_type),
            ("Content-Length", str(len(body))),
            ("Cache-Control", "no-store"),
            ("X-Content-Type-Options", "nosniff"),
        ]
        if extra:
            headers.extend(extra)
        start_response(status, headers)
        return [body]

    def _preflight(
        self, environ: dict[str, Any], start_response: Callable[..., Any]
    ) -> Iterable[bytes]:
        origin = environ.get("HTTP_ORIGIN")
        if not is_origin_allowed(origin, self.config.allowed_origins):
            return self._respond(
                start_response, "403 Forbidden", _json_bytes({"error": "Origin not allowed"})
            )
        return self._respond(
            start_response,
            "204 No Content",
            b"",
            extra=[
                ("Access-Control-Allow-Origin", origin or "*"),
                ("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS"),
                (
                    "Access-Control-Allow-Headers",
                    "Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Authorization",
                ),
                ("Access-Control-Max-Age", "600"),
            ],
        )

    # -- routes ----------------------------------------------------------
    def _root(self, start_response: Callable[..., Any]) -> Iterable[bytes]:
        body = _json_bytes(
            {
                "name": server_info()["name"],
                "version": server_info()["version"],
                "protocolVersion": PROTOCOL_VERSION,
                "endpoints": {"mcp": "/mcp", "health": "/health"},
                "toolCount": len(TOOL_NAMES),
                "transport": "streamable-http",
            }
        )
        return self._respond(start_response, "200 OK", body)

    def _health(self, start_response: Callable[..., Any]) -> Iterable[bytes]:
        """Liveness probe.

        Reports the process as healthy even when Blender is not connected —
        the MCP server is up and answering; Blender reachability is reported
        separately so an orchestrator can distinguish the two failure modes.
        """
        blender_up = False
        try:
            blender_up = bool(self.client.ping())
        except Exception:  # pragma: no cover - ping is already defensive
            blender_up = False

        body = _json_bytes(
            {
                "status": "ok",
                "service": server_info()["name"],
                "version": server_info()["version"],
                "protocolVersion": PROTOCOL_VERSION,
                "uptimeSeconds": round(time.time() - self.started_at, 3),
                "toolCount": len(TOOL_NAMES),
                "blender": {
                    "host": self.config.blender_host,
                    "port": self.config.blender_port,
                    "connected": blender_up,
                },
                "codeExecutionEnabled": self.config.exec_enabled,
                "telemetryEnabled": self.config.telemetry_enabled,
            }
        )
        return self._respond(start_response, "200 OK", body)

    def _mcp_post(
        self, environ: dict[str, Any], start_response: Callable[..., Any]
    ) -> Iterable[bytes]:
        origin = environ.get("HTTP_ORIGIN")
        if not is_origin_allowed(origin, self.config.allowed_origins):
            return self._respond(
                start_response,
                "403 Forbidden",
                _json_bytes(
                    {
                        "error": "Origin not allowed",
                        "detail": (
                            "Set MCP_ALLOWED_ORIGINS to permit this origin. Origin "
                            "validation defends against DNS-rebinding attacks."
                        ),
                    }
                ),
            )

        version = _negotiate_header_version(environ.get("HTTP_MCP_PROTOCOL_VERSION"))
        extra = [("MCP-Protocol-Version", version)]
        if origin:
            extra.append(("Access-Control-Allow-Origin", origin))

        try:
            length = int(environ.get("CONTENT_LENGTH") or 0)
        except (TypeError, ValueError):
            length = 0
        raw = environ["wsgi.input"].read(length) if length > 0 else b""

        try:
            message = json.loads(raw.decode("utf-8")) if raw else None
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._respond(
                start_response,
                "400 Bad Request",
                _json_bytes(jsonrpc_error(None, PARSE_ERROR, f"Invalid JSON: {exc}")),
                extra=extra,
            )

        if message is None:
            return self._respond(
                start_response,
                "400 Bad Request",
                _json_bytes(jsonrpc_error(None, PARSE_ERROR, "Empty request body.")),
                extra=extra,
            )

        if isinstance(message, list):
            replies = [
                reply
                for reply in (
                    handle_message(item, self.client, self.config) for item in message
                )
                if reply is not None
            ]
            if not replies:
                return self._respond(start_response, "202 Accepted", b"", extra=extra)
            return self._respond(start_response, "200 OK", _json_bytes(replies), extra=extra)

        reply = handle_message(message, self.client, self.config)
        if reply is None:
            # A notification: acknowledge with 202 and an empty body.
            return self._respond(start_response, "202 Accepted", b"", extra=extra)

        return self._respond(start_response, "200 OK", _json_bytes(reply), extra=extra)

    def _mcp_get(
        self, environ: dict[str, Any], start_response: Callable[..., Any]
    ) -> Iterable[bytes]:
        """Open an SSE stream.

        This server is stateless and does not push unsolicited messages, so the
        stream carries an initial ``endpoint`` event followed by periodic
        comment keep-alives until the client disconnects or the cap elapses.
        """
        origin = environ.get("HTTP_ORIGIN")
        if not is_origin_allowed(origin, self.config.allowed_origins):
            return self._respond(
                start_response, "403 Forbidden", _json_bytes({"error": "Origin not allowed"})
            )

        version = _negotiate_header_version(environ.get("HTTP_MCP_PROTOCOL_VERSION"))
        # NOTE: `Connection` is a hop-by-hop header and PEP 3333 forbids a WSGI
        # application from setting it — the server/gateway owns connection
        # management. Emitting it raises AssertionError in wsgiref.
        headers = [
            ("Content-Type", "text/event-stream; charset=utf-8"),
            ("Cache-Control", "no-cache, no-store"),
            ("X-Accel-Buffering", "no"),
            ("MCP-Protocol-Version", version),
        ]
        if origin:
            headers.append(("Access-Control-Allow-Origin", origin))
        start_response("200 OK", headers)

        return self._sse_stream()

    def _sse_stream(self) -> Iterable[bytes]:
        hello = json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "notifications/ready",
                "params": {
                    "serverInfo": server_info(),
                    "capabilities": server_capabilities(),
                    "protocolVersion": PROTOCOL_VERSION,
                },
            },
            ensure_ascii=False,
        )
        yield f"event: message\ndata: {hello}\n\n".encode("utf-8")

        deadline = time.time() + _SSE_MAX_SECONDS
        while time.time() < deadline:
            time.sleep(_SSE_KEEPALIVE_SECONDS)
            yield b": keep-alive\n\n"


def create_app(client: Any | None = None, config: Config | None = None) -> MCPHttpApp:
    """Build the WSGI application (the name test suites and servers look for)."""
    return MCPHttpApp(client=client, config=config)


def run_http_server(
    host: str | None = None,
    port: int | None = None,
    client: Any | None = None,
    config: Config | None = None,
) -> None:
    """Serve the app with the standard library's threaded WSGI server."""
    from socketserver import ThreadingMixIn
    from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

    cfg = config or Config.from_env()
    app = create_app(client=client, config=cfg)
    bind_host = host or cfg.http_host
    bind_port = int(port or cfg.http_port)

    class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
        """Concurrent requests: SSE streams must not block JSON-RPC calls."""

        daemon_threads = True
        allow_reuse_address = True

    class QuietHandler(WSGIRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
            import sys

            sys.stderr.write(
                "[ondemand-blender-mcp] %s - %s\n" % (self.address_string(), fmt % args)
            )

    httpd = make_server(
        bind_host,
        bind_port,
        app,
        server_class=ThreadingWSGIServer,
        handler_class=QuietHandler,
    )
    import sys

    print(
        f"[ondemand-blender-mcp] streamable-HTTP on http://{bind_host}:{bind_port}"
        f"  (POST/GET /mcp, GET /health)",
        file=sys.stderr,
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:  # pragma: no cover
        pass
    finally:
        httpd.server_close()
