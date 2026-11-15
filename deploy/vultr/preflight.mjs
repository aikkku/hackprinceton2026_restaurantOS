// Configuration checks only: no provider calls, DB writes, or secret logging.
export function checkEnvironment(env) {
  const errors = [];
  const mode = env.TACTICAL_DATA_SOURCE ?? "demo";
  if (!["demo", "mongodb"].includes(mode)) errors.push("TACTICAL_DATA_SOURCE must be demo or mongodb");
  for (const key of ["TACTICAL_AI_PASSWORD", "TACTICAL_API_TOKEN", "EXPANSION_SESSION_SECRET", "EXPANSION_ACCESS_CODE"]) {
    if ((env[key] ?? "").length < 32 || /replace|change.me|example/i.test(env[key] ?? "")) errors.push(`${key} needs a unique random value of at least 32 characters`);
  }
  if (env.TACTICAL_AI_PASSWORD && env.TACTICAL_AI_PASSWORD === env.TACTICAL_API_TOKEN) errors.push("Use different Tactical UI and administrative credentials");
  if (mode === "mongodb" || env.EXPANSION_PERSISTENCE === "mongodb") {
    if (!/^mongodb(?:\+srv)?:\/\//.test(env.MONGODB_URI ?? "")) errors.push("MONGODB_URI is required for MongoDB storage");
    if (!env.MONGODB_DB) errors.push("MONGODB_DB is required for MongoDB storage");
  }
  if (mode === "mongodb" && !env.TACTICAL_RESTAURANT_ID) errors.push("TACTICAL_RESTAURANT_ID is required in MongoDB mode");
  if (!["mongodb", "file", "off"].includes(env.EXPANSION_PERSISTENCE ?? "")) errors.push("Set EXPANSION_PERSISTENCE explicitly: mongodb, file, or off");
  if (env.EXPANSION_AGENT_BRIDGE_URL && env.EXPANSION_AGENT_BRIDGE_URL !== "http://127.0.0.1:3000") errors.push("This image requires the worker bridge at http://127.0.0.1:3000");
  return errors;
}
