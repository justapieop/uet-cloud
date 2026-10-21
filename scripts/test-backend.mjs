import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const mode = process.argv[2] ?? "unit";
if (mode !== "unit" && mode !== "db") throw new Error("Expected unit or db test mode");
if (mode === "db" && !process.env.TEST_SQLSERVER_PASSWORD) {
  throw new Error("Set TEST_SQLSERVER_PASSWORD for an isolated SQL Server test instance. Application credentials are never loaded.");
}
const tests = [];
for (const workspace of ["domain", "application", "infrastructure", "presentation"]) {
  const directory = join("packages", workspace, "test");
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".test.ts") && (mode === "db") === entry.name.endsWith(".integration.test.ts")) {
      tests.push(join(directory, entry.name));
    }
  }
}
if (tests.length === 0) throw new Error("No backend tests discovered");
run(process.execPath, ["--test", ...tests.sort()], { ...process.env, RUN_SQLSERVER_TESTS: mode === "db" ? "true" : "false", RUN_AZURE_LIVE_TESTS: "false" });
if (mode === "unit") {
  run(process.env.PYTHON ?? "python", ["-B", "-m", "unittest", "discover", "-s", "infra/azure/pipelines", "-p", "test_*.py"]);
}
