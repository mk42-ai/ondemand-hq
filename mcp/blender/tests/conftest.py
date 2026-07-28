"""Shared fixtures for the ondemand-blender-mcp test suite."""

from __future__ import annotations

import json
import socket
import threading
import time
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]


class FakeBlenderClient:
    """A stand-in for :class:`BlenderClient` that records every call."""

    def __init__(self, result: dict[str, Any] | None = None) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.result = result if result is not None else {"ok": True}
        self._raise: Exception | None = None

    def fail_with(self, exc: Exception) -> None:
        """Make the next ``send_command`` raise ``exc``."""
        self._raise = exc

    def send_command(self, command_type: str, params: dict[str, Any] | None = None):
        self.calls.append((command_type, dict(params or {})))
        if self._raise is not None:
            exc, self._raise = self._raise, None
            raise exc
        return dict(self.result, echo=command_type)

    def ping(self) -> bool:
        return self._raise is None

    @property
    def last_call(self) -> tuple[str, dict[str, Any]]:
        return self.calls[-1]


class FakeBlenderSocketServer:
    """A real in-process TCP server speaking the Blender add-on wire protocol."""

    def __init__(self, responder=None, chunk_size: int | None = None) -> None:
        self.responder = responder or self._default_responder
        self.chunk_size = chunk_size
        self.requests: list[dict[str, Any]] = []
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(8)
        self.port: int = self._sock.getsockname()[1]
        self._running = True
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    @staticmethod
    def _default_responder(message: dict[str, Any]) -> dict[str, Any]:
        return {
            "status": "success",
            "result": {
                "echo": message.get("type"),
                "params": message.get("params", {}),
                "scene_name": "Scene",
                "object_count": 3,
            },
        }

    def _serve(self) -> None:
        while self._running:
            try:
                conn, _ = self._sock.accept()
            except OSError:
                return
            try:
                buffer = b""
                message: dict[str, Any] | None = None
                while True:
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    buffer += chunk
                    try:
                        message = json.loads(buffer)
                        break
                    except json.JSONDecodeError:
                        continue
                if message is None:
                    conn.close()
                    continue
                self.requests.append(message)
                raw = json.dumps(self.responder(message)).encode("utf-8")
                if self.chunk_size:
                    for i in range(0, len(raw), self.chunk_size):
                        conn.sendall(raw[i : i + self.chunk_size])
                        time.sleep(0.001)
                else:
                    conn.sendall(raw)
            except OSError:
                pass
            finally:
                try:
                    conn.close()
                except OSError:
                    pass

    def stop(self) -> None:
        self._running = False
        try:
            self._sock.close()
        except OSError:
            pass


@pytest.fixture()
def fake_client() -> FakeBlenderClient:
    return FakeBlenderClient()


@pytest.fixture()
def blender_server():
    server = FakeBlenderSocketServer()
    yield server
    server.stop()


@pytest.fixture()
def chunked_blender_server():
    """Replies dribbled out 7 bytes at a time to exercise partial reads."""
    server = FakeBlenderSocketServer(chunk_size=7)
    yield server
    server.stop()


@pytest.fixture(scope="session")
def tools_manifest() -> dict[str, Any]:
    path = REPO_ROOT / "tools.json"
    assert path.exists(), f"tools.json missing at {path}"
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture()
def test_config():
    from ondemand_blender_mcp.config import Config

    return Config(exec_enabled=False, telemetry_enabled=False)
