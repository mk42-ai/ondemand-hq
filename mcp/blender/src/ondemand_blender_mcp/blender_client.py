"""TCP client for the Blender add-on socket server.

The Blender side (``addon.py``) listens on ``localhost:9876`` and speaks a tiny
newline-agnostic JSON protocol::

    -->  {"type": "create_object", "params": {"type": "CUBE"}}
    <--  {"status": "success", "result": {...}}
    <--  {"status": "error",   "message": "..."}

Two details make this harder than it looks and are handled here:

1. **Partial reads.** TCP is a byte stream, not a message stream. A reply can
   arrive in arbitrarily many chunks, so we accumulate until ``json.loads``
   succeeds rather than trusting a single ``recv``.
2. **Blender blocks.** The add-on marshals work onto Blender's main thread, and
   a heavy scene operation can stall it. We therefore use generous timeouts and
   bounded retries with backoff, and surface a typed error instead of hanging.
"""

from __future__ import annotations

import json
import socket
import time
from typing import Any

DEFAULT_HOST = "localhost"
DEFAULT_PORT = 9876
DEFAULT_TIMEOUT = 30.0
DEFAULT_RETRIES = 2
DEFAULT_BACKOFF = 0.5
_RECV_CHUNK = 8192

# Guard against a wedged or malicious peer streaming forever without ever
# producing parseable JSON.
MAX_RESPONSE_BYTES = 64 * 1024 * 1024


class BlenderConnectionError(Exception):
    """The Blender socket server could not be reached or the link failed.

    Raised for connection refusal, DNS failure, timeouts and truncated
    replies — i.e. transport problems, as opposed to a command that Blender
    received and actively rejected.
    """


class BlenderCommandError(Exception):
    """Blender received the command and returned ``status: "error"``."""


class BlenderClient:
    """A small, synchronous request/response client for the Blender add-on.

    Each :meth:`send_command` opens a fresh connection by default, which keeps
    the client stateless and safe to share across the single-threaded MCP
    dispatch loop. Pass ``persistent=True`` to reuse one socket instead.
    """

    def __init__(
        self,
        host: str = DEFAULT_HOST,
        port: int = DEFAULT_PORT,
        timeout: float = DEFAULT_TIMEOUT,
        retries: int = DEFAULT_RETRIES,
        retry_backoff: float = DEFAULT_BACKOFF,
        persistent: bool = False,
    ) -> None:
        self.host = host
        self.port = int(port)
        self.timeout = float(timeout)
        self.retries = max(0, int(retries))
        self.retry_backoff = float(retry_backoff)
        self.persistent = bool(persistent)
        self._sock: socket.socket | None = None

    # ------------------------------------------------------------------
    # context manager
    # ------------------------------------------------------------------
    def __enter__(self) -> "BlenderClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self.close()
        return False

    def close(self) -> None:
        """Close any persistent socket. Safe to call repeatedly."""
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None

    # ------------------------------------------------------------------
    # internals
    # ------------------------------------------------------------------
    def _connect(self) -> socket.socket:
        if self.persistent and self._sock is not None:
            return self._sock
        sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        sock.settimeout(self.timeout)
        # Blender replies are latency-sensitive and small; disable Nagle.
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except (OSError, AttributeError):  # pragma: no cover - platform dependent
            pass
        if self.persistent:
            self._sock = sock
        return sock

    @staticmethod
    def _read_json(sock: socket.socket) -> dict[str, Any]:
        """Read from ``sock`` until the accumulated bytes parse as one JSON object."""
        buffer = bytearray()
        while True:
            try:
                chunk = sock.recv(_RECV_CHUNK)
            except socket.timeout as exc:
                raise BlenderConnectionError(
                    "Timed out waiting for a reply from Blender. The add-on may be "
                    "busy on the main thread, or the operation is too large."
                ) from exc
            if not chunk:
                # Peer closed. Either we have a complete document or we do not.
                if not buffer:
                    raise BlenderConnectionError(
                        "Blender closed the connection without sending a reply."
                    )
                try:
                    return json.loads(buffer.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise BlenderConnectionError(
                        f"Truncated or invalid JSON reply from Blender "
                        f"({len(buffer)} bytes)."
                    ) from exc

            buffer.extend(chunk)
            if len(buffer) > MAX_RESPONSE_BYTES:
                raise BlenderConnectionError(
                    f"Reply from Blender exceeded {MAX_RESPONSE_BYTES} bytes; aborting."
                )
            # Try to parse on every chunk boundary: the reply is one JSON
            # document, so the first successful parse is the whole message.
            try:
                return json.loads(buffer.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------
    def send_command(
        self, command_type: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Send one command to Blender and return the unwrapped ``result``.

        Raises:
            BlenderCommandError: Blender answered with ``status: "error"``.
            BlenderConnectionError: the socket could not be established or the
                reply never arrived / could not be parsed.
        """
        payload = json.dumps(
            {"type": command_type, "params": params or {}},
            ensure_ascii=False,
        ).encode("utf-8")

        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            sock: socket.socket | None = None
            try:
                sock = self._connect()
                sock.sendall(payload)
                envelope = self._read_json(sock)
                break
            except BlenderCommandError:
                raise
            except (OSError, BlenderConnectionError) as exc:
                last_error = exc
                self.close()
                if attempt < self.retries:
                    time.sleep(self.retry_backoff * (2**attempt))
                    continue
                raise BlenderConnectionError(
                    f"Could not reach the Blender add-on at {self.host}:{self.port} "
                    f"after {attempt + 1} attempt(s): {exc}. Is Blender running with "
                    f"the BlenderMCP panel connected?"
                ) from exc
            finally:
                if sock is not None and not self.persistent:
                    try:
                        sock.close()
                    except OSError:
                        pass
        else:  # pragma: no cover - defensive; loop always breaks or raises
            raise BlenderConnectionError(str(last_error))

        if not isinstance(envelope, dict):
            raise BlenderConnectionError(
                f"Malformed reply from Blender: expected a JSON object, got "
                f"{type(envelope).__name__}."
            )

        status = envelope.get("status")
        if status == "error":
            raise BlenderCommandError(
                str(envelope.get("message") or "Blender reported an unspecified error.")
            )
        if status == "success":
            result = envelope.get("result", {})
            return result if isinstance(result, dict) else {"value": result}

        # Tolerate an add-on that returns a bare object without the envelope.
        return envelope

    def ping(self) -> bool:
        """Best-effort liveness probe used by ``/health``."""
        try:
            self.send_command("get_scene_info", {})
            return True
        except (BlenderConnectionError, BlenderCommandError):
            return False
