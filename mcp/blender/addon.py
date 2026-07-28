"""BlenderMCP — OnDemand Bridge.

This add-on is the in-Blender half of an MCP (Model Context Protocol)
integration, modelled on ahujasid/blender-mcp. It runs a small threaded TCP
JSON server inside Blender so an external MCP client/process can inspect and
mutate the current scene (create/modify/delete objects, assign materials,
grab a viewport screenshot, pull assets from Poly Haven / Sketchfab / Hyper3D
/ Hunyuan3D, and optionally execute arbitrary Python).

This build was written with a security-first mindset and deliberately
diverges from upstream defaults in a few places - see the "SECURITY
DEFAULTS" section below for the full rationale. In short:

  * Telemetry is hard-disabled (upstream ships it ON).
  * Arbitrary code execution is OFF by default and must be explicitly
    enabled per session from the sidebar panel.
  * All filesystem writes go through a path allow-list helper.
  * The server binds to localhost only by default.

Install via Edit > Preferences > Add-ons > Install..., pick this file, then
enable "BlenderMCP — OnDemand Bridge". The control panel lives in the 3D
Viewport's sidebar (press N) under the "BlenderMCP" tab.
"""

bl_info = {
    "name": "BlenderMCP — OnDemand Bridge",
    "author": "OnDemand",
    "version": (1, 5, 6),
    "blender": (3, 0, 0),
    "location": "View3D > Sidebar > BlenderMCP",
    "description": (
        "Threaded TCP bridge that exposes Blender scene control "
        "(objects, materials, screenshots, asset providers, optional code "
        "execution) to an external MCP client, with hardened security "
        "defaults relative to upstream blender-mcp."
    ),
    "category": "Interface",
}

import base64
import contextlib
import io
import json
import os
import queue
import socket
import tempfile
import threading
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

import bpy
from bpy.props import BoolProperty, IntProperty, PointerProperty, StringProperty
from bpy.types import AddonPreferences, Operator, Panel, PropertyGroup

# ---------------------------------------------------------------------------
# SECURITY DEFAULTS - this build deliberately hardens upstream defaults:
#   * TELEMETRY_ENABLED is hard False. No code path here ever makes a
#     network call for telemetry, regardless of the Scene checkbox (which
#     exists only for UI parity with upstream). See `_telemetry_noop()`.
#   * execute_blender_code defaults OFF: it is UNSANDBOXED arbitrary Python
#     with full bpy + os + subprocess reach, i.e. a straight line to RCE
#     for anyone who can reach the socket (or inject text into an
#     LLM-driven MCP client). See `_cmd_execute_blender_code`.
#   * Every filesystem write (screenshots, downloaded assets) goes through
#     `_safe_path()`, which resolves symlinks/".." via os.path.realpath and
#     refuses paths outside an allow-list. Upstream does weak-to-no
#     validation of output paths, which is a path-traversal vector.
#   * The server binds to "localhost" ONLY by default. "0.0.0.0" would
#     expose this *unauthenticated* control channel to the LAN and, on
#     multi-homed/NAT'd/containerised hosts, to DNS-rebinding attacks
#     (an attacker page can get a browser to re-resolve its own hostname
#     to 127.0.0.1 post-same-origin-check and then script this socket).
#     Do not bind to 0.0.0.0 without separate mitigations (firewall, auth
#     token) - none of which this add-on implements.
# ---------------------------------------------------------------------------
TELEMETRY_ENABLED = False  # hard-coded off; see comment block above


def _telemetry_noop(event_name: str, payload: Optional[dict] = None) -> None:
    """Intentionally does nothing - telemetry is hard-disabled in this build.

    Upstream blender-mcp reports anonymous usage telemetry by default. Call
    sites read naturally (e.g. `_telemetry_noop("server_start")`), but this
    never opens a socket or calls urllib, and never branches on
    TELEMETRY_ENABLED or the Scene's `telemetry_enabled` checkbox to decide
    otherwise. Telemetry is off, full stop, no matter what any UI toggle says.
    """
    return None


def _safe_path(path: str, extra_allowed_dirs: Optional[List[str]] = None) -> str:
    """Resolve `path` and ensure it lives inside an allow-listed directory.

    Returns the canonical absolute path if it is safe to read/write, else
    raises ValueError. Allow-listed roots, by default: the OS temp dir
    (tempfile.gettempdir()), the current .blend file's directory (if any),
    and any dirs passed via `extra_allowed_dirs`.

    Exists because upstream blender-mcp writes screenshots/downloaded assets
    to caller-influenced paths with little to no validation - a
    path-traversal vector (e.g. "../../../../home/user/.ssh/authorized_keys",
    or a symlink swapped in between check and use). Every filesystem write in
    this file goes through here first; `os.path.realpath` is used
    specifically so symlink tricks and ".." segments cannot bypass the check.
    """
    allowed_roots = [os.path.realpath(tempfile.gettempdir())]

    blend_filepath = bpy.data.filepath
    if blend_filepath:
        allowed_roots.append(os.path.realpath(os.path.dirname(blend_filepath)))

    if extra_allowed_dirs:
        allowed_roots.extend(os.path.realpath(d) for d in extra_allowed_dirs)

    real = os.path.realpath(os.path.abspath(path))

    for root in allowed_roots:
        try:
            common = os.path.commonpath([real, root])
        except ValueError:
            # Raised on Windows when `real` and `root` are on different
            # drives - simply means this root cannot match.
            continue
        if common == root:
            return real

    raise ValueError(
        f"Refusing to access path outside allow-listed directories: {path!r} "
        f"resolved to {real!r}, which is not under any of {allowed_roots!r}"
    )


# ---------------------------------------------------------------------------
# TCP server
# ---------------------------------------------------------------------------
class BlenderMCPServer:
    """Threaded TCP JSON server that bridges an external MCP client to bpy.

    THREADING MODEL (read this before touching dispatch code):
    `start()` spawns ONE daemon "accept loop" thread owning a blocking
    listening socket; each accepted connection gets its own daemon "client"
    thread (`_handle_client`) so connections do not block each other.

    `bpy` is NOT thread-safe: mutating scene data off Blender's main thread
    can corrupt memory or crash Blender. So socket threads never call bpy
    directly. Instead, per dispatched command: (1) a zero-arg closure wraps
    the real `_cmd_<name>` handler call and stashes its result/exception into
    a size-1 `queue.Queue`; (2) that closure is registered via
    `bpy.app.timers.register(closure, first_interval=0.0)` - Blender runs
    registered timers on the MAIN THREAD between UI/frame updates, which is
    the officially supported way to hand control back to bpy-land from a
    background thread; (3) the socket thread blocks on
    `queue.get(timeout=...)` for the result, then serialises it to the
    client. The queue is the ONLY thing crossing the thread boundary - no
    bpy object is ever touched from the socket thread or passed through it,
    only plain dict/list/str/number results built on the main thread.
    """

    def __init__(self, host: str = "localhost", port: int = 9876):
        self.host = host
        self.port = port
        self.running = False
        self.socket: Optional[socket.socket] = None
        self.server_thread: Optional[threading.Thread] = None
        self._client_threads: List[threading.Thread] = []
        self._lock = threading.Lock()

        # Wire protocol dispatch table: incoming "type" string -> bound
        # handler. Every handler takes a `params` dict and returns a
        # JSON-serialisable dict, or raises on failure.
        self._handlers: Dict[str, Callable[[dict], dict]] = {
            "get_scene_info": self._cmd_get_scene_info,
            "get_object_info": self._cmd_get_object_info,
            "get_viewport_screenshot": self._cmd_get_viewport_screenshot,
            "execute_blender_code": self._cmd_execute_blender_code,
            "create_object": self._cmd_create_object,
            "modify_object": self._cmd_modify_object,
            "delete_object": self._cmd_delete_object,
            "set_material": self._cmd_set_material,
            "poly_haven_search": self._cmd_poly_haven_search,
            "poly_haven_download": self._cmd_poly_haven_download,
            "sketchfab_search": self._cmd_sketchfab_search,
            "sketchfab_download": self._cmd_sketchfab_download,
            "hyper3d_generate_model": self._cmd_hyper3d_generate_model,
            "hunyuan3d_generate_model": self._cmd_hunyuan3d_generate_model,
        }

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    def start(self) -> None:
        """Create the listening socket and spawn the accept-loop thread."""
        if self.running:
            print("[BlenderMCP] server already running")
            return

        self.running = True
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            # SECURITY: binds to `self.host` only. The default "localhost"
            # means the port is unreachable from other machines. Do not
            # change this to "0.0.0.0" without reading the DNS-rebinding
            # warning in the SECURITY DEFAULTS block at the top of this
            # file - this channel has no authentication whatsoever.
            self.socket.bind((self.host, self.port))
            self.socket.listen(5)
        except OSError:
            self.running = False
            self.socket.close()
            self.socket = None
            raise

        # Timeout lets the accept loop periodically re-check `self.running`
        # so `stop()` can ask it to exit instead of blocking forever.
        self.socket.settimeout(0.5)

        self.server_thread = threading.Thread(
            target=self._serve_forever, name="BlenderMCPServerThread", daemon=True
        )
        self.server_thread.start()
        _telemetry_noop("server_start")
        print(f"[BlenderMCP] listening on {self.host}:{self.port}")

    def stop(self) -> None:
        """Signal shutdown, close the socket, and join every worker thread."""
        self.running = False

        if self.socket is not None:
            try:
                self.socket.close()
            except OSError:
                pass
            self.socket = None

        if self.server_thread is not None and self.server_thread.is_alive():
            self.server_thread.join(timeout=2.0)
        self.server_thread = None

        with self._lock:
            client_threads = list(self._client_threads)
            self._client_threads.clear()
        for client_thread in client_threads:
            if client_thread.is_alive():
                client_thread.join(timeout=1.0)

        _telemetry_noop("server_stop")
        print("[BlenderMCP] server stopped")

    # ------------------------------------------------------------------
    # accept loop / client handling
    # ------------------------------------------------------------------
    def _serve_forever(self) -> None:
        assert self.socket is not None
        while self.running:
            try:
                client_sock, addr = self.socket.accept()
            except socket.timeout:
                continue
            except OSError:
                break  # socket was closed by stop()

            client_thread = threading.Thread(
                target=self._handle_client,
                args=(client_sock, addr),
                name=f"BlenderMCPClient-{addr[0]}:{addr[1]}",
                daemon=True,
            )
            with self._lock:
                self._client_threads.append(client_thread)
            client_thread.start()

    def _handle_client(self, client_sock: socket.socket, addr: Tuple[str, int]) -> None:
        print(f"[BlenderMCP] client connected from {addr}")
        client_sock.settimeout(1.0)
        buffer = b""
        try:
            while self.running:
                try:
                    chunk = client_sock.recv(65536)
                except socket.timeout:
                    continue
                except OSError:
                    break

                if not chunk:
                    break  # client closed the connection

                buffer += chunk

                # Accumulate raw bytes until they form one complete JSON
                # document. This tolerates partial TCP reads (a JSON object
                # split across multiple recv() calls) without requiring a
                # length prefix or newline delimiter on the wire.
                message, buffer = self._try_parse_message(buffer)
                if message is None:
                    continue

                response = self._dispatch(message)
                try:
                    client_sock.sendall(json.dumps(response).encode("utf-8"))
                except OSError:
                    break
        finally:
            try:
                client_sock.close()
            except OSError:
                pass
            print(f"[BlenderMCP] client disconnected from {addr}")

    @staticmethod
    def _try_parse_message(buffer: bytes) -> Tuple[Optional[dict], bytes]:
        """Try to decode one JSON object from the front of `buffer`.

        Returns `(message, remaining_bytes)`. If `buffer` does not yet
        contain a complete JSON document, returns `(None, buffer)`
        unchanged so the caller keeps accumulating chunks.
        """
        text = buffer.decode("utf-8", errors="ignore").strip()
        if not text:
            return None, b""
        try:
            decoder = json.JSONDecoder()
            obj, end_index = decoder.raw_decode(text)
        except json.JSONDecodeError:
            return None, buffer

        remainder = text[end_index:].strip().encode("utf-8")
        return obj, remainder

    # ------------------------------------------------------------------
    # dispatch + main-thread marshalling
    # ------------------------------------------------------------------
    def _dispatch(self, message: dict) -> dict:
        cmd_type = message.get("type")
        params = message.get("params") or {}

        handler = self._handlers.get(cmd_type)
        if handler is None:
            return {
                "status": "error",
                "message": f"Unknown command type: {cmd_type!r}",
            }

        try:
            result = self._run_on_main_thread(handler, params)
            return {"status": "success", "result": result}
        except Exception as exc:  # noqa: BLE001 - report *any* failure to the client
            traceback.print_exc()
            return {"status": "error", "message": str(exc)}

    def _run_on_main_thread(self, handler: Callable[[dict], dict], params: dict) -> Any:
        """Marshal `handler(params)` onto Blender's main thread and block
        this (socket) thread until the result is ready.

        `bpy.app.timers.register()` is the officially supported way to run
        code on Blender's main thread from a background thread: Blender
        polls registered timers on the main thread only, between UI/frame
        updates. We wrap the handler call so any exception raised inside it
        is captured and placed on the queue too, rather than being printed
        to the console and silently swallowed by the timer system.
        """
        result_queue: queue.Queue = queue.Queue(maxsize=1)

        def _run_on_timer() -> None:
            try:
                value = handler(params)
                result_queue.put((True, value))
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                result_queue.put((False, str(exc)))
            return None  # returning None un-registers a one-shot timer

        bpy.app.timers.register(_run_on_timer, first_interval=0.0)

        try:
            ok, payload = result_queue.get(timeout=60.0)
        except queue.Empty as exc:
            raise TimeoutError(
                "Timed out waiting for Blender's main thread to process the command"
            ) from exc

        if not ok:
            raise RuntimeError(payload)
        return payload

    # ------------------------------------------------------------------
    # shared helpers for command handlers
    # ------------------------------------------------------------------
    @staticmethod
    def _get_props() -> "BlenderMCPProperties":
        scene = bpy.context.scene
        props = getattr(scene, "blendermcp_props", None)
        if props is None:
            raise RuntimeError("BlenderMCP scene properties are not registered")
        return props

    @staticmethod
    def _get_preferences() -> "BlenderMCPPreferences":
        addon = bpy.context.preferences.addons.get(__name__)
        if addon is None:
            raise RuntimeError("BlenderMCP add-on preferences are not available")
        return addon.preferences

    @staticmethod
    def _require_feature_enabled(enabled: bool, tool_name: str) -> None:
        if not enabled:
            raise PermissionError(
                f"{tool_name} is disabled; enable it in the BlenderMCP panel"
            )

    @staticmethod
    def _find_view3d_area():
        wm = bpy.context.window_manager
        for window in wm.windows:
            for area in window.screen.areas:
                if area.type == "VIEW_3D":
                    return area, window
        return None, None

    @staticmethod
    def _http_get_json(url_or_request: Any, timeout: float = 15.0) -> Any:
        """Shared GET/POST-and-decode-JSON helper for every asset provider."""
        try:
            with urllib.request.urlopen(url_or_request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, ValueError) as exc:
            raise RuntimeError(f"HTTP request failed: {exc}") from exc

    @staticmethod
    def _require_api_key(prefs: "BlenderMCPPreferences", attr: str, tool_name: str) -> str:
        api_key = (getattr(prefs, attr) or "").strip()
        if not api_key:
            raise PermissionError(
                f"{tool_name} requires an API key. Add it in Edit > Preferences "
                "> Add-ons > BlenderMCP."
            )
        return api_key

    @staticmethod
    def _download_asset(url: str, filename: str) -> str:
        target_path = _safe_path(
            os.path.join(tempfile.gettempdir(), "blendermcp_assets", filename)
        )
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        try:
            urllib.request.urlretrieve(url, target_path)
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Failed to download asset from {url}: {exc}") from exc
        return target_path

    # ------------------------------------------------------------------
    # command handlers - these run ON THE MAIN THREAD ONLY (see above)
    # ------------------------------------------------------------------
    def _cmd_get_scene_info(self, params: dict) -> dict:
        scene = bpy.context.scene
        objects = []
        for obj in scene.objects:
            objects.append(
                {
                    "name": obj.name,
                    "type": obj.type,
                    "location": list(obj.location),
                    "rotation": list(obj.rotation_euler),
                    "scale": list(obj.scale),
                }
            )
        return {
            "name": scene.name,
            "object_count": len(scene.objects),
            "objects": objects,
        }

    def _cmd_get_object_info(self, params: dict) -> dict:
        name = params.get("name")
        if not name:
            raise ValueError("get_object_info requires a 'name' parameter")

        obj = bpy.data.objects.get(name)
        if obj is None:
            raise ValueError(f"No object named {name!r} in the current .blend")

        materials = [slot.material.name for slot in obj.material_slots if slot.material]

        mesh_info = None
        if obj.type == "MESH" and obj.data is not None:
            mesh_info = {
                "vertex_count": len(obj.data.vertices),
                "polygon_count": len(obj.data.polygons),
                "edge_count": len(obj.data.edges),
            }

        return {
            "name": obj.name,
            "type": obj.type,
            "location": list(obj.location),
            "rotation": list(obj.rotation_euler),
            "scale": list(obj.scale),
            "visible": obj.visible_get(),
            "materials": materials,
            "mesh": mesh_info,
        }

    def _cmd_get_viewport_screenshot(self, params: dict) -> dict:
        max_size = int(params.get("max_size", 800))
        if max_size <= 0:
            raise ValueError("max_size must be a positive integer")

        filename = f"blendermcp_screenshot_{uuid.uuid4().hex}.png"
        target_path = _safe_path(os.path.join(tempfile.gettempdir(), filename))

        scene = bpy.context.scene
        render = scene.render

        saved_state = {
            "filepath": render.filepath,
            "file_format": render.image_settings.file_format,
            "resolution_x": render.resolution_x,
            "resolution_y": render.resolution_y,
            "resolution_percentage": render.resolution_percentage,
        }

        try:
            render.image_settings.file_format = "PNG"
            render.filepath = target_path
            render.resolution_percentage = 100

            width, height = render.resolution_x, render.resolution_y
            if width >= height:
                height = max(1, int(height * (max_size / float(width))))
                width = max_size
            else:
                width = max(1, int(width * (max_size / float(height))))
                height = max_size
            render.resolution_x = width
            render.resolution_y = height

            # We prefer bpy.ops.render.opengl() to snapshot the 3D viewport
            # because it can be pointed at a specific area via a context
            # override. bpy.ops.screen.screenshot_area() is the other
            # upstream option, but it needs an interactive screen area
            # context that is not reliably available from inside a
            # bpy.app.timers callback (no guaranteed active area/region),
            # so we fall back further to a full bpy.ops.render.render() if
            # no VIEW_3D area can be found at all (e.g. headless / --background).
            view_3d_area, window = self._find_view3d_area()
            try:
                if view_3d_area is not None and hasattr(bpy.context, "temp_override"):
                    with bpy.context.temp_override(area=view_3d_area, window=window):
                        bpy.ops.render.opengl(write_still=True)
                elif view_3d_area is not None:
                    override = bpy.context.copy()
                    override["area"] = view_3d_area
                    override["window"] = window
                    bpy.ops.render.opengl(override, write_still=True)
                else:
                    bpy.ops.render.render(write_still=True)
            except RuntimeError:
                # OpenGL viewport capture is unavailable in this context;
                # fall back to a full scene render so the command can still
                # succeed rather than leaving the client with nothing.
                bpy.ops.render.render(write_still=True)

            if not os.path.exists(target_path):
                raise RuntimeError("Screenshot did not produce an output file on disk")

            with open(target_path, "rb") as fh:
                image_bytes = fh.read()

            return {
                "path": target_path,
                "width": width,
                "height": height,
                "image_base64": base64.b64encode(image_bytes).decode("ascii"),
            }
        finally:
            render.filepath = saved_state["filepath"]
            render.image_settings.file_format = saved_state["file_format"]
            render.resolution_x = saved_state["resolution_x"]
            render.resolution_y = saved_state["resolution_y"]
            render.resolution_percentage = saved_state["resolution_percentage"]

    def _cmd_execute_blender_code(self, params: dict) -> dict:
        # SECURITY: this runs ARBITRARY, UNSANDBOXED Python inside Blender's
        # own process via exec(), with full bpy (entire scene graph and
        # Blender internals) PLUS the whole stdlib reachable - os.system,
        # subprocess.run, socket, arbitrary file I/O, all of it. There is no
        # seccomp/AppArmor-style sandbox here or in upstream blender-mcp.
        # Whoever gets a string into this parameter can run anything the
        # Blender process's OS user can run: read SSH keys, exfiltrate
        # files, install persistence, pivot to other hosts. If the calling
        # MCP client is LLM-driven, a prompt-injection payload hidden in an
        # innocuous document/web page becomes full RCE the moment this is
        # enabled - which is why it defaults OFF (BoolProperty
        # default=False) and must be explicitly opted into per session from
        # the sidebar panel.
        props = self._get_props()
        if not props.enable_code_execution:
            raise PermissionError(
                "Code execution is disabled. Enable it in the BlenderMCP sidebar panel."
            )

        code = params.get("code")
        if not code or not isinstance(code, str):
            raise ValueError("execute_blender_code requires a 'code' string parameter")

        exec_globals: Dict[str, Any] = {"bpy": bpy}
        exec_locals: Dict[str, Any] = {}
        stdout_capture = io.StringIO()

        try:
            with contextlib.redirect_stdout(stdout_capture):
                exec(  # noqa: S102 - intentional, gated by enable_code_execution
                    compile(code, "<blendermcp_execute_blender_code>", "exec"),
                    exec_globals,
                    exec_locals,
                )
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"Error executing code: {exc}") from exc

        return {"executed": True, "stdout": stdout_capture.getvalue()}

    def _cmd_create_object(self, params: dict) -> dict:
        obj_type = str(params.get("type", "CUBE")).upper()
        name = params.get("name")
        location = tuple(float(v) for v in params.get("location", (0.0, 0.0, 0.0)))
        rotation = tuple(float(v) for v in params.get("rotation", (0.0, 0.0, 0.0)))
        scale = tuple(float(v) for v in params.get("scale", (1.0, 1.0, 1.0)))

        if obj_type == "CUBE":
            bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
        elif obj_type == "SPHERE":
            bpy.ops.mesh.primitive_uv_sphere_add(location=location, rotation=rotation)
        elif obj_type == "CYLINDER":
            bpy.ops.mesh.primitive_cylinder_add(location=location, rotation=rotation)
        elif obj_type == "PLANE":
            bpy.ops.mesh.primitive_plane_add(location=location, rotation=rotation)
        elif obj_type == "CONE":
            bpy.ops.mesh.primitive_cone_add(location=location, rotation=rotation)
        elif obj_type == "TORUS":
            bpy.ops.mesh.primitive_torus_add(location=location, rotation=rotation)
        elif obj_type == "EMPTY":
            bpy.ops.object.empty_add(location=location, rotation=rotation)
        elif obj_type == "CAMERA":
            bpy.ops.object.camera_add(location=location, rotation=rotation)
        elif obj_type == "LIGHT":
            light_type = str(params.get("light_type", "POINT")).upper()
            bpy.ops.object.light_add(type=light_type, location=location, rotation=rotation)
        else:
            raise ValueError(
                f"Unsupported object type {obj_type!r}. Expected one of: CUBE, "
                "SPHERE, CYLINDER, PLANE, CONE, TORUS, EMPTY, CAMERA, LIGHT"
            )

        obj = bpy.context.view_layer.objects.active
        if obj is None:
            raise RuntimeError("Blender did not report a new active object after creation")

        obj.scale = scale
        if name:
            obj.name = str(name)

        return {
            "name": obj.name,
            "type": obj.type,
            "location": list(obj.location),
            "rotation": list(obj.rotation_euler),
            "scale": list(obj.scale),
        }

    def _cmd_modify_object(self, params: dict) -> dict:
        name = params.get("name")
        if not name:
            raise ValueError("modify_object requires a 'name' parameter")

        obj = bpy.data.objects.get(name)
        if obj is None:
            raise ValueError(f"No object named {name!r} in the current .blend")

        if "location" in params:
            obj.location = tuple(float(v) for v in params["location"])
        if "rotation" in params:
            obj.rotation_euler = tuple(float(v) for v in params["rotation"])
        if "scale" in params:
            obj.scale = tuple(float(v) for v in params["scale"])
        if "visible" in params:
            visible = bool(params["visible"])
            obj.hide_set(not visible)
            obj.hide_render = not visible
        if params.get("name") and params["name"] != name:
            obj.name = str(params["name"])

        return {
            "name": obj.name,
            "type": obj.type,
            "location": list(obj.location),
            "rotation": list(obj.rotation_euler),
            "scale": list(obj.scale),
            "visible": obj.visible_get(),
        }

    def _cmd_delete_object(self, params: dict) -> dict:
        name = params.get("name")
        if not name:
            raise ValueError("delete_object requires a 'name' parameter")

        obj = bpy.data.objects.get(name)
        if obj is None:
            raise ValueError(f"No object named {name!r} in the current .blend")

        bpy.data.objects.remove(obj, do_unlink=True)
        return {"deleted": name}

    def _cmd_set_material(self, params: dict) -> dict:
        object_name = params.get("object_name") or params.get("name")
        if not object_name:
            raise ValueError("set_material requires an 'object_name' parameter")

        obj = bpy.data.objects.get(object_name)
        if obj is None:
            raise ValueError(f"No object named {object_name!r} in the current .blend")

        if obj.data is None or not hasattr(obj.data, "materials"):
            raise ValueError(f"Object {object_name!r} cannot hold materials (type={obj.type})")

        material_name = params.get("material_name") or f"{object_name}_material"
        material = bpy.data.materials.get(material_name)
        created = False
        if material is None:
            material = bpy.data.materials.new(name=material_name)
            created = True

        material.use_nodes = True
        bsdf = next(
            (n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None
        )
        if bsdf is None:
            bsdf = material.node_tree.nodes.new("ShaderNodeBsdfPrincipled")

        color = params.get("color")
        if color is not None:
            rgba = list(color)
            if len(rgba) == 3:
                rgba.append(1.0)
            bsdf.inputs["Base Color"].default_value = tuple(float(c) for c in rgba)

        if "metallic" in params:
            bsdf.inputs["Metallic"].default_value = float(params["metallic"])
        if "roughness" in params:
            bsdf.inputs["Roughness"].default_value = float(params["roughness"])

        if obj.data.materials:
            obj.data.materials[0] = material
        else:
            obj.data.materials.append(material)

        return {
            "object": obj.name,
            "material": material.name,
            "created_new_material": created,
        }

    # ------------------------------------------------------------------
    # asset provider commands
    #
    # Each of these checks a Scene-level enable toggle first and returns a
    # structured, honest error (never a fabricated success) when the
    # feature is disabled or a required API key is missing. Sketchfab,
    # Hyper3D and Hunyuan3D all require a key configured in the add-on's
    # Preferences; Poly Haven's public API needs no key.
    # ------------------------------------------------------------------
    def _cmd_poly_haven_search(self, params: dict) -> dict:
        props = self._get_props()
        self._require_feature_enabled(props.use_poly_haven, "poly_haven_search")

        asset_type = params.get("asset_type", "hdris")
        query = str(params.get("query", "")).lower()
        limit = int(params.get("limit", 20))

        url = f"https://api.polyhaven.com/assets?type={urllib.parse.quote(asset_type)}"
        try:
            with urllib.request.urlopen(url, timeout=15) as response:
                data = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, ValueError) as exc:
            raise RuntimeError(f"Poly Haven API request failed: {exc}") from exc

        results = []
        for asset_id, meta in data.items():
            name = meta.get("name", asset_id)
            if query and query not in asset_id.lower() and query not in name.lower():
                continue
            results.append(
                {
                    "id": asset_id,
                    "name": name,
                    "categories": meta.get("categories", []),
                    "type": meta.get("type"),
                }
            )
            if len(results) >= limit:
                break

        return {"count": len(results), "assets": results}

    def _cmd_poly_haven_download(self, params: dict) -> dict:
        props = self._get_props()
        self._require_feature_enabled(props.use_poly_haven, "poly_haven_download")

        asset_id = params.get("asset_id")
        if not asset_id:
            raise ValueError("poly_haven_download requires an 'asset_id' parameter")

        asset_type = params.get("asset_type", "hdris")
        resolution = params.get("resolution", "1k")
        file_format = params.get("file_format", "hdr" if asset_type == "hdris" else "jpg")

        files_url = f"https://api.polyhaven.com/files/{urllib.parse.quote(asset_id)}"
        try:
            with urllib.request.urlopen(files_url, timeout=15) as response:
                files_data = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, ValueError) as exc:
            raise RuntimeError(f"Poly Haven API request failed: {exc}") from exc

        try:
            if asset_type == "hdris":
                file_info = files_data["hdri"][resolution][file_format]
            elif asset_type == "textures":
                map_name = params.get("map_name", "Diffuse")
                file_info = files_data[map_name][resolution][file_format]
            else:
                top_key = next(iter(files_data))
                file_info = files_data[top_key][resolution][file_format]
            download_url = file_info["url"]
        except (KeyError, StopIteration) as exc:
            raise ValueError(
                f"No file found for asset={asset_id!r} type={asset_type!r} "
                f"resolution={resolution!r} format={file_format!r}"
            ) from exc

        filename = f"{asset_id}_{resolution}.{file_format}"
        target_path = _safe_path(
            os.path.join(tempfile.gettempdir(), "blendermcp_assets", filename)
        )
        os.makedirs(os.path.dirname(target_path), exist_ok=True)

        try:
            urllib.request.urlretrieve(download_url, target_path)
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Failed to download Poly Haven asset: {exc}") from exc

        imported_as = None
        if asset_type == "hdris":
            world = bpy.context.scene.world or bpy.data.worlds.new("World")
            bpy.context.scene.world = world
            world.use_nodes = True
            nodes = world.node_tree.nodes
            links = world.node_tree.links

            env_node = next((n for n in nodes if n.type == "TEX_ENVIRONMENT"), None)
            if env_node is None:
                env_node = nodes.new("ShaderNodeTexEnvironment")
            env_node.image = bpy.data.images.load(target_path, check_existing=True)

            background = next((n for n in nodes if n.type == "BACKGROUND"), None)
            if background is not None:
                links.new(env_node.outputs["Color"], background.inputs["Color"])
            imported_as = "world_environment_texture"

        return {
            "asset_id": asset_id,
            "path": target_path,
            "download_url": download_url,
            "imported_as": imported_as,
        }

    def _cmd_sketchfab_search(self, params: dict) -> dict:
        props = self._get_props()
        self._require_feature_enabled(props.use_sketchfab, "sketchfab_search")

        prefs = self._get_preferences()
        api_key = (prefs.sketchfab_api_key or "").strip()
        if not api_key:
            raise PermissionError(
                "Sketchfab API key is not configured. Add it in Edit > Preferences "
                "> Add-ons > BlenderMCP."
            )

        query = params.get("query")
        if not query:
            raise ValueError("sketchfab_search requires a 'query' parameter")

        query_string = urllib.parse.urlencode(
            {
                "type": "models",
                "q": query,
                "downloadable": "true",
                "count": int(params.get("limit", 10)),
            }
        )
        request = urllib.request.Request(
            f"https://api.sketchfab.com/v3/search?{query_string}",
            headers={"Authorization": f"Token {api_key}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                data = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, ValueError) as exc:
            raise RuntimeError(f"Sketchfab API request failed: {exc}") from exc

        results = [
            {
                "uid": item.get("uid"),
                "name": item.get("name"),
                "viewer_url": item.get("viewerUrl"),
                "license": (item.get("license") or {}).get("label"),
            }
            for item in data.get("results", [])
        ]
        return {"count": len(results), "models": results}

    def _cmd_sketchfab_download(self, params: dict) -> dict:
        props = self._get_props()
        self._require_feature_enabled(props.use_sketchfab, "sketchfab_download")

        prefs = self._get_preferences()
        api_key = (prefs.sketchfab_api_key or "").strip()
        if not api_key:
            raise PermissionError(
                "Sketchfab API key is not configured. Add it in Edit > Preferences "
                "> Add-ons > BlenderMCP."
            )

        uid = params.get("uid")
        if not uid:
            raise ValueError("sketchfab_download requires a 'uid' parameter")

        request = urllib.request.Request(
            f"https://api.sketchfab.com/v3/models/{urllib.parse.quote(uid)}/download",
            headers={"Authorization": f"Token {api_key}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                data = json.loads(response.read().decode("utf-8"))
            gltf_info = data.get("gltf") or next(iter(data.values()))
            download_url = gltf_info["url"]
        except (urllib.error.URLError, ValueError, KeyError, StopIteration) as exc:
            raise RuntimeError(f"Sketchfab download request failed: {exc}") from exc

        filename = f"sketchfab_{uid}.zip"
        target_path = _safe_path(
            os.path.join(tempfile.gettempdir(), "blendermcp_assets", filename)
        )
        os.makedirs(os.path.dirname(target_path), exist_ok=True)

        try:
            urllib.request.urlretrieve(download_url, target_path)
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Failed to download Sketchfab asset: {exc}") from exc

        # Deliberately NOT auto-extracted: extracting an untrusted zip
        # without per-entry path validation is a classic "zip-slip"
        # traversal vector. Leave that to the user via File > Import.
        return {
            "uid": uid,
            "path": target_path,
            "note": (
                "Downloaded archive contains a glTF/GLB scene. Extract it "
                "yourself and use File > Import - this bridge intentionally "
                "does not auto-extract untrusted archives (zip-slip risk)."
            ),
        }

    def _cmd_hyper3d_generate_model(self, params: dict) -> dict:
        props = self._get_props()
        self._require_feature_enabled(props.use_hyper3d, "hyper3d_generate_model")

        prefs = self._get_preferences()
        api_key = (prefs.hyper3d_api_key or "").strip()
        if not api_key:
            raise PermissionError(
                "Hyper3D API key is not configured. Add it in Edit > Preferences "
                "> Add-ons > BlenderMCP."
            )

        prompt = params.get("prompt")
        if not prompt:
            raise ValueError("hyper3d_generate_model requires a 'prompt' parameter")

        endpoint = (
            params.get("endpoint")
            or prefs.hyper3d_endpoint
            or "https://hyperhuman.deemos.com/api/v2/rodin"
        )
        payload = json.dumps(
            {
                "prompt": prompt,
                "condition_mode": params.get("condition_mode", "text"),
                "quality": params.get("quality", "medium"),
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            endpoint,
            data=payload,
            method="POST",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, ValueError) as exc:
            raise RuntimeError(f"Hyper3D request failed: {exc}") from exc

        return {
            "submitted": True,
            "endpoint": endpoint,
            "provider_response": data,
            "note": (
                "Job submitted to Hyper3D. Poll the provider-specific job id "
                "in 'provider_response' and import the resulting mesh once "
                "ready - this bridge does not auto-poll long-running jobs."
            ),
        }

    def _cmd_hunyuan3d_generate_model(self, params: dict) -> dict:
        props = self._get_props()
        self._require_feature_enabled(props.use_hunyuan3d, "hunyuan3d_generate_model")

        prefs = self._get_preferences()
        api_key = (prefs.hunyuan3d_api_key or "").strip()
        if not api_key:
            raise PermissionError(
                "Hunyuan3D API key is not configured. Add it in Edit > Preferences "
                "> Add-ons > BlenderMCP."
            )

        prompt = params.get("prompt")
        image_path = params.get("image_path")
        if not prompt and not image_path:
            raise ValueError(
                "hunyuan3d_generate_model requires a 'prompt' or 'image_path' parameter"
            )

        endpoint = (
            params.get("endpoint")
            or prefs.hunyuan3d_endpoint
            or "https://api.hunyuan.tencent.com/v1/3d/generate"
        )
        payload = json.dumps(
            {
                "prompt": prompt,
                "image_path": image_path,
                "quality": params.get("quality", "medium"),
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            endpoint,
            data=payload,
            method="POST",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, ValueError) as exc:
            raise RuntimeError(f"Hunyuan3D request failed: {exc}") from exc

        return {
            "submitted": True,
            "endpoint": endpoint,
            "provider_response": data,
            "note": (
                "Job submitted to Hunyuan3D. Poll the provider-specific job id "
                "in 'provider_response' and import the resulting mesh once "
                "ready - this bridge does not auto-poll long-running jobs."
            ),
        }


# Module-level handle to the running server, if any. Managed exclusively by
# the two operators below and torn down in unregister().
_mcp_server: Optional[BlenderMCPServer] = None


# ---------------------------------------------------------------------------
# Scene properties (the sidebar panel's data model)
# ---------------------------------------------------------------------------
class BlenderMCPProperties(PropertyGroup):
    """Scene-level configuration for the BlenderMCP sidebar panel.

    Registered on `bpy.types.Scene` as `blendermcp_props`.
    """

    host: StringProperty(
        name="Host",
        description=(
            "Interface to bind the BlenderMCP TCP server to. Keep this as "
            "'localhost' unless you specifically need remote access and "
            "understand the security tradeoffs (see module docstring)."
        ),
        default="localhost",
    )
    port: IntProperty(
        name="Port",
        description="TCP port for the BlenderMCP server",
        default=9876,
        min=1024,
        max=65535,
    )
    server_running: BoolProperty(
        name="Server Running",
        description="Internal flag mirroring BlenderMCPServer.running",
        default=False,
    )

    use_poly_haven: BoolProperty(
        name="Poly Haven",
        description="Allow poly_haven_search / poly_haven_download commands",
        default=False,
    )
    use_sketchfab: BoolProperty(
        name="Sketchfab",
        description="Allow sketchfab_search / sketchfab_download commands (requires API key)",
        default=False,
    )
    use_hyper3d: BoolProperty(
        name="Hyper3D",
        description="Allow hyper3d_generate_model commands (requires API key)",
        default=False,
    )
    use_hunyuan3d: BoolProperty(
        name="Hunyuan3D",
        description="Allow hunyuan3d_generate_model commands (requires API key)",
        default=False,
    )

    enable_code_execution: BoolProperty(
        name="Enable Code Execution",
        description=(
            "DANGEROUS: allows execute_blender_code to run arbitrary, "
            "unsandboxed Python with full bpy/os/subprocess access. Only "
            "enable this for a trusted client on a trusted network."
        ),
        default=False,
    )
    telemetry_enabled: BoolProperty(
        name="Telemetry",
        description=(
            "Present for UI parity with upstream blender-mcp only. This "
            "build never sends telemetry regardless of this toggle - see "
            "TELEMETRY_ENABLED and _telemetry_noop() in addon.py."
        ),
        default=False,
    )


class BlenderMCPPreferences(AddonPreferences):
    """Add-on preferences: third-party API keys, kept out of the .blend file."""

    bl_idname = __name__

    sketchfab_api_key: StringProperty(
        name="Sketchfab API Key",
        description="Token from https://sketchfab.com/settings/password",
        default="",
        subtype="PASSWORD",
    )
    hyper3d_api_key: StringProperty(
        name="Hyper3D API Key",
        default="",
        subtype="PASSWORD",
    )
    hyper3d_endpoint: StringProperty(
        name="Hyper3D Endpoint",
        default="https://hyperhuman.deemos.com/api/v2/rodin",
    )
    hunyuan3d_api_key: StringProperty(
        name="Hunyuan3D API Key",
        default="",
        subtype="PASSWORD",
    )
    hunyuan3d_endpoint: StringProperty(
        name="Hunyuan3D Endpoint",
        default="https://api.hunyuan.tencent.com/v1/3d/generate",
    )

    def draw(self, context) -> None:
        layout = self.layout
        layout.label(text="API keys are only used when the matching panel toggle is enabled.")
        layout.prop(self, "sketchfab_api_key")
        layout.separator()
        layout.prop(self, "hyper3d_api_key")
        layout.prop(self, "hyper3d_endpoint")
        layout.separator()
        layout.prop(self, "hunyuan3d_api_key")
        layout.prop(self, "hunyuan3d_endpoint")


# ---------------------------------------------------------------------------
# Operators
# ---------------------------------------------------------------------------
class BLENDERMCP_OT_start_server(Operator):
    """Start the BlenderMCP TCP server using the host/port from the panel."""

    bl_idname = "blendermcp.start_server"
    bl_label = "Connect"
    bl_description = "Start the BlenderMCP TCP server"

    def execute(self, context) -> set:
        global _mcp_server
        props = context.scene.blendermcp_props

        if _mcp_server is not None and _mcp_server.running:
            self.report({"WARNING"}, "BlenderMCP server is already running")
            return {"CANCELLED"}

        _mcp_server = BlenderMCPServer(host=props.host, port=props.port)
        try:
            _mcp_server.start()
        except OSError as exc:
            self.report({"ERROR"}, f"Could not start BlenderMCP server: {exc}")
            _mcp_server = None
            props.server_running = False
            return {"CANCELLED"}

        props.server_running = True
        self.report({"INFO"}, f"BlenderMCP server listening on {props.host}:{props.port}")
        return {"FINISHED"}


class BLENDERMCP_OT_stop_server(Operator):
    """Stop the BlenderMCP TCP server, if running."""

    bl_idname = "blendermcp.stop_server"
    bl_label = "Disconnect"
    bl_description = "Stop the BlenderMCP TCP server"

    def execute(self, context) -> set:
        global _mcp_server
        props = context.scene.blendermcp_props

        if _mcp_server is not None:
            _mcp_server.stop()
            _mcp_server = None

        props.server_running = False
        self.report({"INFO"}, "BlenderMCP server stopped")
        return {"FINISHED"}


# ---------------------------------------------------------------------------
# UI panel (View3D sidebar / N-panel)
# ---------------------------------------------------------------------------
class VIEW3D_PT_blender_mcp(Panel):
    """N-panel sidebar UI for controlling the BlenderMCP server and features."""

    bl_label = "BlenderMCP"
    bl_idname = "VIEW3D_PT_blender_mcp"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "BlenderMCP"

    def draw(self, context) -> None:
        layout = self.layout
        props = context.scene.blendermcp_props

        connection_box = layout.box()
        connection_box.prop(props, "host")
        connection_box.prop(props, "port")

        is_running = _mcp_server is not None and _mcp_server.running
        status_row = connection_box.row()
        status_row.label(
            text=f"Status: {'Running' if is_running else 'Stopped'}",
            icon="CHECKMARK" if is_running else "X",
        )

        button_row = connection_box.row(align=True)
        button_row.enabled = not is_running
        button_row.operator(BLENDERMCP_OT_start_server.bl_idname, text="Connect")
        stop_row = connection_box.row(align=True)
        stop_row.enabled = is_running
        stop_row.operator(BLENDERMCP_OT_stop_server.bl_idname, text="Disconnect")

        asset_box = layout.box()
        asset_box.label(text="Asset Providers", icon="WORLD")
        asset_box.prop(props, "use_poly_haven")
        asset_box.prop(props, "use_sketchfab")
        asset_box.prop(props, "use_hyper3d")
        asset_box.prop(props, "use_hunyuan3d")

        security_box = layout.box()
        security_box.label(text="Security", icon="LOCKED")
        security_box.prop(props, "enable_code_execution")
        if props.enable_code_execution:
            security_box.label(text="Arbitrary code execution is ON", icon="ERROR")
        security_box.prop(props, "telemetry_enabled")
        security_box.label(text="Telemetry is never sent by this build.", icon="INFO")


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------
_CLASSES = (
    BlenderMCPPreferences,
    BlenderMCPProperties,
    BLENDERMCP_OT_start_server,
    BLENDERMCP_OT_stop_server,
    VIEW3D_PT_blender_mcp,
)


def register() -> None:
    for cls in _CLASSES:
        bpy.utils.register_class(cls)

    bpy.types.Scene.blendermcp_props = PointerProperty(type=BlenderMCPProperties)


def unregister() -> None:
    global _mcp_server
    if _mcp_server is not None:
        _mcp_server.stop()
        _mcp_server = None

    if hasattr(bpy.types.Scene, "blendermcp_props"):
        del bpy.types.Scene.blendermcp_props

    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
