"""Protocol routing plus stdio and streamable-HTTP transport smoke tests."""

from __future__ import annotations

import io
import json

import pytest

from ondemand_blender_mcp.config import Config
from ondemand_blender_mcp.protocol import (
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    PROTOCOL_VERSION,
    handle_message,
    handle_raw,
    jsonrpc_error,
    jsonrpc_result,
)
from ondemand_blender_mcp.server_http import create_app, is_origin_allowed
from ondemand_blender_mcp.server_stdio import serve_stdio


# ---------------------------------------------------------------- protocol
def test_jsonrpc_result_shape():
    assert jsonrpc_result(7, {"a": 1}) == {"jsonrpc": "2.0", "id": 7, "result": {"a": 1}}


def test_jsonrpc_error_shape():
    err = jsonrpc_error(7, -32601, "nope")
    assert err["jsonrpc"] == "2.0"
    assert err["id"] == 7
    assert err["error"] == {"code": -32601, "message": "nope"}


def test_initialize_negotiates_and_advertises(fake_client, test_config):
    reply = handle_message(
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": PROTOCOL_VERSION}},
        fake_client, test_config,
    )
    result = reply["result"]
    assert result["protocolVersion"] == PROTOCOL_VERSION
    assert result["capabilities"]["tools"]["listChanged"] is True
    assert result["serverInfo"]["name"] == "ondemand-blender-mcp"
    assert result["serverInfo"]["version"]


def test_initialize_falls_back_on_unknown_version(fake_client, test_config):
    reply = handle_message(
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": "1999-01-01"}},
        fake_client, test_config,
    )
    assert reply["result"]["protocolVersion"] == PROTOCOL_VERSION


def test_tools_list_returns_fourteen(fake_client, test_config):
    reply = handle_message({"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                           fake_client, test_config)
    assert len(reply["result"]["tools"]) == 14


def test_tools_call_success(fake_client, test_config):
    reply = handle_message(
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
         "params": {"name": "get_scene_info", "arguments": {}}},
        fake_client, test_config,
    )
    result = reply["result"]
    assert result["isError"] is False
    assert result["content"][0]["type"] == "text"
    assert json.loads(result["content"][0]["text"])["echo"] == "get_scene_info"


def test_tools_call_unknown_tool_is_error_result(fake_client, test_config):
    reply = handle_message(
        {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
         "params": {"name": "nope", "arguments": {}}},
        fake_client, test_config,
    )
    # MCP reports tool failures inside a successful result, flagged isError.
    assert reply["result"]["isError"] is True
    assert "Unknown tool" in reply["result"]["content"][0]["text"]


def test_tools_call_validation_error_is_error_result(fake_client, test_config):
    reply = handle_message(
        {"jsonrpc": "2.0", "id": 5, "method": "tools/call",
         "params": {"name": "create_object", "arguments": {}}},
        fake_client, test_config,
    )
    assert reply["result"]["isError"] is True
    assert "missing required argument" in reply["result"]["content"][0]["text"]


def test_blender_connection_failure_surfaces_as_tool_error(fake_client, test_config):
    from ondemand_blender_mcp.blender_client import BlenderConnectionError

    fake_client.fail_with(BlenderConnectionError("socket refused"))
    reply = handle_message(
        {"jsonrpc": "2.0", "id": 6, "method": "tools/call",
         "params": {"name": "get_scene_info", "arguments": {}}},
        fake_client, test_config,
    )
    assert reply["result"]["isError"] is True
    assert "unreachable" in reply["result"]["content"][0]["text"].lower()


def test_unknown_method_returns_method_not_found(fake_client, test_config):
    reply = handle_message({"jsonrpc": "2.0", "id": 7, "method": "does/not/exist"},
                           fake_client, test_config)
    assert reply["error"]["code"] == METHOD_NOT_FOUND


def test_notification_returns_none(fake_client, test_config):
    assert handle_message(
        {"jsonrpc": "2.0", "method": "notifications/initialized"}, fake_client, test_config
    ) is None


def test_ping(fake_client, test_config):
    assert handle_message({"jsonrpc": "2.0", "id": 8, "method": "ping"},
                          fake_client, test_config)["result"] == {}


def test_non_object_request_is_invalid(fake_client, test_config):
    assert handle_message([], fake_client, test_config)["error"]["code"] == INVALID_REQUEST


def test_handle_raw_reports_parse_error(fake_client, test_config):
    assert handle_raw("{not json", fake_client, test_config)["error"]["code"] == -32700


# ------------------------------------------------------------------ stdio
def test_serve_stdio_replies_per_line(fake_client, test_config):
    stdin = io.StringIO(
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}) + "\n"
        + json.dumps({"jsonrpc": "2.0", "id": 2, "method": "ping"}) + "\n"
    )
    stdout = io.StringIO()
    serve_stdio(client=fake_client, stdin=stdin, stdout=stdout, config=test_config)
    lines = [ln for ln in stdout.getvalue().splitlines() if ln.strip()]
    assert len(lines) == 2
    assert len(json.loads(lines[0])["result"]["tools"]) == 14
    assert json.loads(lines[1])["id"] == 2


def test_serve_stdio_emits_nothing_for_notifications(fake_client, test_config):
    stdin = io.StringIO(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
    stdout = io.StringIO()
    serve_stdio(client=fake_client, stdin=stdin, stdout=stdout, config=test_config)
    assert stdout.getvalue().strip() == ""


def test_serve_stdio_handles_malformed_json(fake_client, test_config):
    stdout = io.StringIO()
    serve_stdio(client=fake_client, stdin=io.StringIO("{oops\n"), stdout=stdout, config=test_config)
    assert json.loads(stdout.getvalue().strip())["error"]["code"] == -32700


# ------------------------------------------------------------------- HTTP
@pytest.mark.parametrize(
    "origin,expected",
    [
        (None, True),
        ("", True),
        ("http://localhost:3000", True),
        ("http://127.0.0.1:8080", True),
        ("https://evil.example", False),
        ("http://attacker.test", False),
    ],
)
def test_is_origin_allowed(origin, expected):
    assert is_origin_allowed(origin) is expected


def test_origin_allow_list_opens_a_specific_origin():
    assert is_origin_allowed("https://app.on-demand.io", {"https://app.on-demand.io"})
    assert is_origin_allowed("https://anything.test", {"*"})


@pytest.fixture()
def http_client(fake_client, test_config):
    werkzeug = pytest.importorskip("werkzeug")
    from werkzeug.test import Client

    return Client(create_app(client=fake_client, config=test_config))


def test_health_endpoint(http_client):
    response = http_client.get("/health")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["status"] == "ok"
    assert payload["toolCount"] == 14
    assert payload["codeExecutionEnabled"] is False
    assert payload["telemetryEnabled"] is False


def test_post_mcp_tools_list(http_client):
    response = http_client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={"MCP-Protocol-Version": PROTOCOL_VERSION},
    )
    assert response.status_code == 200
    assert len(response.get_json()["result"]["tools"]) == 14
    assert response.headers["MCP-Protocol-Version"] == PROTOCOL_VERSION


def test_post_mcp_rejects_foreign_origin(http_client):
    response = http_client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403


def test_post_mcp_allows_localhost_origin(http_client):
    response = http_client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert response.status_code == 200


def test_post_mcp_notification_returns_202(http_client):
    response = http_client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert response.status_code == 202


def test_post_mcp_malformed_json_returns_400(http_client):
    response = http_client.post(
        "/mcp", data=b"{nope", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == -32700


def test_get_mcp_opens_sse_stream(http_client):
    response = http_client.get("/mcp")
    assert response.status_code == 200
    assert response.headers["Content-Type"].startswith("text/event-stream")
    response.close()


def test_root_discovery_document(http_client):
    payload = http_client.get("/").get_json()
    assert payload["endpoints"] == {"mcp": "/mcp", "health": "/health"}
    assert payload["toolCount"] == 14


def test_unknown_route_404(http_client):
    assert http_client.get("/nope").status_code == 404
