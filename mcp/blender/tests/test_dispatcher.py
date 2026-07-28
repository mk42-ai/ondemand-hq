"""Unit tests for the tool registry and the validating dispatcher."""

from __future__ import annotations

import pytest

from ondemand_blender_mcp.config import Config
from ondemand_blender_mcp.tools import (
    TOOL_INDEX,
    TOOL_NAMES,
    TOOLS,
    ToolDisabledError,
    ToolValidationError,
    UnknownToolError,
    dispatch,
    tool_descriptors,
)

EXPECTED_TOOLS = [
    "get_scene_info",
    "get_object_info",
    "get_viewport_screenshot",
    "execute_blender_code",
    "create_object",
    "modify_object",
    "delete_object",
    "set_material",
    "poly_haven_search",
    "poly_haven_download",
    "sketchfab_search",
    "sketchfab_download",
    "hyper3d_generate_model",
    "hunyuan3d_generate_model",
]


def test_exactly_fourteen_tools():
    assert len(TOOLS) == 14
    assert len(TOOL_NAMES) == 14
    assert set(TOOL_NAMES) == set(EXPECTED_TOOLS)
    assert set(TOOL_INDEX) == set(EXPECTED_TOOLS)


@pytest.mark.parametrize("name", EXPECTED_TOOLS)
def test_every_descriptor_is_well_formed(name):
    tool = TOOL_INDEX[name]
    assert tool["name"] == name
    assert isinstance(tool["description"], str) and len(tool["description"]) > 20
    schema = tool["inputSchema"]
    assert schema["type"] == "object"
    assert "properties" in schema
    assert schema["additionalProperties"] is False
    for prop, spec in schema["properties"].items():
        assert "type" in spec, f"{name}.{prop} has no type"
        assert spec.get("description"), f"{name}.{prop} has no description"
    for required in schema.get("required", []):
        assert required in schema["properties"]


def test_dispatch_forwards_and_returns(fake_client):
    result = dispatch("get_scene_info", {}, fake_client)
    assert fake_client.last_call == ("get_scene_info", {})
    assert result["echo"] == "get_scene_info"


def test_dispatch_forwards_arguments_verbatim(fake_client):
    dispatch("create_object", {"type": "SPHERE", "location": [1, 2, 3]}, fake_client)
    command, params = fake_client.last_call
    assert command == "create_object"
    assert params == {"type": "SPHERE", "location": [1, 2, 3]}


def test_unknown_tool_raises(fake_client):
    with pytest.raises(UnknownToolError):
        dispatch("teleport_object", {}, fake_client)


@pytest.mark.parametrize(
    "name,args",
    [
        ("create_object", {}),
        ("get_object_info", {}),
        ("execute_blender_code", {}),
        ("delete_object", {}),
        ("set_material", {}),
        ("poly_haven_download", {"asset_id": "x"}),
    ],
)
def test_missing_required_argument_raises(name, args, fake_client):
    with pytest.raises(ToolValidationError, match="missing required argument"):
        dispatch(name, args, fake_client)


@pytest.mark.parametrize(
    "name,args",
    [
        ("get_object_info", {"name": 123}),
        ("create_object", {"type": "CUBE", "location": "0,0,0"}),
        ("execute_blender_code", {"code": ["import bpy"]}),
        ("get_viewport_screenshot", {"max_size": "big"}),
    ],
)
def test_wrong_typed_argument_raises(name, args, fake_client):
    with pytest.raises(ToolValidationError):
        dispatch(name, args, fake_client)


def test_enum_violation_raises(fake_client):
    with pytest.raises(ToolValidationError, match="is not one of"):
        dispatch("create_object", {"type": "DODECAHEDRON"}, fake_client)


def test_unknown_argument_rejected(fake_client):
    with pytest.raises(ToolValidationError, match="unexpected argument"):
        dispatch("get_scene_info", {"nope": 1}, fake_client)


def test_numeric_bounds_enforced(fake_client):
    with pytest.raises(ToolValidationError, match="above the maximum"):
        dispatch("get_viewport_screenshot", {"max_size": 99999}, fake_client)
    with pytest.raises(ToolValidationError, match="below the minimum"):
        dispatch("get_viewport_screenshot", {"max_size": 1}, fake_client)


def test_vector_length_enforced(fake_client):
    with pytest.raises(ToolValidationError, match="at least 3 items"):
        dispatch("create_object", {"type": "CUBE", "location": [0, 0]}, fake_client)


def test_booleans_are_not_valid_numbers(fake_client):
    """JSON Schema separates boolean from integer even though Python does not."""
    with pytest.raises(ToolValidationError):
        dispatch("get_viewport_screenshot", {"max_size": True}, fake_client)


def test_exec_disabled_by_default(fake_client):
    config = Config(exec_enabled=False)
    with pytest.raises(ToolDisabledError, match="disabled"):
        dispatch("execute_blender_code", {"code": "import bpy"}, fake_client, config=config)


def test_exec_allowed_when_enabled(fake_client):
    config = Config(exec_enabled=True)
    dispatch("execute_blender_code", {"code": "import bpy"}, fake_client, config=config)
    assert fake_client.last_call[0] == "execute_blender_code"


def test_tool_descriptors_shape():
    descriptors = tool_descriptors()
    assert len(descriptors) == 14
    for descriptor in descriptors:
        assert set(descriptor) >= {"name", "description", "inputSchema"}
