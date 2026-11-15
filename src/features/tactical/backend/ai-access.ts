import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { aiError } from "../domain/ai.ts";

const cookieName = "tactical_ai";
const secret = () => process.env.TACTICAL_AI_PASSWORD || process.env.TACTICAL_API_TOKEN || "";
const sign = (value: string) => createHmac("sha256", secret()).update(value).digest("hex");
const equal = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const aiFailure = (status = 503) => Response.json({ ok: false, error: aiError }, { status, headers: { "Cache-Control": "no-store" } });
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const source = new URL(origin);
    // Next can normalize request.url to localhost behind its server/proxy. Host is the
    // browser-requested authority; never accept a different Origin authority.
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return ["http:", "https:"].includes(source.protocol) && source.host === host && source.origin === origin;
  } catch { return false; }
}
export function authorizedAi(request: Request) {
  if (secret().length < 32) return false;
  const value = request.headers.get("cookie")?.split(";").map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? "";
  const [expires, nonce, signature] = value.split(".");
  if (!expires || !nonce || !signature || !/^\d+$/.test(expires) || Number(expires) < Date.now() || Number(expires) > Date.now() + 9 * 3600_000) return false;
  return equal(signature, sign(`${expires}.${nonce}`));
}
export async function boundedJson(request: Request, maxBytes: number) {
  if (!request.headers.get("content-type")?.startsWith("application/json") || !request.body) throw new Error(aiError);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw new Error(aiError); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

// Process-wide ceilings also cover anonymous unlock attempts; no forwarded-IP trust.
const windows = new Map<string, { start: number; count: number }>();
export function takeAiBudget(scope: "unlock" | "generate", now = Date.now()) {
  const period = scope === "unlock" ? 60_000 : 3600_000;
  const limit = scope === "unlock" ? 20 : 60;
  const entry = windows.get(scope);
  if (!entry || now - entry.start >= period) { windows.set(scope, { start: now, count: 1 }); return true; }
  if (entry.count >= limit) return false;
  entry.count++; return true;
}
export async function aiSession(request: Request) {
  if (request.method === "GET") return Response.json({ unlocked: authorizedAi(request) }, { headers: { "Cache-Control": "no-store" } });
  if (!sameOrigin(request)) return aiFailure(403);
  const cookieOptions = `Path=/api/tactical; HttpOnly; SameSite=Strict${request.headers.get("origin")?.startsWith("https://") ? "; Secure" : ""}`;
  if (request.method === "DELETE") return Response.json({ ok: true }, { headers: { "Set-Cookie": `${cookieName}=; Max-Age=0; ${cookieOptions}`, "Cache-Control": "no-store" } });
  if (!takeAiBudget("unlock")) return aiFailure(429);
  try {
    const body = await boundedJson(request, 2048) as { password?: unknown };
    if (typeof body.password !== "string" || secret().length < 32 || !equal(body.password, secret())) return aiFailure(401);
    const value = `${Date.now() + 8 * 3600_000}.${randomBytes(16).toString("hex")}`;
    return Response.json({ ok: true }, { headers: { "Set-Cookie": `${cookieName}=${value}.${sign(value)}; Max-Age=28800; ${cookieOptions}`, "Cache-Control": "no-store" } });
  } catch { return aiFailure(400); }
}
