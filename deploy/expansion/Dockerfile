# RestaurantOS (Next.js) + Expansion Deep Agents worker — single long-running host.
#
# PREPARED, NOT VERIFIED: this image has not been built or run (no Docker on the
# authoring machine, no hosting account). See docs/expansion/RELEASE_RUNBOOK.md.
#
# Why one container: the Next.js server spawns one detached Python worker per
# agent run (D-025) and talks to it over the HTTP tool bridge on 127.0.0.1, and
# the CoStar SQLite cache + run directories need a persistent private volume.
# Serverless/edge hosting (e.g. Vercel functions) cannot run this topology.
#
# Build (from the repository root):
#   docker build -f deploy/expansion/Dockerfile -t restaurantos-expansion .
# Run (values come from your secret store; never bake them into the image):
#   docker run -p 3000:3000 --env-file /secure/location/runtime.env \
#     -v restaurantos-private:/data restaurantos-expansion

FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Restricted datasets and local env files must never enter the image.
RUN rm -rf src/features/expansion/data/data "src/features/expansion/data/costar-hackathon-kit (1)" .env .env.local \
 && npm run build

FROM node:22-bookworm AS runtime
# Python 3.11 (bookworm) for the worker; deepagents 0.7.x requires >= 3.11.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    EXPANSION_AGENT_PYTHON=/opt/worker-venv/bin/python \
    EXPANSION_AGENT_BRIDGE_URL=http://127.0.0.1:3000 \
    EXPANSION_AGENT_RUNS_DIR=/data/runs \
    EXPANSION_DB_PATH=/data/expansion.sqlite \
    EXPANSION_DEV_SECRET_FILE=/data/.unused-dev-secret
COPY --from=build /app /app
RUN python3 -m venv /opt/worker-venv \
 && /opt/worker-venv/bin/pip install --no-cache-dir -r src/features/expansion/agent/worker/requirements.lock
# /data: persistent private volume (CoStar cache, run directories). Mount it.
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/expansion/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
