"""Tool surface: MCP descriptors plus a validating dispatcher.

The 14 descriptors here are the single source of truth. ``tools.json`` (used
for OnDemand plugin registration) is generated from this module, so the two can
never drift.

Every ``inputSchema`` is JSON Schema 2020-12 with ``additionalProperties: false``
and a description on every property — both are hard requirements of OnDemand's
REST API Agent publishing rules.
"""

from __future__ import annotations

from typing import Any, Iterable

# --------------------------------------------------------------------------
# errors
# --------------------------------------------------------------------------


class UnknownToolError(Exception):
    """The requested tool name is not part of this server's surface."""


class ToolValidationError(Exception):
    """The supplied arguments do not satisfy the tool's inputSchema."""


class ToolDisabledError(Exception):
    """The tool exists but is switched off by configuration (e.g. code exec)."""


# --------------------------------------------------------------------------
# reusable schema fragments
# --------------------------------------------------------------------------

_VECTOR3 = {
    "type": "array",
    "description": "A 3-component vector [x, y, z] in Blender world units.",
    "items": {"type": "number"},
    "minItems": 3,
    "maxItems": 3,
}

_OBJECT_TYPES = [
    "CUBE",
    "SPHERE",
    "CYLINDER",
    "PLANE",
    "CONE",
    "TORUS",
    "EMPTY",
    "CAMERA",
    "LIGHT",
]


def _schema(properties: dict[str, Any], required: Iterable[str] = ()) -> dict[str, Any]:
    """Build a strict JSON Schema 2020-12 object schema."""
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": properties,
        "required": list(required),
        "additionalProperties": False,
    }


# --------------------------------------------------------------------------
# the 14 tools
# --------------------------------------------------------------------------

TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_scene_info",
        "description": (
            "Inspect the active Blender scene. Returns the scene name, the object "
            "count and every object with its type, location, rotation and scale. "
            "Call this before mutating the scene so you act on real object names."
        ),
        "blenderCommand": "get_scene_info",
        "annotations": {"readOnlyHint": True, "destructiveHint": False},
        "inputSchema": _schema({}),
    },
    {
        "name": "get_object_info",
        "description": (
            "Get detailed information about one named object: transform, assigned "
            "materials, and mesh statistics (vertex, edge and polygon counts)."
        ),
        "blenderCommand": "get_object_info",
        "annotations": {"readOnlyHint": True, "destructiveHint": False},
        "inputSchema": _schema(
            {
                "name": {
                    "type": "string",
                    "description": "Exact name of the object in the Blender scene, e.g. 'Cube'.",
                }
            },
            required=["name"],
        ),
    },
    {
        "name": "get_viewport_screenshot",
        "description": (
            "Capture the current 3D viewport as a PNG image and return it "
            "base64-encoded, so the agent can visually verify the scene."
        ),
        "blenderCommand": "get_viewport_screenshot",
        "annotations": {"readOnlyHint": True, "destructiveHint": False},
        "inputSchema": _schema(
            {
                "max_size": {
                    "type": "integer",
                    "description": "Longest edge of the returned image in pixels.",
                    "minimum": 64,
                    "maximum": 4096,
                    "default": 800,
                }
            }
        ),
    },
    {
        "name": "execute_blender_code",
        "description": (
            "Execute arbitrary Python inside the running Blender process with full "
            "bpy access. DANGEROUS: unsandboxed — the snippet runs with the "
            "privileges of the Blender process and can read or write the "
            "filesystem. Disabled unless EXEC_ENABLED=true and the add-on's "
            "'Enable Code Execution' toggle is on. Prefer a first-class tool."
        ),
        "blenderCommand": "execute_blender_code",
        "annotations": {
            "readOnlyHint": False,
            "destructiveHint": True,
            "openWorldHint": True,
        },
        "inputSchema": _schema(
            {
                "code": {
                    "type": "string",
                    "description": "Python source executed inside Blender with bpy in scope.",
                }
            },
            required=["code"],
        ),
    },
    {
        "name": "create_object",
        "description": (
            "Create a primitive mesh, empty, camera or light in the active scene "
            "at an optional location, rotation and scale. Returns the object name "
            "Blender assigned."
        ),
        "blenderCommand": "create_object",
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
        "inputSchema": _schema(
            {
                "type": {
                    "type": "string",
                    "description": "The primitive to create.",
                    "enum": _OBJECT_TYPES,
                },
                "name": {
                    "type": "string",
                    "description": "Optional name; Blender auto-names the object when omitted.",
                },
                "location": dict(_VECTOR3, description="World-space position [x, y, z]."),
                "rotation": dict(_VECTOR3, description="Euler rotation in radians [x, y, z]."),
                "scale": dict(_VECTOR3, description="Scale factors [x, y, z]."),
            },
            required=["type"],
        ),
    },
    {
        "name": "modify_object",
        "description": (
            "Modify an existing object: move, rotate, scale, rename or toggle its "
            "viewport/render visibility. Only the supplied fields change."
        ),
        "blenderCommand": "modify_object",
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
        "inputSchema": _schema(
            {
                "name": {
                    "type": "string",
                    "description": "Exact name of the object to modify.",
                },
                "location": dict(_VECTOR3, description="New world-space position [x, y, z]."),
                "rotation": dict(_VECTOR3, description="New Euler rotation in radians [x, y, z]."),
                "scale": dict(_VECTOR3, description="New scale factors [x, y, z]."),
                "new_name": {
                    "type": "string",
                    "description": "Rename the object to this value.",
                },
                "visible": {
                    "type": "boolean",
                    "description": "Set viewport and render visibility.",
                },
            },
            required=["name"],
        ),
    },
    {
        "name": "delete_object",
        "description": "Permanently delete a named object from the Blender scene.",
        "blenderCommand": "delete_object",
        "annotations": {"readOnlyHint": False, "destructiveHint": True},
        "inputSchema": _schema(
            {
                "name": {
                    "type": "string",
                    "description": "Exact name of the object to delete.",
                }
            },
            required=["name"],
        ),
    },
    {
        "name": "set_material",
        "description": (
            "Create or reuse a material and assign it to an object, setting the "
            "Principled BSDF base colour, metallic and roughness values."
        ),
        "blenderCommand": "set_material",
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
        "inputSchema": _schema(
            {
                "object_name": {
                    "type": "string",
                    "description": "Exact name of the object to shade.",
                },
                "material_name": {
                    "type": "string",
                    "description": "Name of the material to create or reuse.",
                },
                "color": {
                    "type": "array",
                    "description": "Base colour [R, G, B] or [R, G, B, A], each channel 0.0-1.0.",
                    "items": {"type": "number", "minimum": 0, "maximum": 1},
                    "minItems": 3,
                    "maxItems": 4,
                },
                "metallic": {
                    "type": "number",
                    "description": "Metallic factor of the Principled BSDF, 0.0-1.0.",
                    "minimum": 0,
                    "maximum": 1,
                },
                "roughness": {
                    "type": "number",
                    "description": "Roughness factor of the Principled BSDF, 0.0-1.0.",
                    "minimum": 0,
                    "maximum": 1,
                },
            },
            required=["object_name"],
        ),
    },
    {
        "name": "poly_haven_search",
        "description": (
            "Search the Poly Haven CC0 asset library for HDRIs, textures or models. "
            "Requires POLYHAVEN_ENABLED=true and the add-on's Poly Haven toggle."
        ),
        "blenderCommand": "poly_haven_search",
        "annotations": {"readOnlyHint": True, "openWorldHint": True},
        "inputSchema": _schema(
            {
                "query": {
                    "type": "string",
                    "description": "Free-text search term, e.g. 'brick wall'.",
                },
                "asset_type": {
                    "type": "string",
                    "description": "Restrict results to one Poly Haven category.",
                    "enum": ["hdris", "textures", "models", "all"],
                    "default": "all",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results to return.",
                    "minimum": 1,
                    "maximum": 50,
                    "default": 10,
                },
            },
            required=["query"],
        ),
    },
    {
        "name": "poly_haven_download",
        "description": (
            "Download a Poly Haven asset by slug and import it into the scene "
            "(HDRIs become the world environment; models and textures are linked in)."
        ),
        "blenderCommand": "poly_haven_download",
        "annotations": {"readOnlyHint": False, "openWorldHint": True},
        "inputSchema": _schema(
            {
                "asset_id": {
                    "type": "string",
                    "description": "Poly Haven asset slug, e.g. 'brick_wall_006'.",
                },
                "asset_type": {
                    "type": "string",
                    "description": "The asset's Poly Haven category.",
                    "enum": ["hdris", "textures", "models"],
                },
                "resolution": {
                    "type": "string",
                    "description": "Texture/HDRI resolution to fetch.",
                    "enum": ["1k", "2k", "4k", "8k"],
                    "default": "2k",
                },
            },
            required=["asset_id", "asset_type"],
        ),
    },
    {
        "name": "sketchfab_search",
        "description": (
            "Search Sketchfab for downloadable 3D models. Requires a Sketchfab API "
            "key configured in the Blender add-on preferences."
        ),
        "blenderCommand": "sketchfab_search",
        "annotations": {"readOnlyHint": True, "openWorldHint": True},
        "inputSchema": _schema(
            {
                "query": {
                    "type": "string",
                    "description": "Free-text model search term.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results to return.",
                    "minimum": 1,
                    "maximum": 50,
                    "default": 10,
                },
                "downloadable_only": {
                    "type": "boolean",
                    "description": "Restrict results to models that can be downloaded.",
                    "default": True,
                },
            },
            required=["query"],
        ),
    },
    {
        "name": "sketchfab_download",
        "description": (
            "Download a Sketchfab model by its UID and import it into the Blender "
            "scene. Requires a Sketchfab API key in the add-on preferences."
        ),
        "blenderCommand": "sketchfab_download",
        "annotations": {"readOnlyHint": False, "openWorldHint": True},
        "inputSchema": _schema(
            {
                "uid": {
                    "type": "string",
                    "description": "Sketchfab model UID from a prior search result.",
                }
            },
            required=["uid"],
        ),
    },
    {
        "name": "hyper3d_generate_model",
        "description": (
            "Generate a 3D model from a text prompt using Hyper3D Rodin and import "
            "the result into Blender. Requires a Hyper3D API key in the add-on."
        ),
        "blenderCommand": "hyper3d_generate_model",
        "annotations": {"readOnlyHint": False, "openWorldHint": True},
        "inputSchema": _schema(
            {
                "prompt": {
                    "type": "string",
                    "description": "Text description of the model to generate.",
                },
                "image_url": {
                    "type": "string",
                    "description": "Optional reference image URL to condition generation.",
                },
                "quality": {
                    "type": "string",
                    "description": "Generation quality tier.",
                    "enum": ["draft", "standard", "high"],
                    "default": "standard",
                },
            },
            required=["prompt"],
        ),
    },
    {
        "name": "hunyuan3d_generate_model",
        "description": (
            "Generate a 3D model from text or an image using Hunyuan3D and import "
            "the result into Blender. Requires a Hunyuan3D API key in the add-on."
        ),
        "blenderCommand": "hunyuan3d_generate_model",
        "annotations": {"readOnlyHint": False, "openWorldHint": True},
        "inputSchema": _schema(
            {
                "prompt": {
                    "type": "string",
                    "description": "Text description of the model to generate.",
                },
                "image_url": {
                    "type": "string",
                    "description": "Optional reference image URL to condition generation.",
                },
                "texture": {
                    "type": "boolean",
                    "description": "Whether to generate textures alongside the mesh.",
                    "default": True,
                },
            },
            required=["prompt"],
        ),
    },
]

TOOL_INDEX: dict[str, dict[str, Any]] = {tool["name"]: tool for tool in TOOLS}
TOOL_NAMES: tuple[str, ...] = tuple(tool["name"] for tool in TOOLS)

#: Tools that mutate the scene or reach the network, surfaced for policy checks.
DESTRUCTIVE_TOOLS = frozenset(
    name
    for name, tool in TOOL_INDEX.items()
    if tool.get("annotations", {}).get("destructiveHint")
)


# --------------------------------------------------------------------------
# validation
# --------------------------------------------------------------------------

_JSON_TYPES: dict[str, tuple[type, ...]] = {
    "string": (str,),
    "integer": (int,),
    "number": (int, float),
    "boolean": (bool,),
    "array": (list, tuple),
    "object": (dict,),
}


def _type_ok(value: Any, expected: str) -> bool:
    """Check a value against a JSON Schema primitive type name."""
    if expected not in _JSON_TYPES:
        return True
    # bool is a subclass of int in Python; JSON Schema treats them separately.
    if expected in ("integer", "number") and isinstance(value, bool):
        return False
    return isinstance(value, _JSON_TYPES[expected])


def validate_arguments(name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
    """Validate ``arguments`` against the tool's inputSchema.

    A deliberately small, dependency-free subset of JSON Schema: required keys,
    unknown keys, primitive types, enums, numeric bounds and array lengths.
    That covers every constraint the 14 schemas actually use.
    """
    tool = TOOL_INDEX.get(name)
    if tool is None:
        raise UnknownToolError(
            f"Unknown tool '{name}'. Known tools: {', '.join(TOOL_NAMES)}."
        )

    args = dict(arguments or {})
    schema = tool["inputSchema"]
    properties: dict[str, Any] = schema.get("properties", {})
    required: list[str] = schema.get("required", [])

    missing = [key for key in required if key not in args or args[key] is None]
    if missing:
        raise ToolValidationError(
            f"{name}: missing required argument(s): {', '.join(sorted(missing))}."
        )

    if schema.get("additionalProperties") is False:
        unknown = [key for key in args if key not in properties]
        if unknown:
            raise ToolValidationError(
                f"{name}: unexpected argument(s): {', '.join(sorted(unknown))}. "
                f"Allowed: {', '.join(sorted(properties))}."
            )

    for key, value in args.items():
        spec = properties.get(key)
        if not spec or value is None:
            continue

        expected = spec.get("type")
        if isinstance(expected, str) and not _type_ok(value, expected):
            raise ToolValidationError(
                f"{name}.{key}: expected {expected}, got {type(value).__name__}."
            )

        if "enum" in spec and value not in spec["enum"]:
            raise ToolValidationError(
                f"{name}.{key}: {value!r} is not one of {spec['enum']}."
            )

        if expected in ("number", "integer"):
            if "minimum" in spec and value < spec["minimum"]:
                raise ToolValidationError(
                    f"{name}.{key}: {value} is below the minimum {spec['minimum']}."
                )
            if "maximum" in spec and value > spec["maximum"]:
                raise ToolValidationError(
                    f"{name}.{key}: {value} is above the maximum {spec['maximum']}."
                )

        if expected == "array":
            if "minItems" in spec and len(value) < spec["minItems"]:
                raise ToolValidationError(
                    f"{name}.{key}: expected at least {spec['minItems']} items, got {len(value)}."
                )
            if "maxItems" in spec and len(value) > spec["maxItems"]:
                raise ToolValidationError(
                    f"{name}.{key}: expected at most {spec['maxItems']} items, got {len(value)}."
                )
            item_type = spec.get("items", {}).get("type")
            if isinstance(item_type, str):
                for index, item in enumerate(value):
                    if not _type_ok(item, item_type):
                        raise ToolValidationError(
                            f"{name}.{key}[{index}]: expected {item_type}, "
                            f"got {type(item).__name__}."
                        )
    return args


# --------------------------------------------------------------------------
# dispatch
# --------------------------------------------------------------------------


def dispatch(
    name: str,
    arguments: dict[str, Any] | None,
    client: Any,
    config: Any | None = None,
) -> dict[str, Any]:
    """Validate a tool call and forward it to Blender.

    Args:
        name: One of :data:`TOOL_NAMES`.
        arguments: The caller-supplied arguments.
        client: Anything exposing ``send_command(command_type, params)``.
        config: Optional :class:`~ondemand_blender_mcp.config.Config` used to
            enforce the code-execution kill switch.

    Returns:
        The ``result`` dict Blender returned.
    """
    args = validate_arguments(name, arguments)
    tool = TOOL_INDEX[name]

    # Server-side kill switch. The add-on enforces this too — defence in depth,
    # because the MCP server may be exposed over HTTP while Blender is not.
    if name == "execute_blender_code" and config is not None:
        if not getattr(config, "exec_enabled", False):
            raise ToolDisabledError(
                "execute_blender_code is disabled. Set EXEC_ENABLED=true and enable "
                "'Enable Code Execution' in the BlenderMCP sidebar panel to allow it. "
                "It runs unsandboxed Python inside Blender."
            )

    command = tool.get("blenderCommand", name)
    return client.send_command(command, args)


def tool_descriptors() -> list[dict[str, Any]]:
    """Return MCP-wire tool descriptors (name/description/inputSchema/annotations)."""
    return [
        {
            "name": tool["name"],
            "description": tool["description"],
            "inputSchema": tool["inputSchema"],
            "annotations": tool.get("annotations", {}),
        }
        for tool in TOOLS
    ]
