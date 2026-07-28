"""Console entry point: ``ondemand-blender-mcp``.

    ondemand-blender-mcp                         # stdio (default, for MCP clients)
    ondemand-blender-mcp --transport http        # streamable-HTTP on :8080
    ondemand-blender-mcp --print-manifest        # dump tools.json to stdout
    ondemand-blender-mcp --check                 # probe the Blender socket
"""

from __future__ import annotations

import argparse
import json
import sys

from . import __version__
from .blender_client import BlenderClient, BlenderConnectionError
from .config import Config
from .tools import TOOL_NAMES


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ondemand-blender-mcp",
        description=(
            "MCP server bridging the OnDemand AI platform to a live Blender "
            "instance over a TCP socket."
        ),
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument(
        "--transport",
        choices=("stdio", "http"),
        default="stdio",
        help="Transport to serve (default: stdio).",
    )
    parser.add_argument("--host", default=None, help="HTTP bind host (default 0.0.0.0).")
    parser.add_argument("--port", type=int, default=None, help="HTTP bind port (default 8080).")
    parser.add_argument("--blender-host", default=None, help="Blender add-on host (default localhost).")
    parser.add_argument("--blender-port", type=int, default=None, help="Blender add-on port (default 9876).")
    parser.add_argument(
        "--allow-code-execution",
        action="store_true",
        help="Permit execute_blender_code. UNSANDBOXED — off unless you pass this.",
    )
    parser.add_argument(
        "--print-manifest",
        action="store_true",
        help="Print the OnDemand tool manifest (tools.json) and exit.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Probe the Blender socket and exit 0 on success, 1 on failure.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = Config.from_env()

    if args.blender_host:
        config.blender_host = args.blender_host
    if args.blender_port:
        config.blender_port = args.blender_port
    if args.allow_code_execution:
        config.exec_enabled = True

    if args.print_manifest:
        from .manifest import build_manifest

        json.dump(build_manifest(), sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    if args.check:
        client = BlenderClient(
            host=config.blender_host, port=config.blender_port,
            timeout=config.blender_timeout, retries=0,
        )
        try:
            info = client.send_command("get_scene_info", {})
        except BlenderConnectionError as exc:
            print(f"UNREACHABLE {config.blender_host}:{config.blender_port} — {exc}", file=sys.stderr)
            return 1
        print(
            f"OK {config.blender_host}:{config.blender_port} — scene "
            f"{info.get('scene_name', '?')} with {info.get('object_count', '?')} object(s); "
            f"{len(TOOL_NAMES)} tools exposed"
        )
        return 0

    if args.transport == "http":
        from .server_http import run_http_server

        run_http_server(host=args.host, port=args.port, config=config)
        return 0

    from .server_stdio import serve_stdio

    serve_stdio(config=config)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
