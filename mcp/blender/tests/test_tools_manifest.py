"""Schema validation for the generated ``tools.json`` registration manifest."""

from __future__ import annotations

import json

import pytest

from ondemand_blender_mcp.tools import TOOL_NAMES


def test_manifest_loads(tools_manifest):
    assert tools_manifest["name"] == "ondemand-blender-mcp"
    assert tools_manifest["protocolVersion"]
    assert set(tools_manifest["transports"]) == {"stdio", "streamable-http"}
    assert tools_manifest["endpoints"] == {"mcp": "/mcp", "health": "/health"}


def test_manifest_declares_the_same_fourteen_tools(tools_manifest):
    manifest_names = {tool["name"] for tool in tools_manifest["tools"]}
    assert manifest_names == set(TOOL_NAMES)
    assert len(tools_manifest["tools"]) == 14


def test_capabilities_declare_list_changed(tools_manifest):
    assert tools_manifest["capabilities"]["tools"]["listChanged"] is True


def test_every_tool_entry_is_complete(tools_manifest):
    for tool in tools_manifest["tools"]:
        assert tool.get("name")
        assert tool.get("description")
        schema = tool.get("inputSchema")
        assert isinstance(schema, dict)
        assert schema["type"] == "object"
        assert "properties" in schema
        assert schema["additionalProperties"] is False
        for prop, spec in schema["properties"].items():
            assert "type" in spec, f"{tool['name']}.{prop} missing type"
            assert spec.get("description"), f"{tool['name']}.{prop} missing description"
        for required in schema.get("required", []):
            assert required in schema["properties"]


def test_input_schemas_compile_as_json_schema(tools_manifest):
    jsonschema = pytest.importorskip("jsonschema")
    from jsonschema.validators import Draft202012Validator

    for tool in tools_manifest["tools"]:
        Draft202012Validator.check_schema(tool["inputSchema"])


def test_openapi_document_is_present_and_consistent(tools_manifest):
    openapi = tools_manifest["openapi"]
    assert openapi["openapi"].startswith("3.0")
    assert openapi["servers"][0]["url"].startswith("https://")
    # One POST operation per tool.
    assert len(openapi["paths"]) == 14
    operation_ids = {
        spec["post"]["operationId"] for spec in openapi["paths"].values()
    }
    assert operation_ids == set(TOOL_NAMES)
    for path, spec in openapi["paths"].items():
        post = spec["post"]
        assert post["description"]
        assert post["summary"]
        assert "200" in post["responses"]


def test_openapi_respects_ondemand_publishing_limits(tools_manifest):
    """OnDemand caps a REST API Agent schema at 10 operations and 5 MB."""
    openapi = tools_manifest["openapi"]
    serialised = json.dumps(openapi)
    assert len(serialised) < 5 * 1024 * 1024, "schema exceeds OnDemand's 5 MB limit"
    # 14 tools > the 10-operation publishing cap, so this manifest is valid for a
    # PRIVATE plugin but must be split before marketplace publication.
    assert len(openapi["paths"]) == 14


def test_ondemand_plugin_body_is_registration_ready(tools_manifest):
    plugin = tools_manifest["ondemandPlugin"]
    required = [
        "name",
        "identifier",
        "description",
        "category",
        "logoUrl",
        "type",
        "source",
        "status",
        "fileSubType",
        "chatSubType",
        "privacyPolicy",
        "action",
        "creatorPluginConfig",
    ]
    for field in required:
        assert field in plugin, f"POST /plugin/v1 body missing required field {field}"


def test_action_schema_is_a_stringified_openapi_document(tools_manifest):
    """OnDemand types ``action.schema`` as a STRING, not a nested object."""
    schema_field = tools_manifest["ondemandPlugin"]["action"]["schema"]
    assert isinstance(schema_field, str)
    assert json.loads(schema_field) == tools_manifest["openapi"]


def test_auth_header_declared_in_action_fields(tools_manifest):
    fields = tools_manifest["ondemandPlugin"]["action"]["fields"]
    keys = {field["key"]: field for field in fields}
    assert "X-Bridge-Key" in keys
    assert keys["X-Bridge-Key"]["site"] == "header"
    assert keys["X-Bridge-Key"]["required"] is True


def test_no_real_secret_committed(tools_manifest):
    blob = json.dumps(tools_manifest)
    assert "ghp_" not in blob
    assert tools_manifest["ondemandPlugin"]["creatorPluginConfig"]["fields"][
        "X-Bridge-Key"
    ].startswith("<")
