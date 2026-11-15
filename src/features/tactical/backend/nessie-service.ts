import { authorizedAi, sameOrigin } from "./ai-access.ts";
import { readNessie } from "./adapters/nessie.ts";
export function createNessieHandler({ read = readNessie, authorize = authorizedAi }: { read?: typeof readNessie; authorize?: typeof authorizedAi } = {}) {
  let running = false;
  const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  return async (request: Request) => {
    if (!sameOrigin(request)) return reply({ error: "Request not allowed." }, 403);
    if (!authorize(request)) return reply({ error: "Unlock the workspace to read Nessie." }, 401);
    if (running) return reply({ error: "A Nessie request is already running. Try again shortly." }, 429);
    running = true;
    try { return reply({ ok: true, snapshot: await read({ signal: request.signal }) }); }
    catch { return reply({ error: "Nessie is unavailable. Check the server configuration and retry. Demo data is available separately." }, 503); }
    finally { running = false; }
  };
}
