# syntax=docker/dockerfile:1
#
# ondemand-blender-mcp -- multi-stage Docker build
#   Stage 1 (uv-source): provides the `uv` binary, no pip bootstrap needed.
#   Stage 2 (builder):   resolves and installs the package + its deps with uv.
#   Stage 3 (runtime):   slim, non-root image with only what's needed to run
#                        the streamable-HTTP MCP server.

# ---------------------------------------------------------------------------
# Stage 1: uv-source -- pull the official static `uv` / `uvx` binaries.
# ---------------------------------------------------------------------------
FROM ghcr.io/astral-sh/uv:latest AS uv-source

# ---------------------------------------------------------------------------
# Stage 2: builder -- install ondemand-blender-mcp and its dependencies.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS builder

# Bring in the uv binary from the stage above instead of `pip install uv`.
COPY --from=uv-source /uv /uvx /usr/local/bin/

WORKDIR /build

# Copy only the packaging metadata and source tree needed to install.
COPY pyproject.toml README.md ./
COPY src ./src

# Install the project system-wide inside this throwaway stage; only the
# resulting site-packages + console script get copied into the final image.
RUN uv pip install --system .

# ---------------------------------------------------------------------------
# Stage 3: runtime -- minimal image, non-root user, no build tooling.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

# Copy the installed package and console script from the builder stage.
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin/ondemand-blender-mcp /usr/local/bin/ondemand-blender-mcp

# Create an unprivileged user to run the server as, and drop root.
RUN groupadd --system mcp && useradd --system --gid mcp mcp
WORKDIR /app
USER mcp

# Default runtime configuration; override via `docker run -e` or --env-file.
ENV BLENDER_HOST=localhost \
    BLENDER_PORT=9876 \
    MCP_HTTP_PORT=8080 \
    TELEMETRY_ENABLED=false

EXPOSE 8080

# Slim base images don't ship curl/wget, so probe /health with urllib instead.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('MCP_HTTP_PORT', '8080') + '/health', timeout=2)"

# Always serve the streamable-HTTP transport in the container, bound to all
# interfaces so it is reachable through the published port mapping.
ENTRYPOINT ["ondemand-blender-mcp", "--transport", "http", "--host", "0.0.0.0", "--port", "8080"]
