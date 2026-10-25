import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

const repositoryEnvFile: URL = new URL("../../.env", import.meta.url);

if (process.env.API_URL === undefined && existsSync(repositoryEnvFile)) {
  const repositoryEnv: Record<string, string | undefined> = parseEnv(
    readFileSync(repositoryEnvFile, "utf8"),
  );

  if (repositoryEnv.API_URL !== undefined) {
    process.env.API_URL = repositoryEnv.API_URL;
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  reactCompiler: true,
};

export default nextConfig;
