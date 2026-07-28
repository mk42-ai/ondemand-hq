"""ondemand-blender-mcp — an MCP server that drives a live Blender instance.

Chain of custody for every call::

    OnDemand Agent
      -> OnDemand tool/plugin layer (REST)
        -> this MCP server (stdio | streamable-HTTP)
          -> TCP socket :9876
            -> addon.py running inside Blender

The package is intentionally dependency-free (standard library only) so that
``uvx ondemand-blender-mcp`` starts quickly and reproducibly.
"""

from __future__ import annotations

__version__ = "1.5.6"
__all__ = ["__version__"]
