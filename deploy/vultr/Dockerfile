# Full application host: Next.js plus Expansion's existing Python worker.
# Secrets and private datasets are supplied only at runtime.
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 \
    EXPANSION_AGENT_PYTHON=/opt/worker-venv/bin/python \
    EXPANSION_EVIDENCE_PYTHON=/opt/worker-venv/bin/python \
    EXPANSION_AGENT_BRIDGE_URL=http://127.0.0.1:3000 \
    EXPANSION_AGENT_RUNS_DIR=/data/runs EXPANSION_RUNS_DIR=/data/runs \
    EXPANSION_STORE_DIR=/data/store EXPANSION_DB_PATH=/data/expansion.sqlite \
    EXPANSION_COSTAR_ROOT=/data/costar-kit PYTHONDONTWRITEBYTECODE=1
COPY --from=build /app /app
RUN python3 -m venv /opt/worker-venv \
    && /opt/worker-venv/bin/pip install --no-cache-dir -r src/features/expansion/agent/worker/requirements.lock \
    && mkdir -p /data/runs /data/store \
    && ln -s /data /app/src/features/expansion/data/data \
    && chown -R node:node /data /app/.next
# data_access.py (used by Expansion's existing source probe) also imports dotenv.
RUN /opt/worker-venv/bin/pip install --no-cache-dir python-dotenv==1.2.4
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deploy/vultr/start.mjs"]
