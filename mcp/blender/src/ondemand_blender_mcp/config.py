"""Environment-driven configuration.

Every knob is read from the process environment so the same artifact runs
unchanged as a stdio subprocess, a Docker container, or a hosted HTTP service.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

TRUTHY = {"1", "true", "yes", "on", "y", "t"}


def env_bool(name: str, default: bool = False) -> bool:
    """Parse a boolean environment variable without raising."""
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in TRUTHY


def env_int(name: str, default: int) -> int:
    """Parse an integer environment variable, falling back on garbage input."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw.strip())
    except ValueError:
        return default


def env_set(name: str) -> set[str]:
    """Parse a comma-separated environment variable into a set of strings."""
    raw = os.environ.get(name, "")
    return {piece.strip() for piece in raw.split(",") if piece.strip()}


@dataclass
class Config:
    """Resolved runtime configuration."""

    blender_host: str = "localhost"
    blender_port: int = 9876
    blender_timeout: float = 30.0
    blender_retries: int = 2

    http_host: str = "0.0.0.0"
    http_port: int = 8080
    allowed_origins: set[str] = field(default_factory=set)

    # Security defaults are deliberately restrictive. `execute_blender_code`
    # runs unsandboxed Python inside Blender, so it is opt-in, and telemetry is
    # off unless the operator explicitly turns it on (upstream blender-mcp
    # ships telemetry ON by default; this build inverts that).
    exec_enabled: bool = False
    telemetry_enabled: bool = False
    polyhaven_enabled: bool = False

    ondemand_api_key: str | None = None

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            blender_host=os.environ.get("BLENDER_HOST", "localhost"),
            blender_port=env_int("BLENDER_PORT", 9876),
            blender_timeout=env_float("BLENDER_TIMEOUT", 30.0),
            blender_retries=env_int("BLENDER_RETRIES", 2),
            http_host=os.environ.get("MCP_HTTP_HOST", "0.0.0.0"),
            http_port=env_int("MCP_HTTP_PORT", 8080),
            allowed_origins=env_set("MCP_ALLOWED_ORIGINS"),
            exec_enabled=env_bool("EXEC_ENABLED", False),
            telemetry_enabled=env_bool("TELEMETRY_ENABLED", False),
            polyhaven_enabled=env_bool("POLYHAVEN_ENABLED", False),
            ondemand_api_key=os.environ.get("ONDEMAND_API_KEY") or None,
        )
