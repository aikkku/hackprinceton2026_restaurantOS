# RestaurantOS deployment on Vultr

Prepared November 15, 2026. This hosts **both Tactical and Expansion** on one long-running Linux machine. It does not replace MongoDB Atlas, Gemini or Nessie. No cloud instance has been provisioned by this work.

## Why Vultr fits

The [official HackPrinceton Fall 2026 challenge](https://hackprinceton-fall-26.devpost.com/) lists **[MLH] Best Use of Vultr**, describes cloud compute and invites deploying a hack to Vultr. Hosting the actual application there is a relevant integration; a GPU or artificial Vultr-only product feature is unnecessary. This is an interpretation of the published challenge, not a guarantee of eligibility or winning. [MLH's Vultr guide](https://www.mlh.com/partners/vultr) explains account/credit signup; confirm current credit terms in your account.

The app needs a Next.js server and Expansion's Python child processes, local SQLite dataset and persistent working files. A single Vultr Cloud Compute VM fits this existing architecture. [Next.js supports Node/Docker hosting](https://nextjs.org/docs/app/getting-started/deploying). Generic serverless functions are not a drop-in replacement for the Python worker and local disk.

Start with Ubuntu 24.04 x86_64, 2 vCPU, 4 GB RAM and at least 30 GB available disk as an initial engineering estimate, not a measured capacity guarantee. More memory may be needed to build Next.js while workers run. Check the actual Vultr quote/credits before creating the paid instance. No GPU or Kubernetes cluster is needed for this deployment. Keep one app instance because budgets, caches and worker execution currently assume a single process/host.

## Files

| File | Purpose |
| --- | --- |
| `deploy/vultr/Dockerfile` | Node 24 / Python 3.11 image, full source/runtime dependencies, non-root app, health check |
| `deploy/vultr/Dockerfile.dockerignore` | Allowlisted context; excludes local environment files, private datasets, caches and virtualenvs |
| `deploy/vultr/compose.yaml` | App plus HTTPS proxy, persistent app and certificate volumes, restart/log rotation |
| `deploy/vultr/Caddyfile` | HTTPS termination and streaming proxy; preserves Host for existing origin checks |
| `deploy/vultr/runtime.env.example` | Names/placeholders only; actual file lives outside the checkout |
| `deploy/vultr/preflight.mjs`, `start.mjs` | Fail before startup if deployment credentials/storage mode are incomplete |
| `deploy/vultr/smoke.mjs` | Disposable fixture-only image verification with no external provider requests |
| `src/app/api/health/route.ts` | Non-sensitive liveness endpoint; does not imply DB/AI readiness |
| `.github/workflows/verify.yml` | Linux lint/unit/config/image/smoke checks; does not deploy or receive production secrets |

Rain's module and `deploy/expansion/` remain unchanged by the deployment preparation. This image includes his existing worker plus the pinned `python-dotenv` dependency already required by the shared source helper, and follows the [Expansion runbook](expansion/RELEASE_RUNBOOK.md). It keeps full source because the worker, helpers and CLI tools resolve filesystem paths; it deliberately does not use Next standalone tracing.

## What the owner needs to provide

1. A Vultr account, applicable credits and a chosen VM. Add an SSH public key; never paste private keys or provider credentials into chat.
2. A DNS hostname whose A record points at the VM. Remove stale AAAA records unless IPv6 is configured. Open TCP 80/443 publicly; restrict SSH to your IP. Port 3000 stays internal.
3. The runtime values below in `/opt/restaurantos/runtime.env`, mode 600, outside the checkout. Rotate Mongo/Gemini/Nessie credentials previously pasted into chat before using them on a public deployment.
4. Allow the Vultr VM's public IP in Atlas Network Access. The Atlas user needs `readWrite` on `restaurantos`; use Atlas/replica-set transactions for assistant Apply.
5. Rain's permitted private dataset/cache on the private volume if demonstrating real Expansion scouting. The image does not include it or silently fabricate a replacement.

## Configure and launch

Install Docker Engine and the Compose plugin using [Docker's Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/), or use a suitable Vultr Docker image. Clone the repository into `/opt/restaurantos/app`. Use your normal SSH/HTTPS Git authentication; do not embed a token in the remote URL.

```sh
sudo mkdir -p /opt/restaurantos
sudo chown "$(id -u):$(id -g)" /opt/restaurantos
git clone https://github.com/aikkku/hackprinceton2026_restaurantOS.git /opt/restaurantos/app
cd /opt/restaurantos/app
cp deploy/vultr/runtime.env.example /opt/restaurantos/runtime.env
chmod 600 /opt/restaurantos/runtime.env
```

Edit the file securely. Generate each session/access secret independently with `openssl rand -hex 32`. Never reuse the administrative Tactical API token as the UI access code. Keep `EXPANSION_SESSION_SECRET` stable across restarts; rotating it invalidates anonymous owner sessions. Required deployment values:

| Variable | Value / purpose |
| --- | --- |
| `TACTICAL_DATA_SOURCE` | `mongodb` for persistent restaurant and assistant data; `demo` only for temporary fixture sessions |
| `MONGODB_URI`, `MONGODB_DB` | Atlas URI and shared `restaurantos` database |
| `TACTICAL_RESTAURANT_ID` | Existing `juniper-table` record; deployment does not automatically overwrite/seed it |
| `TACTICAL_AI_PASSWORD` | Random >=32-character UI access code, distinct from API token |
| `TACTICAL_API_TOKEN` | Separate random >=32-character administrative bearer token |
| `EXPANSION_SESSION_SECRET` | Random >=32-character stable signing secret |
| `EXPANSION_ACCESS_CODE` | Random >=32-character pilot access code |
| `EXPANSION_PERSISTENCE` | `mongodb` for hosted durable records; explicit `file` only for local verification |
| `GEMINI_API_KEY` | Server-side AI key shared by the existing integrations |
| `NESSIE_API_KEY`, `NESSIE_ACCOUNT_ID` | Existing sandbox account; optional, no records created on boot |

Use plain unquoted `KEY=value` lines in the runtime file. The Compose file uses raw parsing to preserve `$` and other secret characters; requires Docker Compose >=2.30. Do not run `docker compose config` without `--quiet` against production secrets because expanded configuration can display them.

Set the following non-secret shell values on the server (substitute your hostname/email):

```sh
export RUNTIME_ENV_FILE=/opt/restaurantos/runtime.env
export APP_DOMAIN=restaurant.your-domain.com
export ACME_EMAIL=you@your-domain.com
export APP_IMAGE_TAG="$(git rev-parse --short HEAD)"
docker compose -f deploy/vultr/compose.yaml config --quiet
docker compose -f deploy/vultr/compose.yaml build app
SMOKE_IMAGE="restaurantos:$APP_IMAGE_TAG" node deploy/vultr/smoke.mjs
docker compose -f deploy/vultr/compose.yaml up -d --wait
```

The smoke script needs Node 24 on the host and only uses synthetic data/temporary credentials; running it is optional if the same image has already passed CI. On a host without Node, use CI and the post-launch checks instead. The image itself contains all Node/Python runtime dependencies.

[Caddy obtains and renews certificates](https://caddyserver.com/docs/automatic-https) once DNS resolves to the host and ports 80/443 are reachable. Its certificate volumes must survive restarts. Only Caddy publishes ports; app/worker traffic stays internal. First certificate issuance and public HTTPS must be verified on the real host.

## Data and persistence

- **Tactical:** use the existing Atlas dataset and feature collections. No upload/seed happens during build/start. `tactical_conversations` saves chat/result/proposal snapshots; Apply commits dataset and audit together. Existing review, HR, floor and cash collections keep their current contracts.
- **Expansion:** Mongo `expansion_*` collections retain his current ownership. The named `restaurantos_restaurant_data` volume holds `/data/runs`, `/data/store`, private SQLite and permitted source files. Its default image directory is owned by UID 1000. Any imported files must be readable by UID 1000; working directories must be writable. Follow Rain's runbook to import data, migrate collections and validate readiness. Do not run the E2E fixture setup against production data.
- **Demo mode:** Tactical sessions reset on server restart. This is for a local smoke test, not durable hosted chat history.
- **Backups:** retain Atlas backups plus the private volume and certificate volumes. Do not use `docker compose down -v` when updating; it deletes volumes. No private dataset is committed or copied into the build image.

## Post-launch acceptance

1. `curl --fail https://YOUR_HOST/api/health` returns the liveness response. Open `/`, `/onboarding`, `/tactical` and `/expansion` over HTTPS.
2. Inspect source disclosure: Tactical should show MongoDB with the expected restaurant/revision. It should not silently fall back if Atlas is unavailable.
3. Unlock Tactical, generate one chat, navigate to ribeye stock, reopen history after reload. This is a live Gemini/Atlas test and remains deferred until explicitly approved by the owner.
4. Separately approve and test an editable stock/menu change against disposable records, checking both dataset and conversation audit. Do not change the demonstration restaurant merely to test deployment.
5. Coordinate Expansion readiness and worker tests with Rain: `/api/expansion/health?ready=1` checks configured runtime/data/storage and can sweep stale runs. Liveness alone does not prove Expansion scouting is ready.
6. Verify Nessie reads the expected sandbox account; missing provider keys should fail honestly. Do not seed duplicate sandbox records.
7. Record the URL, commit, Vultr instance details and screenshots of a real deployed journey for the prize submission. Explain that Vultr hosts application/worker compute, Atlas stores records and Gemini supplies model interpretation. Do not claim Vultr GPU/model hosting.

## Update and rollback

Before updating, retain the current image tag and back up state. Fetch/fast-forward Git, choose the new commit tag, build, then `up -d --wait`. This is a single-instance hackathon deployment; brief downtime is possible.

```sh
git pull --ff-only
export APP_IMAGE_TAG="$(git rev-parse --short HEAD)"
docker compose -f deploy/vultr/compose.yaml build app
docker compose -f deploy/vultr/compose.yaml up -d --wait
```

To roll back, set `APP_IMAGE_TAG` to a previously built tag and run `up -d --no-build --wait`. Keep the same runtime environment and volumes. Do not prune the previous image until the new release is accepted. App rollback does not undo data writes.

## Verification and remaining gates

Local verification passed: 306 application unit tests (one existing skip), four deployment configuration tests, all 96 Tactical Chromium/Firefox checks, lint (one existing Expansion warning), typecheck and production build. The Linux ARM64 image built and passed the disposable container smoke: six page routes, authenticated local chat-history read, Python worker/source-helper imports and non-root volume writes. Compose and Caddy configuration validation passed; the image excludes local environment files, Git history and restricted source data. The workflow also prepares the same image/smoke checks on GitHub’s Linux x86_64 runner; hosted CI status is separate from these local results. Public DNS/TLS, Vultr provisioning, credit eligibility, Atlas access from Vultr, live model/chat writes and Rain's private dataset readiness require the actual deployment environment. This is a prepared hackathon/pilot deployment, not a claim of production multi-tenant identity or distributed worker orchestration.

Field note: deploy the full repository runtime when a Next app spawns Python modules and reads private SQLite; a frontend-only export loses these capabilities. Keep private inputs mounted and secrets out of build context. ChatOverflow CLI/config are unavailable in this environment, so this note is retained here.
