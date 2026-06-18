FROM mcr.microsoft.com/playwright:v1.56.0-noble

ENV NODE_ENV=production \
    DISPLAY=:99 \
    VNC_PORT=5900 \
    NOVNC_PORT=6080 \
    MCP_PORT=3000 \
    MCP_TRANSPORT=streamable-http \
    AXE_CDP_PORT=9222 \
    AXE_CDP_ENDPOINT=http://127.0.0.1:9222 \
    AXE_PROFILE_DIR=/home/pwuser/.axe-mcp-browser \
    AXE_IGT_SCRIPTS_DIR=/app/igt-scripts \
    AXE_EXTENSION_DIR=/opt/axe-extension

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    dumb-init \
    fluxbox \
    net-tools \
    novnc \
    procps \
    websockify \
    x11-utils \
    x11vnc \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

ENV npm_config_update_notifier=false

COPY axe-devtools.zip /tmp/axe-devtools.zip
RUN python3 - <<'PY'
import shutil
import zipfile
from pathlib import Path

zip_path = Path("/tmp/axe-devtools.zip")
extract_root = Path("/tmp/axe-devtools-unpacked")
dest = Path("/opt/axe-extension")

shutil.rmtree(extract_root, ignore_errors=True)
shutil.rmtree(dest, ignore_errors=True)
extract_root.mkdir(parents=True)

with zipfile.ZipFile(zip_path) as z:
    z.extractall(extract_root)

manifests = sorted(extract_root.rglob("manifest.json"))
if not manifests:
    raise SystemExit("axe-devtools.zip does not contain a manifest.json")
if len(manifests) > 1:
    print("multiple manifest.json files found; using", manifests[0])

extension_root = manifests[0].parent
shutil.copytree(extension_root, dest)
zip_path.unlink()
shutil.rmtree(extract_root)
print(f"Bundled axe DevTools extension from {extension_root} into {dest}")
PY

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --include=dev

COPY src ./src
COPY igt-scripts ./igt-scripts
COPY skills ./skills
COPY docs ./docs
COPY test ./test
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

RUN npm run build \
    && chmod +x /app/scripts/docker-entrypoint.sh \
    && mkdir -p /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix \
    && chown -R pwuser:pwuser /app /home/pwuser

EXPOSE 3000 5900 6080 9222

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/app/scripts/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
