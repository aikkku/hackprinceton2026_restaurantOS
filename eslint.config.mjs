import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

export default defineConfig([
  ...next,
  ...typescript,
  globalIgnores([
    ".next/**", "next-env.d.ts",
    // Generated/private data and Python environments are not JavaScript source.
    "**/.venv*/**", "src/features/expansion/data/data/**",
    "src/features/expansion/data/quickstart/**", "src/features/expansion/data/costar-hackathon-kit*/**",
    "src/features/expansion/agent/.tmp/**", "src/features/expansion/agent/.tools/**", "src/features/expansion/agent/.uv-cache/**",
    // Existing worker test scratch directories may belong to a different
    // Windows sandbox identity. Preserve them without traversing them.
    "bridge-*/**", "cancel-*/**", "deleg-*/**", "events-*/**", "safety-*/**", "smoke-run-*/**", "phase4-provider-*/**", ".phase4-tmp/**",
  ]),
]);
