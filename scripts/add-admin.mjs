import "reflect-metadata";
import { addGithubAdmin, AdminBootstrapError, validateGithubUserId } from "../packages/infrastructure/dist/db/index.js";
import { createDatabaseSource } from "./database.mjs";

const args = process.argv.slice(2);
const usage = "Usage: npm run admin:add -- --github-id 123456";
if (args.length === 1 && args[0] === "--help") {
  console.log(`${usage}\nCreates or promotes the user with this numeric GitHub ID. See docs/database-seeding.md.`);
} else {
  let source;
  try {
    if (args.length !== 2 || args[0] !== "--github-id") throw new AdminBootstrapError(usage);
    validateGithubUserId(args[1]);
    source = createDatabaseSource();
    await source.initialize();
    await source.runMigrations({ transaction: "all" });
    const result = await addGithubAdmin(source, args[1]);
    console.log(`GitHub user ${args[1]} has the active admin role with Super. User ${result.userCreated ? "created" : "preserved"}; assignment ${result.assignmentCreated ? "created" : "already exists"}.`);
  } catch (error) {
    console.error(error instanceof AdminBootstrapError ? error.message : "Admin setup failed. Check database configuration, connectivity, schema, and permissions.");
    process.exitCode = 1;
  } finally {
    if (source?.isInitialized) await source.destroy();
  }
}
