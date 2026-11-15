// Disposable local container; never loads .env.local or calls model/DB providers.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";
const image = process.env.SMOKE_IMAGE ?? "restaurantos:deploy-check";
const name = `restaurantos-smoke-${process.pid}`;
const docker = args => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const credential = () => randomBytes(32).toString("hex");
const uiPassword = credential();
try {
  docker(["run", "--detach", "--name", name, "--publish", "127.0.0.1::3000", "--env", "TACTICAL_DATA_SOURCE=demo", "--env", "EXPANSION_PERSISTENCE=file", "--env", `TACTICAL_AI_PASSWORD=${uiPassword}`, "--env", `TACTICAL_API_TOKEN=${credential()}`, "--env", `EXPANSION_SESSION_SECRET=${credential()}`, "--env", `EXPANSION_ACCESS_CODE=${credential()}`, image]);
  const address = docker(["port", name, "3000/tcp"]);
  const base = `http://${address}`;
  let ready = false;
  for (let i = 0; i < 45; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
    await setTimeout(1000);
  }
  if (!ready) throw new Error("Container did not become live");
  for (const path of ["/", "/onboarding", "/tactical", "/tactical/supply", "/tactical/ai", "/expansion"]) {
    const result = await fetch(base + path);
    if (!result.ok) throw new Error(`Page failed: ${path} (${result.status})`);
    console.log(`PASS ${path}`);
  }
  const session = await fetch(`${base}/api/tactical/ai/session`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ password: uiPassword }) });
  if (!session.ok) throw new Error("Local workspace authentication failed");
  const cookie = session.headers.get("set-cookie")?.split(";")[0];
  const history = await fetch(`${base}/api/tactical/assistant?restaurantId=juniper-table`, { headers: { Cookie: cookie ?? "" } });
  const body = await history.json();
  if (!history.ok || body.storage !== "session" || body.threads.length !== 0) throw new Error("Isolated chat history failed");
  console.log("PASS authenticated local assistant history");
  docker(["exec", name, "/opt/worker-venv/bin/python", "-c", "import deepagents; import langchain_google_genai; import data_access; print('worker and source helper dependencies available')"]);
  docker(["exec", name, "node", "-e", "require('fs').writeFileSync('/data/smoke-check','local');require('fs').unlinkSync('/data/smoke-check')"]);
  console.log("PASS Python worker dependencies and non-root persistent volume access");
} catch (error) {
  // execFile errors may contain generated test credentials in command arguments.
  console.error(error?.code ? "Local Docker smoke failed; inspect Docker/build status" : error.message);
  process.exitCode = 1;
} finally {
  try { docker(["rm", "--force", "--volumes", name]); } catch {}
}
