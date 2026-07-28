"""Unit tests for the Blender TCP client."""

from __future__ import annotations

import pytest

from ondemand_blender_mcp.blender_client import (
    BlenderClient,
    BlenderCommandError,
    BlenderConnectionError,
)


def test_success_envelope_is_unwrapped(blender_server):
    client = BlenderClient(host="127.0.0.1", port=blender_server.port, retries=0)
    result = client.send_command("get_scene_info", {})
    assert result["scene_name"] == "Scene"
    assert result["object_count"] == 3


def test_command_and_params_reach_blender(blender_server):
    client = BlenderClient(host="127.0.0.1", port=blender_server.port, retries=0)
    client.send_command("create_object", {"type": "CUBE", "name": "HeroCube"})
    sent = blender_server.requests[-1]
    assert sent["type"] == "create_object"
    assert sent["params"] == {"type": "CUBE", "name": "HeroCube"}


def test_error_envelope_raises_command_error():
    from tests.conftest import FakeBlenderSocketServer

    server = FakeBlenderSocketServer(
        responder=lambda msg: {"status": "error", "message": "Object 'Ghost' not found"}
    )
    try:
        client = BlenderClient(host="127.0.0.1", port=server.port, retries=0)
        with pytest.raises(BlenderCommandError, match="Ghost"):
            client.send_command("delete_object", {"name": "Ghost"})
    finally:
        server.stop()


def test_closed_port_raises_connection_error():
    # Port 1 is privileged and never listening in the test environment.
    client = BlenderClient(host="127.0.0.1", port=1, retries=0, timeout=2.0)
    with pytest.raises(BlenderConnectionError):
        client.send_command("get_scene_info", {})


def test_chunked_reply_is_reassembled(chunked_blender_server):
    """TCP is a byte stream: a reply split across many recv() calls must rejoin."""
    client = BlenderClient(host="127.0.0.1", port=chunked_blender_server.port, retries=0)
    result = client.send_command("get_scene_info", {})
    assert result["scene_name"] == "Scene"


def test_client_works_as_context_manager(blender_server):
    with BlenderClient(host="127.0.0.1", port=blender_server.port, retries=0) as client:
        assert client.send_command("get_scene_info", {})["object_count"] == 3


def test_retries_are_attempted_then_raise():
    client = BlenderClient(host="127.0.0.1", port=1, retries=2, retry_backoff=0.01, timeout=1.0)
    with pytest.raises(BlenderConnectionError) as excinfo:
        client.send_command("get_scene_info", {})
    assert "3 attempt(s)" in str(excinfo.value)


def test_ping_reports_reachability(blender_server):
    reachable = BlenderClient(host="127.0.0.1", port=blender_server.port, retries=0)
    assert reachable.ping() is True
    unreachable = BlenderClient(host="127.0.0.1", port=1, retries=0, timeout=1.0)
    assert unreachable.ping() is False


def test_non_dict_result_is_wrapped():
    from tests.conftest import FakeBlenderSocketServer

    server = FakeBlenderSocketServer(
        responder=lambda msg: {"status": "success", "result": "plain-string"}
    )
    try:
        client = BlenderClient(host="127.0.0.1", port=server.port, retries=0)
        assert client.send_command("get_scene_info", {}) == {"value": "plain-string"}
    finally:
        server.stop()
