import { spawn } from "node:child_process";
import { checkEnvironment } from "./preflight.mjs";
const errors = checkEnvironment(process.env);
if (errors.length) {
  console.error("Deployment configuration is incomplete:\n" + errors.map(error => `- ${error}`).join("\n"));
  process.exit(1);
}
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"], { stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Unable to start the application"); process.exit(1); });
child.on("exit", code => process.exit(code ?? 1));
